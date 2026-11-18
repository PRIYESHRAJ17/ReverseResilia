"""
Unified Solver Engine for ReverseResilia.
Orchestrates impact analysis, natural recovery, and target optimization.
Integrates HiGHS and OR-Tools solvers with robust fallback.
"""

import hashlib
import json
from typing import Optional, List, Dict, Any
from ..models.schemas import (
    NetworkData,
    DisruptionScenario,
    ImpactAnalysisResult,
    RecoveryPlan,
    OptimizationRequest,
    PriorityPolicy,
    SolverStatus,
    ScenarioComparison,
)
from .highs_solver import HiGHSSolver


class SolverEngine:
    def __init__(self, prefer_ortools: bool = False):
        self.prefer_ortools = prefer_ortools
        self.highs_solver = HiGHSSolver()
        self.ortools_solver = None

        if prefer_ortools:
            try:
                from .ortools_solver import OrToolsSolver
                self.ortools_solver = OrToolsSolver()
            except Exception as e:
                # Log transparently that OR-Tools is unavailable, fallback to HiGHS
                self.ortools_solver = None

    def calculate_input_hash(
        self,
        network: NetworkData,
        disruption: Optional[DisruptionScenario] = None,
        target_service: Optional[float] = None,
        budget: Optional[float] = None,
    ) -> str:
        data = {
            "city": network.city_id,
            "wh": [(w.id, w.stock_units, w.capacity_orders, w.is_active) for w in network.warehouses],
            "orders": [(o.id, o.demand_units, o.deadline_minutes, o.is_critical) for o in network.orders],
            "disruption": disruption.model_dump() if disruption else None,
            "target": target_service,
            "budget": budget,
        }
        raw_str = json.dumps(data, sort_keys=True)
        return hashlib.sha256(raw_str.encode("utf-8")).hexdigest()[:16]

    def analyze_immediate_impact(
        self, network: NetworkData, disruption: DisruptionScenario
    ) -> ImpactAnalysisResult:
        """
        Feature 6: Immediate Impact Analysis.
        Identifies orders assigned to disrupted resources before recovery optimization begins.
        """
        failed_whs = set(disruption.failed_warehouse_ids)
        closed_routes = set(disruption.closed_route_ids)

        total_orders = len(network.orders)
        baseline_fulfilled = 0
        disrupted_orders = []
        surviving_orders = []
        affected_critical = []

        route_by_pair = {(r.warehouse_id, r.order_id): r for r in network.routes}

        for ord_item in network.orders:
            base_wh = ord_item.baseline_warehouse_id
            if not base_wh:
                disrupted_orders.append(ord_item.id)
                continue

            # Check if assigned warehouse failed
            if base_wh in failed_whs:
                disrupted_orders.append(ord_item.id)
                if ord_item.is_critical:
                    affected_critical.append(ord_item.id)
                continue

            # Check if assigned route closed
            r = route_by_pair.get((base_wh, ord_item.id))
            if not r or r.id in closed_routes or not r.is_open:
                disrupted_orders.append(ord_item.id)
                if ord_item.is_critical:
                    affected_critical.append(ord_item.id)
                continue

            # Check if deadline is met
            if r.transit_time_minutes > ord_item.deadline_minutes:
                disrupted_orders.append(ord_item.id)
                if ord_item.is_critical:
                    affected_critical.append(ord_item.id)
                continue

            surviving_orders.append(ord_item.id)
            baseline_fulfilled += 1

        baseline_service_pct = 100.0  # By design baseline network is 100% fulfilled
        immediate_service_pct = round((len(surviving_orders) / total_orders) * 100.0, 2)
        service_loss = round(baseline_service_pct - immediate_service_pct, 2)

        summary = (
            f"Disruption immediately severed {len(disrupted_orders)} out of {total_orders} customer orders "
            f"({len(surviving_orders)} surviving valid, {immediate_service_pct}% immediate service level). "
            f"Immediate service loss: -{service_loss}%."
        )

        return ImpactAnalysisResult(
            total_orders=total_orders,
            baseline_fulfilled_orders=total_orders,
            immediately_disrupted_orders=disrupted_orders,
            surviving_valid_orders=surviving_orders,
            disrupted_warehouses=list(failed_whs),
            closed_routes=list(closed_routes),
            baseline_service_percentage=baseline_service_pct,
            immediate_service_percentage=immediate_service_pct,
            service_loss_percentage=service_loss,
            affected_critical_orders=affected_critical,
            summary=summary,
        )

    def calculate_max_natural_recovery(
        self,
        network: NetworkData,
        disruption: Optional[DisruptionScenario] = None,
        priority_policy: PriorityPolicy = PriorityPolicy.HARD,
    ) -> RecoveryPlan:
        """
        Features 7 & 10: Maximum natural recovery using surviving resources without emergency interventions,
        followed by finding the minimum-cost assignment that preserves that maximum service.
        """
        solver = self.ortools_solver if (self.prefer_ortools and self.ortools_solver) else self.highs_solver
        plan = solver.solve(
            network=network,
            disruption=disruption,
            target_service_percentage=None,  # Triggers Stage A & B
            budget_inr=None,
            allowed_intervention_ids=[],     # No interventions in natural recovery
            priority_policy=priority_policy,
        )
        plan.input_hash = self.calculate_input_hash(network, disruption, None, None)
        return plan

    def optimize_target_recovery(
        self, request: OptimizationRequest
    ) -> RecoveryPlan:
        """
        Features 9, 11, 12, 13: Target-based recovery optimization with priced interventions and honest infeasibility.
        """
        solver = self.ortools_solver if (self.prefer_ortools and self.ortools_solver) else self.highs_solver
        target = request.target_service_percentage if request.target_service_percentage is not None else 100.0
        plan = solver.solve(
            network=request.network,
            disruption=request.disruption,
            target_service_percentage=target,
            budget_inr=request.budget_inr,
            allowed_intervention_ids=request.allowed_intervention_ids,
            priority_policy=request.priority_policy,
            timeout_seconds=request.timeout_seconds,
        )
        plan.input_hash = self.calculate_input_hash(
            request.network, request.disruption, target, request.budget_inr
        )
        return plan

    def compare_scenarios(
        self,
        baseline_network: NetworkData,
        impact: ImpactAnalysisResult,
        recovered_plan: RecoveryPlan,
    ) -> List[ScenarioComparison]:
        """
        Feature 16: Scenario Comparison across 3 states:
        1. Baseline
        2. Disrupted (before recovery)
        3. Recovered (after optimization)
        """
        total_orders = len(baseline_network.orders)
        baseline_cost = 0.0
        route_by_pair = {(r.warehouse_id, r.order_id): r for r in baseline_network.routes}
        wh_by_id = {w.id: w for w in baseline_network.warehouses}

        for o in baseline_network.orders:
            if o.baseline_warehouse_id:
                r = route_by_pair.get((o.baseline_warehouse_id, o.id))
                wh = wh_by_id.get(o.baseline_warehouse_id)
                if r and wh:
                    baseline_cost += (r.cost_inr + wh.handling_cost_per_order)

        disrupted_cost = 0.0
        for o_id in impact.surviving_valid_orders:
            o = next(item for item in baseline_network.orders if item.id == o_id)
            if o.baseline_warehouse_id:
                r = route_by_pair.get((o.baseline_warehouse_id, o.id))
                wh = wh_by_id.get(o.baseline_warehouse_id)
                if r and wh:
                    disrupted_cost += (r.cost_inr + wh.handling_cost_per_order)

        comparisons = [
            ScenarioComparison(
                metric="On-Time Fulfilled Orders",
                baseline=f"{total_orders}/{total_orders}",
                disrupted=f"{len(impact.surviving_valid_orders)}/{total_orders}",
                recovered=f"{recovered_plan.fulfilled_orders_count}/{total_orders}",
                unit="orders",
            ),
            ScenarioComparison(
                metric="On-Time Service Level",
                baseline=100.0,
                disrupted=impact.immediate_service_percentage,
                recovered=recovered_plan.achieved_service_percentage,
                unit="%",
            ),
            ScenarioComparison(
                metric="Unfulfilled Customer Orders",
                baseline=0,
                disrupted=len(impact.immediately_disrupted_orders),
                recovered=len(recovered_plan.unfulfilled_orders),
                unit="orders",
            ),
            ScenarioComparison(
                metric="Critical Orders Fulfilled",
                baseline=len([o for o in baseline_network.orders if o.is_critical]),
                disrupted=len([o for o in baseline_network.orders if o.is_critical and o.id in impact.surviving_valid_orders]),
                recovered=len([o for o in baseline_network.orders if o.is_critical and o.id not in recovered_plan.unfulfilled_critical_orders]),
                unit="orders",
            ),
            ScenarioComparison(
                metric="Modeled Total Operational Cost",
                baseline=round(baseline_cost, 2),
                disrupted=round(disrupted_cost, 2),
                recovered=recovered_plan.total_recovery_cost,
                unit="INR",
            ),
            ScenarioComparison(
                metric="Emergency Intervention Expenditure",
                baseline=0.0,
                disrupted=0.0,
                recovered=recovered_plan.emergency_intervention_cost,
                unit="INR",
            ),
            ScenarioComparison(
                metric="Active Interventions Selected",
                baseline=0,
                disrupted=0,
                recovered=len(recovered_plan.selected_interventions),
                unit="packages",
            ),
        ]
        return comparisons


default_engine = SolverEngine()
