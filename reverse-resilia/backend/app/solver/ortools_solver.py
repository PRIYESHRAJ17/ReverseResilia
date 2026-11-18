"""
Optional Google OR-Tools CP-SAT Solver implementation for ReverseResilia.
Used when OR-Tools native libraries are available in the runtime environment.
"""

import time
import math
from typing import List, Dict, Tuple, Optional, Any
from ..models.schemas import (
    NetworkData,
    DisruptionScenario,
    Warehouse,
    CustomerOrder,
    TransportRoute,
    Intervention,
    OrderAssignment,
    RecoveryPlan,
    SolverStatus,
    PriorityPolicy,
)


class OrToolsSolver:
    """Google OR-Tools CP-SAT Solver."""

    def __init__(self):
        try:
            from ortools.sat.python import cp_model
            self.cp_model = cp_model
        except Exception as e:
            raise ImportError(f"OR-Tools CP-SAT cannot be loaded: {e}")

    def solve(
        self,
        network: NetworkData,
        disruption: Optional[DisruptionScenario] = None,
        target_service_percentage: Optional[float] = None,
        budget_inr: Optional[float] = None,
        allowed_intervention_ids: Optional[List[str]] = None,
        priority_policy: PriorityPolicy = PriorityPolicy.HARD,
        timeout_seconds: float = 10.0,
    ) -> RecoveryPlan:
        start_time = time.perf_counter()
        model = self.cp_model.CpModel()

        # Step 1: Effective state
        wh_map: Dict[str, Warehouse] = {w.id: w.model_copy(deep=True) for w in network.warehouses}
        orders = network.orders
        routes = network.routes

        closed_routes = set()
        if disruption:
            for f_id in disruption.failed_warehouse_ids:
                if f_id in wh_map:
                    wh_map[f_id].is_active = False
            for r_id in disruption.closed_route_ids:
                closed_routes.add(r_id)
            for w_id, red_pct in disruption.capacity_reductions.items():
                if w_id in wh_map:
                    wh_map[w_id].capacity_reduction_percent = min(100.0, max(0.0, red_pct))

        wh_list = list(wh_map.values())
        route_map = {(r.warehouse_id, r.order_id): r for r in routes}

        allowed_int_ids = set(allowed_intervention_ids) if allowed_intervention_ids is not None else {
            i.id for i in network.available_interventions
        }
        active_interventions = [
            i for i in network.available_interventions if i.id in allowed_int_ids
        ]

        # Decision Variables: x[order_id, wh_id]
        x: Dict[Tuple[str, str], Any] = {}
        for o in orders:
            for w in wh_list:
                r = route_map.get((w.id, o.id))
                can_assign = (
                    w.is_active
                    and r is not None
                    and r.is_open
                    and r.id not in closed_routes
                    and r.transit_time_minutes <= o.deadline_minutes
                )
                if can_assign:
                    x[(o.id, w.id)] = model.NewBoolVar(f"x_{o.id}_{w.id}")

        # Intervention variables: y[int_id]
        y: Dict[str, Any] = {}
        for intervention in active_interventions:
            y[intervention.id] = model.NewBoolVar(f"y_{intervention.id}")

        # Constraint 1: At most one warehouse per order
        for o in orders:
            assigned_vars = [x[(o.id, w.id)] for w in wh_list if (o.id, w.id) in x]
            if priority_policy == PriorityPolicy.HARD and o.is_critical:
                if target_service_percentage is not None:
                    model.Add(sum(assigned_vars) == 1)
                else:
                    model.Add(sum(assigned_vars) <= 1)
            else:
                model.Add(sum(assigned_vars) <= 1)

        # Constraint 2: Stock constraints
        for w in wh_list:
            stock_vars = [
                x[(o.id, w.id)] * o.demand_units
                for o in orders
                if (o.id, w.id) in x
            ]
            added_stock = sum(
                y[i.id] * i.stock_delta
                for i in active_interventions
                if i.target_id == w.id and i.stock_delta > 0
            )
            model.Add(sum(stock_vars) <= w.effective_stock + added_stock)

        # Constraint 3: Capacity constraints
        for w in wh_list:
            cap_vars = [
                x[(o.id, w.id)]
                for o in orders
                if (o.id, w.id) in x
            ]
            added_cap = sum(
                y[i.id] * i.capacity_delta
                for i in active_interventions
                if i.target_id == w.id and i.capacity_delta > 0
            )
            model.Add(sum(cap_vars) <= w.effective_capacity + added_cap)

        # Objectives and Solving
        solver = self.cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = timeout_seconds

        all_x_vars = list(x.values())

        if target_service_percentage is None:
            # Stage A: Maximize fulfilled orders without interventions
            for intervention in active_interventions:
                model.Add(y[intervention.id] == 0)
            model.Maximize(sum(all_x_vars))
            status = solver.Solve(model)

            if status not in (self.cp_model.OPTIMAL, self.cp_model.FEASIBLE):
                return RecoveryPlan(
                    run_id=f"RUN-{network.city_id}-FAIL",
                    city_id=network.city_id,
                    target_service_requested=None,
                    achieved_service_percentage=0.0,
                    fulfilled_orders_count=0,
                    total_orders_count=len(orders),
                    service_fraction_display=f"0/{len(orders)} (0.0%)",
                    solver_status=SolverStatus.INFEASIBLE,
                    is_optimal=False,
                    solve_time_ms=0.0,
                    assignments=[],
                    unfulfilled_orders=[o.id for o in orders],
                    unfulfilled_critical_orders=[o.id for o in orders if o.is_critical],
                    selected_interventions=[],
                    baseline_cost=0.0,
                    recovery_transport_cost=0.0,
                    handling_cost=0.0,
                    emergency_intervention_cost=0.0,
                    total_recovery_cost=0.0,
                    budget_limit=budget_inr,
                    budget_shortfall=0.0,
                    is_within_budget=True,
                    limiting_constraints=["Natural recovery cannot be established."],
                    input_hash="ERR",
                )

            max_count = int(solver.ObjectiveValue())
            # Stage B: Minimize cost holding max_count
            model.Add(sum(all_x_vars) >= max_count)
            cost_terms = []
            for (o_id, w_id), var in x.items():
                r = route_map[(w_id, o_id)]
                wh = wh_map[w_id]
                cost_terms.append(var * int(round(r.cost_inr + wh.handling_cost_per_order)))
            model.Minimize(sum(cost_terms))
            status = solver.Solve(model)

        else:
            # Stage C: Target-Based Recovery
            target_count = int(math.ceil((target_service_percentage / 100.0) * len(orders)))
            model.Add(sum(all_x_vars) >= target_count)
            cost_terms = []
            for (o_id, w_id), var in x.items():
                r = route_map[(w_id, o_id)]
                wh = wh_map[w_id]
                cost_terms.append(var * int(round(r.cost_inr + wh.handling_cost_per_order)))
            for intervention in active_interventions:
                cost_terms.append(y[intervention.id] * int(round(intervention.cost_inr)))
            model.Minimize(sum(cost_terms))
            status = solver.Solve(model)

        solve_time = (time.perf_counter() - start_time) * 1000.0

        if status not in (self.cp_model.OPTIMAL, self.cp_model.FEASIBLE):
            return RecoveryPlan(
                run_id=f"RUN-{network.city_id}-INFEASIBLE",
                city_id=network.city_id,
                target_service_requested=target_service_percentage,
                achieved_service_percentage=0.0,
                fulfilled_orders_count=0,
                total_orders_count=len(orders),
                service_fraction_display=f"0/{len(orders)} (0.0% - Infeasible)",
                solver_status=SolverStatus.INFEASIBLE,
                is_optimal=False,
                solve_time_ms=solve_time,
                assignments=[],
                unfulfilled_orders=[o.id for o in orders],
                unfulfilled_critical_orders=[o.id for o in orders if o.is_critical],
                selected_interventions=[],
                baseline_cost=0.0,
                recovery_transport_cost=0.0,
                handling_cost=0.0,
                emergency_intervention_cost=0.0,
                total_recovery_cost=0.0,
                budget_limit=budget_inr,
                budget_shortfall=0.0,
                is_within_budget=True,
                limiting_constraints=["CP-SAT proved the target service is physically infeasible."],
                input_hash="INFEASIBLE",
            )

        # Build assignments
        assignments = []
        fulfilled_orders = set()
        total_t_cost = 0.0
        total_h_cost = 0.0

        for (o_id, w_id), var in x.items():
            if solver.Value(var) == 1:
                r = route_map[(w_id, o_id)]
                wh = wh_map[w_id]
                t_cost = r.cost_inr
                h_cost = wh.handling_cost_per_order
                total_t_cost += t_cost
                total_h_cost += h_cost
                o = next(item for item in orders if item.id == o_id)
                assignments.append(
                    OrderAssignment(
                        order_id=o_id,
                        warehouse_id=w_id,
                        route_id=r.id,
                        transit_time_minutes=r.transit_time_minutes,
                        deadline_minutes=o.deadline_minutes,
                        is_on_time=(r.transit_time_minutes <= o.deadline_minutes),
                        transport_cost=t_cost,
                        handling_cost=h_cost,
                        total_cost=t_cost + h_cost,
                    )
                )
                fulfilled_orders.add(o_id)

        unfulfilled = [o.id for o in orders if o.id not in fulfilled_orders]
        unfulfilled_crit = [
            o.id for o in orders if o.id not in fulfilled_orders and o.is_critical
        ]

        selected_ints = [
            intervention for intervention in active_interventions if solver.Value(y[intervention.id]) == 1
        ]
        total_int_cost = sum(i.cost_inr for i in selected_ints)

        fulfilled_count = len(fulfilled_orders)
        service_pct = round((fulfilled_count / len(orders)) * 100.0, 2)
        total_rec_cost = round(total_t_cost + total_h_cost + total_int_cost, 2)

        shortfall = max(0.0, total_rec_cost - budget_inr) if budget_inr is not None else 0.0
        within_budget = shortfall == 0.0

        is_opt = (status == self.cp_model.OPTIMAL)
        solver_stat = SolverStatus.OPTIMAL if is_opt else SolverStatus.FEASIBLE

        return RecoveryPlan(
            run_id=f"RUN-{network.city_id}-{int(time.time() * 1000)}",
            city_id=network.city_id,
            target_service_requested=target_service_percentage,
            achieved_service_percentage=service_pct,
            fulfilled_orders_count=fulfilled_count,
            total_orders_count=len(orders),
            service_fraction_display=f"{fulfilled_count}/{len(orders)} ({service_pct}%)",
            solver_status=solver_stat,
            is_optimal=is_opt,
            solve_time_ms=round(solve_time, 2),
            assignments=assignments,
            unfulfilled_orders=unfulfilled,
            unfulfilled_critical_orders=unfulfilled_crit,
            selected_interventions=selected_ints,
            baseline_cost=0.0,
            recovery_transport_cost=round(total_t_cost, 2),
            handling_cost=round(total_h_cost, 2),
            emergency_intervention_cost=round(total_int_cost, 2),
            total_recovery_cost=total_rec_cost,
            budget_limit=budget_inr,
            budget_shortfall=round(shortfall, 2),
            is_within_budget=within_budget,
            limiting_constraints=[],
            input_hash=f"{network.city_id}-CPSAT",
        )
