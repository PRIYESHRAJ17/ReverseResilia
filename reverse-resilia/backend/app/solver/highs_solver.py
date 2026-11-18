"""
Mathematical Optimization Solver for ReverseResilia using HiGHS (via scipy.optimize.milp).
Solves:
- Stage A: Maximum Natural Recovery
- Stage B: Cheapest Natural Recovery
- Stage C: Target-Based Minimum-Cost Recovery
Provides exact branch-and-bound proofs of optimality and honest infeasibility diagnostics.
"""

import time
import math
import numpy as np
from typing import List, Dict, Tuple, Optional, Any
from scipy.optimize import milp, LinearConstraint, Bounds
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


class HiGHSSolver:
    """Exact Mixed-Integer Linear Programming solver backed by HiGHS."""

    def __init__(self):
        pass

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

        # Step 1: Preprocess effective network state under disruption
        wh_map: Dict[str, Warehouse] = {w.id: w.model_copy(deep=True) for w in network.warehouses}
        orders = network.orders
        routes = network.routes

        # Apply disruption
        closed_route_ids = set()
        if disruption:
            for f_id in disruption.failed_warehouse_ids:
                if f_id in wh_map:
                    wh_map[f_id].is_active = False
            for r_id in disruption.closed_route_ids:
                closed_route_ids.add(r_id)
            for w_id, red_pct in disruption.capacity_reductions.items():
                if w_id in wh_map:
                    wh_map[w_id].capacity_reduction_percent = min(100.0, max(0.0, red_pct))

        # Filter interventions
        allowed_int_ids = set(allowed_intervention_ids) if allowed_intervention_ids is not None else {
            i.id for i in network.available_interventions
        }
        active_interventions = [
            i for i in network.available_interventions if i.id in allowed_int_ids
        ]

        wh_list = list(wh_map.values())
        wh_indices = {w.id: idx for idx, w in enumerate(wh_list)}
        ord_indices = {o.id: idx for idx, o in enumerate(orders)}

        num_orders = len(orders)
        num_wh = len(wh_list)
        num_int = len(active_interventions) if target_service_percentage is not None else 0

        # Route lookup: (wh_id, ord_id) -> route
        route_map: Dict[Tuple[str, str], TransportRoute] = {
            (r.warehouse_id, r.order_id): r for r in routes
        }

        # Build feasibility matrix for (order, warehouse) assignments
        # feasible[i, j] = True if route exists, is open, wh is active, and transit time <= deadline
        feasible_assign = np.zeros((num_orders, num_wh), dtype=bool)
        for i_idx, ord_item in enumerate(orders):
            for j_idx, wh in enumerate(wh_list):
                if not wh.is_active:
                    continue
                r = route_map.get((wh.id, ord_item.id))
                if not r or not r.is_open or r.id in closed_route_ids:
                    continue
                if r.transit_time_minutes <= ord_item.deadline_minutes:
                    feasible_assign[i_idx, j_idx] = True

        # Total binary variables:
        # x[i, j] for i in 0..N-1, j in 0..M-1 (N * M vars)
        # y[k] for k in 0..K-1 (K intervention vars)
        total_vars = (num_orders * num_wh) + num_int

        def var_x(i: int, j: int) -> int:
            return i * num_wh + j

        def var_y(k: int) -> int:
            return (num_orders * num_wh) + k

        # Variable Bounds & Integrality
        lb = np.zeros(total_vars)
        ub = np.zeros(total_vars)
        integrality = np.ones(total_vars)  # all integer (binary)

        for i in range(num_orders):
            for j in range(num_wh):
                v_idx = var_x(i, j)
                if feasible_assign[i, j]:
                    ub[v_idx] = 1.0
                else:
                    ub[v_idx] = 0.0

        for k in range(num_int):
            v_idx = var_y(k)
            ub[v_idx] = 1.0

        bounds = Bounds(lb, ub)

        # Build Constraint Matrix A, lhs, rhs
        row_list = []
        lhs_list = []
        rhs_list = []

        # Constraint 1: At most one warehouse per order (or exactly 1 if hard critical)
        for i, ord_item in enumerate(orders):
            row = np.zeros(total_vars)
            for j in range(num_wh):
                row[var_x(i, j)] = 1.0
            row_list.append(row)
            if priority_policy == PriorityPolicy.HARD and ord_item.is_critical:
                # If target recovery is requested or natural recovery, check priority policy
                # In target recovery, critical orders MUST be fulfilled
                if target_service_percentage is not None:
                    lhs_list.append(1.0)
                    rhs_list.append(1.0)
                else:
                    lhs_list.append(0.0)
                    rhs_list.append(1.0)
            else:
                lhs_list.append(0.0)
                rhs_list.append(1.0)

        # Constraint 2: Stock constraints for each warehouse
        for j, wh in enumerate(wh_list):
            row = np.zeros(total_vars)
            for i, ord_item in enumerate(orders):
                row[var_x(i, j)] = float(ord_item.demand_units)
            # Interventions that add stock to this warehouse
            for k, intervention in enumerate(active_interventions[:num_int]):
                if intervention.target_id == wh.id and intervention.stock_delta > 0:
                    row[var_y(k)] = -float(intervention.stock_delta)
            row_list.append(row)
            lhs_list.append(-np.inf)
            rhs_list.append(float(wh.effective_stock))

        # Constraint 3: Processing Capacity constraints for each warehouse
        for j, wh in enumerate(wh_list):
            row = np.zeros(total_vars)
            for i in range(num_orders):
                row[var_x(i, j)] = 1.0
            # Interventions that add capacity to this warehouse
            for k, intervention in enumerate(active_interventions[:num_int]):
                if intervention.target_id == wh.id and intervention.capacity_delta > 0:
                    row[var_y(k)] = -float(intervention.capacity_delta)
            row_list.append(row)
            lhs_list.append(-np.inf)
            rhs_list.append(float(wh.effective_capacity))

        # Objective Function
        c = np.zeros(total_vars)

        if target_service_percentage is None:
            # Stage A: Maximize natural recovery (no interventions)
            # scipy milp minimizes c @ x, so set c = -1 for all x
            for i in range(num_orders):
                for j in range(num_wh):
                    c[var_x(i, j)] = -1.0
            # Also ensure all intervention vars are 0
            for k in range(num_int):
                ub[var_y(k)] = 0.0

            A = np.array(row_list)
            constraints = LinearConstraint(A, lhs_list, rhs_list)
            res = milp(c=c, integrality=integrality, bounds=bounds, constraints=constraints)

            solve_time = (time.perf_counter() - start_time) * 1000.0

            if res.status != 0:
                # Infeasible or unresolvable under hard constraints
                return self._build_infeasible_plan(
                    network=network,
                    disruption=disruption,
                    target_requested=None,
                    solve_time_ms=solve_time,
                    limiting_reasons=["Baseline natural recovery could not satisfy hard priority commitments."],
                )

            # Stage B: Now find cheapest natural recovery preserving max fulfilled count
            max_fulfilled_count = int(round(-res.fun))
            # Add constraint: total served >= max_fulfilled_count
            stage_b_rows = list(row_list)
            stage_b_lhs = list(lhs_list)
            stage_b_rhs = list(rhs_list)

            target_row = np.zeros(total_vars)
            for i in range(num_orders):
                for j in range(num_wh):
                    target_row[var_x(i, j)] = 1.0
            stage_b_rows.append(target_row)
            stage_b_lhs.append(float(max_fulfilled_count))
            stage_b_rhs.append(float(num_orders))

            # Objective: minimize transport cost + handling cost
            cost_c = np.zeros(total_vars)
            for i, ord_item in enumerate(orders):
                for j, wh in enumerate(wh_list):
                    r = route_map.get((wh.id, ord_item.id))
                    t_cost = r.cost_inr if r else 9999.0
                    h_cost = wh.handling_cost_per_order
                    cost_c[var_x(i, j)] = t_cost + h_cost

            A_b = np.array(stage_b_rows)
            constraints_b = LinearConstraint(A_b, stage_b_lhs, stage_b_rhs)
            res_b = milp(c=cost_c, integrality=integrality, bounds=bounds, constraints=constraints_b)

            solve_time = (time.perf_counter() - start_time) * 1000.0

            chosen_res = res_b if res_b.status == 0 else res
            return self._build_plan_from_solution(
                network=network,
                disruption=disruption,
                target_requested=None,
                sol_x=chosen_res.x,
                solver_status=SolverStatus.OPTIMAL if chosen_res.status == 0 else SolverStatus.FEASIBLE,
                is_optimal=(chosen_res.status == 0),
                solve_time_ms=solve_time,
                wh_list=wh_list,
                orders=orders,
                route_map=route_map,
                interventions=active_interventions[:num_int],
                budget_inr=budget_inr,
            )

        else:
            # Stage C: Target-Based Minimum-Cost Recovery
            # Required fulfilled orders:
            target_count = int(math.ceil((target_service_percentage / 100.0) * num_orders))

            # Add target constraint: sum(x_ij) >= target_count
            target_row = np.zeros(total_vars)
            for i in range(num_orders):
                for j in range(num_wh):
                    target_row[var_x(i, j)] = 1.0
            row_list.append(target_row)
            lhs_list.append(float(target_count))
            rhs_list.append(float(num_orders))

            # Objective: minimize sum(c_ij * x_ij) + sum(cost_k * y_k)
            for i, ord_item in enumerate(orders):
                for j, wh in enumerate(wh_list):
                    r = route_map.get((wh.id, ord_item.id))
                    t_cost = r.cost_inr if r else 9999.0
                    h_cost = wh.handling_cost_per_order
                    c[var_x(i, j)] = t_cost + h_cost

            for k, intervention in enumerate(active_interventions[:num_int]):
                c[var_y(k)] = float(intervention.cost_inr)

            A = np.array(row_list)
            constraints = LinearConstraint(A, lhs_list, rhs_list)
            res = milp(c=c, integrality=integrality, bounds=bounds, constraints=constraints)

            solve_time = (time.perf_counter() - start_time) * 1000.0

            if res.status != 0:
                # Target is mathematically infeasible under given constraints and interventions
                limiting = self._diagnose_infeasibility(
                    wh_list=wh_list,
                    orders=orders,
                    feasible_assign=feasible_assign,
                    interventions=active_interventions[:num_int],
                    target_count=target_count,
                    priority_policy=priority_policy,
                )
                return self._build_infeasible_plan(
                    network=network,
                    disruption=disruption,
                    target_requested=target_service_percentage,
                    solve_time_ms=solve_time,
                    limiting_reasons=limiting,
                    budget_inr=budget_inr,
                )

            return self._build_plan_from_solution(
                network=network,
                disruption=disruption,
                target_requested=target_service_percentage,
                sol_x=res.x,
                solver_status=SolverStatus.OPTIMAL,
                is_optimal=True,
                solve_time_ms=solve_time,
                wh_list=wh_list,
                orders=orders,
                route_map=route_map,
                interventions=active_interventions[:num_int],
                budget_inr=budget_inr,
            )

    def _diagnose_infeasibility(
        self,
        wh_list: List[Warehouse],
        orders: List[CustomerOrder],
        feasible_assign: np.ndarray,
        interventions: List[Intervention],
        target_count: int,
        priority_policy: PriorityPolicy,
    ) -> List[str]:
        reasons = []
        num_orders = len(orders)

        # Check total potential stock
        base_stock = sum(w.effective_stock for w in wh_list)
        extra_stock = sum(
            i.stock_delta for i in interventions if i.type == "EMERGENCY_STOCK"
        )
        total_max_stock = base_stock + extra_stock

        total_demand = sum(o.demand_units for o in orders)
        target_demand = int(math.ceil(total_demand * (target_count / num_orders)))

        if total_max_stock < target_demand:
            reasons.append(
                f"Total network inventory shortfall: Available stock ({total_max_stock} units) is less than required demand ({target_demand} units)."
            )

        # Check total potential capacity
        base_cap = sum(w.effective_capacity for w in wh_list)
        extra_cap = sum(
            i.capacity_delta for i in interventions if i.type == "EXTRA_CAPACITY"
        )
        total_max_cap = base_cap + extra_cap
        if total_max_cap < target_count:
            reasons.append(
                f"Total processing capacity shortfall: Maximum achievable capacity ({total_max_cap} orders) cannot support target ({target_count} orders)."
            )

        # Check order reachability (lanes + deadlines)
        unreachable_orders = []
        for i, ord_item in enumerate(orders):
            if not np.any(feasible_assign[i, :]):
                unreachable_orders.append(ord_item.id)

        reachable_count = num_orders - len(unreachable_orders)
        if reachable_count < target_count:
            reasons.append(
                f"Geographic/deadline disconnect: Only {reachable_count} orders can be reached on time by surviving facilities (target requires {target_count}). Unreachable orders: {', '.join(unreachable_orders[:5])}."
            )

        # Check priority commitments
        if priority_policy == PriorityPolicy.HARD:
            unreachable_critical = [
                orders[i].id
                for i in range(num_orders)
                if orders[i].is_critical and not np.any(feasible_assign[i, :])
            ]
            if unreachable_critical:
                reasons.append(
                    f"Hard priority protection failure: Critical orders {', '.join(unreachable_critical)} cannot be reached on time by any active facility."
                )

        if not reasons:
            reasons.append(
                f"Compound resource bottleneck: Individual resources are insufficient in joint regional allocation to serve {target_count} orders simultaneously."
            )

        return reasons

    def _build_plan_from_solution(
        self,
        network: NetworkData,
        disruption: Optional[DisruptionScenario],
        target_requested: Optional[float],
        sol_x: np.ndarray,
        solver_status: SolverStatus,
        is_optimal: bool,
        solve_time_ms: float,
        wh_list: List[Warehouse],
        orders: List[CustomerOrder],
        route_map: Dict[Tuple[str, str], TransportRoute],
        interventions: List[Intervention],
        budget_inr: Optional[float],
    ) -> RecoveryPlan:
        num_orders = len(orders)
        num_wh = len(wh_list)
        num_int = len(interventions)

        assignments: List[OrderAssignment] = []
        fulfilled_orders = set()
        unfulfilled_orders = []
        unfulfilled_critical = []

        total_t_cost = 0.0
        total_h_cost = 0.0

        for i, ord_item in enumerate(orders):
            assigned = False
            for j, wh in enumerate(wh_list):
                var_val = sol_x[i * num_wh + j]
                if var_val > 0.5:
                    r = route_map[(wh.id, ord_item.id)]
                    t_cost = r.cost_inr
                    h_cost = wh.handling_cost_per_order
                    tot = t_cost + h_cost
                    total_t_cost += t_cost
                    total_h_cost += h_cost
                    assignments.append(
                        OrderAssignment(
                            order_id=ord_item.id,
                            warehouse_id=wh.id,
                            route_id=r.id,
                            transit_time_minutes=r.transit_time_minutes,
                            deadline_minutes=ord_item.deadline_minutes,
                            is_on_time=(r.transit_time_minutes <= ord_item.deadline_minutes),
                            transport_cost=t_cost,
                            handling_cost=h_cost,
                            total_cost=tot,
                        )
                    )
                    fulfilled_orders.add(ord_item.id)
                    assigned = True
                    break

            if not assigned:
                unfulfilled_orders.append(ord_item.id)
                if ord_item.is_critical:
                    unfulfilled_critical.append(ord_item.id)

        # Selected Interventions
        selected_ints: List[Intervention] = []
        total_int_cost = 0.0
        for k, intervention in enumerate(interventions):
            var_val = sol_x[(num_orders * num_wh) + k]
            if var_val > 0.5:
                selected_ints.append(intervention)
                total_int_cost += intervention.cost_inr

        fulfilled_count = len(fulfilled_orders)
        service_pct = round((fulfilled_count / num_orders) * 100.0, 2)
        total_recovery_cost = round(total_t_cost + total_h_cost + total_int_cost, 2)

        budget_shortfall = 0.0
        within_budget = True
        if budget_inr is not None:
            if total_recovery_cost > budget_inr:
                budget_shortfall = round(total_recovery_cost - budget_inr, 2)
                within_budget = False

        run_id = f"RUN-{network.city_id.upper()[:3]}-{int(time.time() * 1000)}"
        input_hash = f"{network.city_id}-{disruption.id if disruption else 'NONE'}-{target_requested}-{budget_inr}"

        return RecoveryPlan(
            run_id=run_id,
            city_id=network.city_id,
            target_service_requested=target_requested,
            achieved_service_percentage=service_pct,
            fulfilled_orders_count=fulfilled_count,
            total_orders_count=num_orders,
            service_fraction_display=f"{fulfilled_count}/{num_orders} ({service_pct}%)",
            solver_status=solver_status,
            is_optimal=is_optimal,
            solve_time_ms=round(solve_time_ms, 2),
            assignments=assignments,
            unfulfilled_orders=unfulfilled_orders,
            unfulfilled_critical_orders=unfulfilled_critical,
            selected_interventions=selected_ints,
            baseline_cost=0.0,
            recovery_transport_cost=round(total_t_cost, 2),
            handling_cost=round(total_h_cost, 2),
            emergency_intervention_cost=round(total_int_cost, 2),
            total_recovery_cost=total_recovery_cost,
            budget_limit=budget_inr,
            budget_shortfall=budget_shortfall,
            is_within_budget=within_budget,
            limiting_constraints=[],
            input_hash=input_hash,
        )

    def _build_infeasible_plan(
        self,
        network: NetworkData,
        disruption: Optional[DisruptionScenario],
        target_requested: Optional[float],
        solve_time_ms: float,
        limiting_reasons: List[str],
        budget_inr: Optional[float] = None,
    ) -> RecoveryPlan:
        num_orders = len(network.orders)
        run_id = f"RUN-{network.city_id.upper()[:3]}-{int(time.time() * 1000)}"
        input_hash = f"{network.city_id}-{disruption.id if disruption else 'NONE'}-{target_requested}-{budget_inr}"

        return RecoveryPlan(
            run_id=run_id,
            city_id=network.city_id,
            target_service_requested=target_requested,
            achieved_service_percentage=0.0,
            fulfilled_orders_count=0,
            total_orders_count=num_orders,
            service_fraction_display=f"0/{num_orders} (0.0% - Infeasible)",
            solver_status=SolverStatus.INFEASIBLE,
            is_optimal=False,
            solve_time_ms=round(solve_time_ms, 2),
            assignments=[],
            unfulfilled_orders=[o.id for o in network.orders],
            unfulfilled_critical_orders=[o.id for o in network.orders if o.is_critical],
            selected_interventions=[],
            baseline_cost=0.0,
            recovery_transport_cost=0.0,
            handling_cost=0.0,
            emergency_intervention_cost=0.0,
            total_recovery_cost=0.0,
            budget_limit=budget_inr,
            budget_shortfall=0.0,
            is_within_budget=True,
            limiting_constraints=limiting_reasons,
            input_hash=input_hash,
        )
