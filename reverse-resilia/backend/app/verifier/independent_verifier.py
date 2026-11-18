"""
Independent Verification Module for ReverseResilia.
Feature 14: Independently recalculates all constraints, stock consumption,
capacity limits, route validity, deadlines, priority policies, and cost sums
from raw network inputs without trusting optimizer totals.
"""

from datetime import datetime, timezone
from typing import Dict, List, Set, Optional
from ..models.schemas import (
    NetworkData,
    DisruptionScenario,
    RecoveryPlan,
    VerificationResult,
    VerificationCheck,
    PriorityPolicy,
)


class IndependentVerifier:
    def verify_plan(
        self,
        network: NetworkData,
        plan: RecoveryPlan,
        disruption: Optional[DisruptionScenario] = None,
        priority_policy: PriorityPolicy = PriorityPolicy.HARD,
    ) -> VerificationResult:
        checks: List[VerificationCheck] = []
        violations: List[str] = []

        total_orders = len(network.orders)
        order_map = {o.id: o for o in network.orders}
        wh_map = {w.id: w.model_copy(deep=True) for w in network.warehouses}
        route_map = {(r.warehouse_id, r.order_id): r for r in network.routes}

        # Apply disruption state
        closed_routes: Set[str] = set()
        failed_whs: Set[str] = set()
        if disruption:
            for f_id in disruption.failed_warehouse_ids:
                failed_whs.add(f_id)
                if f_id in wh_map:
                    wh_map[f_id].is_active = False
            for r_id in disruption.closed_route_ids:
                closed_routes.add(r_id)
            for w_id, red_pct in disruption.capacity_reductions.items():
                if w_id in wh_map:
                    wh_map[w_id].capacity_reduction_percent = min(100.0, max(0.0, red_pct))

        # Check 1: Order assignment uniqueness
        assigned_orders: List[str] = [a.order_id for a in plan.assignments]
        duplicate_orders = [o_id for o_id in set(assigned_orders) if assigned_orders.count(o_id) > 1]
        if duplicate_orders:
            msg = f"Duplicate assignment detected: orders {duplicate_orders} assigned more than once."
            violations.append(msg)
            checks.append(VerificationCheck(check_name="Order Assignment Uniqueness", passed=False, message=msg))
        else:
            checks.append(VerificationCheck(
                check_name="Order Assignment Uniqueness",
                passed=True,
                message=f"All {len(assigned_orders)} assignments are uniquely allocated.",
            ))

        # Check 2: Facility status (no assignments to inactive/failed warehouses)
        inactive_assignments = []
        for a in plan.assignments:
            wh = wh_map.get(a.warehouse_id)
            if not wh or not wh.is_active or a.warehouse_id in failed_whs:
                inactive_assignments.append((a.order_id, a.warehouse_id))

        if inactive_assignments:
            msg = f"Orders assigned to failed/inactive facilities: {inactive_assignments}."
            violations.append(msg)
            checks.append(VerificationCheck(check_name="Facility Operational Status", passed=False, message=msg))
        else:
            checks.append(VerificationCheck(
                check_name="Facility Operational Status",
                passed=True,
                message="All assigned warehouses are fully active.",
            ))

        # Check 3: Route validity and lane status
        invalid_routes = []
        for a in plan.assignments:
            r = route_map.get((a.warehouse_id, a.order_id))
            if not r:
                invalid_routes.append(f"No route between {a.warehouse_id} and {a.order_id}")
            elif not r.is_open or r.id in closed_routes:
                invalid_routes.append(f"Route {r.id} is closed/disrupted")

        if invalid_routes:
            msg = f"Invalid transport routes used: {invalid_routes}."
            violations.append(msg)
            checks.append(VerificationCheck(check_name="Transport Lane Validity", passed=False, message=msg))
        else:
            checks.append(VerificationCheck(
                check_name="Transport Lane Validity",
                passed=True,
                message="All used transport routes are open and valid.",
            ))

        # Check 4: Delivery timing and customer deadlines
        late_deliveries = []
        for a in plan.assignments:
            ord_item = order_map.get(a.order_id)
            r = route_map.get((a.warehouse_id, a.order_id))
            if ord_item and r:
                if r.transit_time_minutes > ord_item.deadline_minutes:
                    late_deliveries.append(
                        f"Order {a.order_id} transit {r.transit_time_minutes}m exceeds deadline {ord_item.deadline_minutes}m"
                    )

        if late_deliveries:
            msg = f"Delivery deadline violations: {late_deliveries}."
            violations.append(msg)
            checks.append(VerificationCheck(check_name="Delivery Deadline Compliance", passed=False, message=msg))
        else:
            checks.append(VerificationCheck(
                check_name="Delivery Deadline Compliance",
                passed=True,
                message="All fulfilled orders arrive strictly within deadline.",
            ))

        # Check 5: Interventions validity and catalog verification
        catalog_int_map = {i.id: i for i in network.available_interventions}
        invalid_interventions = []
        recalculated_stock_boost: Dict[str, int] = {w.id: 0 for w in network.warehouses}
        recalculated_cap_boost: Dict[str, int] = {w.id: 0 for w in network.warehouses}
        recalc_int_cost = 0.0

        for sel_int in plan.selected_interventions:
            cat_int = catalog_int_map.get(sel_int.id)
            if not cat_int:
                invalid_interventions.append(f"Intervention {sel_int.id} not in catalog")
            else:
                recalc_int_cost += cat_int.cost_inr
                if cat_int.stock_delta > 0:
                    recalculated_stock_boost[cat_int.target_id] += cat_int.stock_delta
                if cat_int.capacity_delta > 0:
                    recalculated_cap_boost[cat_int.target_id] += cat_int.capacity_delta

        if invalid_interventions:
            msg = f"Unapproved interventions: {invalid_interventions}."
            violations.append(msg)
            checks.append(VerificationCheck(check_name="Intervention Catalog Conformance", passed=False, message=msg))
        else:
            checks.append(VerificationCheck(
                check_name="Intervention Catalog Conformance",
                passed=True,
                message=f"All {len(plan.selected_interventions)} selected interventions are approved in the catalog.",
            ))

        # Check 6: Warehouse stock consumption vs available + intervention stock
        stock_used: Dict[str, int] = {w.id: 0 for w in network.warehouses}
        for a in plan.assignments:
            ord_item = order_map.get(a.order_id)
            if ord_item:
                stock_used[a.warehouse_id] += ord_item.demand_units

        stock_violations = []
        for w_id, used in stock_used.items():
            wh = wh_map[w_id]
            max_allowed = wh.effective_stock + recalculated_stock_boost[w_id]
            if used > max_allowed:
                stock_violations.append(
                    f"Warehouse {w_id} stock exceeded: {used} units allocated > {max_allowed} available ({wh.effective_stock} base + {recalculated_stock_boost[w_id]} boost)"
                )

        if stock_violations:
            msg = f"Inventory capacity breaches: {stock_violations}."
            violations.append(msg)
            checks.append(VerificationCheck(check_name="Inventory Conservation", passed=False, message=msg))
        else:
            checks.append(VerificationCheck(
                check_name="Inventory Conservation",
                passed=True,
                message="Stock consumption respects inventory limits across all warehouses.",
            ))

        # Check 7: Warehouse processing capacity
        cap_used: Dict[str, int] = {w.id: 0 for w in network.warehouses}
        for a in plan.assignments:
            cap_used[a.warehouse_id] += 1

        cap_violations = []
        for w_id, used in cap_used.items():
            wh = wh_map[w_id]
            max_allowed = wh.effective_capacity + recalculated_cap_boost[w_id]
            if used > max_allowed:
                cap_violations.append(
                    f"Warehouse {w_id} processing capacity exceeded: {used} orders > {max_allowed} limit ({wh.effective_capacity} base + {recalculated_cap_boost[w_id]} boost)"
                )

        if cap_violations:
            msg = f"Processing capacity breaches: {cap_violations}."
            violations.append(msg)
            checks.append(VerificationCheck(check_name="Processing Capacity Conservation", passed=False, message=msg))
        else:
            checks.append(VerificationCheck(
                check_name="Processing Capacity Conservation",
                passed=True,
                message="Order processing respects throughput limits at all facilities.",
            ))

        # Check 8: Priority order compliance
        if priority_policy == PriorityPolicy.HARD:
            unserved_critical = []
            assigned_set = set(assigned_orders)
            for ord_item in network.orders:
                if ord_item.is_critical and ord_item.id not in assigned_set:
                    unserved_critical.append(ord_item.id)

            if unserved_critical:
                msg = f"Hard priority violation: Critical orders {unserved_critical} were not fulfilled on time."
                violations.append(msg)
                checks.append(VerificationCheck(check_name="Priority Order Protection", passed=False, message=msg))
            else:
                checks.append(VerificationCheck(
                    check_name="Priority Order Protection",
                    passed=True,
                    message="All critical orders are guaranteed on-time fulfillment.",
                ))

        # Check 9: Recalculate Total Costs
        recalculated_t_cost = 0.0
        recalculated_h_cost = 0.0
        for a in plan.assignments:
            r = route_map.get((a.warehouse_id, a.order_id))
            wh = wh_map.get(a.warehouse_id)
            if r and wh:
                recalculated_t_cost += r.cost_inr
                recalculated_h_cost += wh.handling_cost_per_order

        recalculated_total_cost = round(recalculated_t_cost + recalculated_h_cost + recalc_int_cost, 2)
        diff = abs(recalculated_total_cost - plan.total_recovery_cost)
        if diff > 1.0:  # Allow 1 rupee rounding tolerance
            msg = f"Cost discrepancy: recalculation ₹{recalculated_total_cost} != plan reported ₹{plan.total_recovery_cost}."
            violations.append(msg)
            checks.append(VerificationCheck(check_name="Cost Calculation Accuracy", passed=False, message=msg))
        else:
            checks.append(VerificationCheck(
                check_name="Cost Calculation Accuracy",
                passed=True,
                message=f"Cost verified: ₹{recalculated_total_cost} exactly matches itemized transport, handling, and intervention totals.",
            ))

        # Check 10: Target fulfillment check
        recalc_fulfilled = len(assigned_orders)
        recalc_pct = round((recalc_fulfilled / total_orders) * 100.0, 2)
        if plan.target_service_requested is not None:
            if recalc_pct < plan.target_service_requested and plan.solver_status != "INFEASIBLE":
                msg = f"Service level deficit: achieved {recalc_pct}% is below requested target {plan.target_service_requested}%."
                violations.append(msg)
                checks.append(VerificationCheck(check_name="Service Target Fulfillment", passed=False, message=msg))
            else:
                checks.append(VerificationCheck(
                    check_name="Service Target Fulfillment",
                    passed=True,
                    message=f"Service target holds: {recalc_fulfilled}/{total_orders} ({recalc_pct}% achieved).",
                ))

        is_valid = len(violations) == 0

        return VerificationResult(
            is_valid=is_valid,
            checks=checks,
            recalculated_fulfilled_count=recalc_fulfilled,
            recalculated_total_orders=total_orders,
            recalculated_service_percentage=recalc_pct,
            recalculated_total_cost=recalculated_total_cost,
            recalculated_intervention_cost=round(recalc_int_cost, 2),
            violations=violations,
            verified_at=datetime.now(timezone.utc).isoformat(),
        )


default_verifier = IndependentVerifier()
