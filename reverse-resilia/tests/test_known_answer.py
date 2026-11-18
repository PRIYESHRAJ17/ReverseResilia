"""
Unit Test 9.1: Known-Answer Test (10 orders).
Deterministic benchmark required by the competition specification:
- W1: stock 4, capacity 4, failed
- W2: stock 5, capacity 4, active
- W3: stock 5, capacity 4, active
- 10 orders, 1 unit each, all reachable on time from W2 and W3.
- Natural max recovery: exactly 8/10 (80%).
- Interventions:
  - W2 capacity +1 for Rs. 300
  - W3 capacity +1 for Rs. 500
- Target 100%: exactly 10/10 (100%), expenditure = Rs. 800.
"""

import pytest
from backend.app.models.schemas import (
    Warehouse,
    CustomerOrder,
    TransportRoute,
    Intervention,
    InterventionType,
    DisruptionScenario,
    NetworkData,
    OptimizationRequest,
    PriorityPolicy,
    SolverStatus,
)
from backend.app.solver.engine import SolverEngine
from backend.app.verifier.independent_verifier import IndependentVerifier


def create_known_answer_fixture() -> NetworkData:
    warehouses = [
        Warehouse(
            id="W1",
            name="Warehouse 1",
            pincode="560001",
            latitude=12.9716,
            longitude=77.5946,
            stock_units=4,
            capacity_orders=4,
            handling_cost_per_order=0.0,
            is_active=True,
        ),
        Warehouse(
            id="W2",
            name="Warehouse 2",
            pincode="560002",
            latitude=12.9720,
            longitude=77.5950,
            stock_units=5,
            capacity_orders=4,
            handling_cost_per_order=0.0,
            is_active=True,
        ),
        Warehouse(
            id="W3",
            name="Warehouse 3",
            pincode="560003",
            latitude=12.9730,
            longitude=77.5960,
            stock_units=5,
            capacity_orders=4,
            handling_cost_per_order=0.0,
            is_active=True,
        ),
    ]

    orders = [
        CustomerOrder(
            id=f"O{i+1}",
            customer_name=f"Customer {i+1}",
            pincode="560004",
            latitude=12.9800,
            longitude=77.6000,
            demand_units=1,
            deadline_minutes=120,
            is_critical=False,
            baseline_warehouse_id="W1" if i < 4 else ("W2" if i < 7 else "W3"),
        )
        for i in range(10)
    ]

    routes = []
    for w in warehouses:
        for o in orders:
            routes.append(
                TransportRoute(
                    id=f"R-{w.id}-{o.id}",
                    warehouse_id=w.id,
                    order_id=o.id,
                    distance_km=10.0,
                    transit_time_minutes=30,  # All well within 120m deadline
                    cost_inr=50.0,            # Flat transport cost
                    is_open=True,
                )
            )

    interventions = [
        Intervention(
            id="INT-W2-CAP",
            name="W2 Overtime Capacity",
            type=InterventionType.EXTRA_CAPACITY,
            target_id="W2",
            cost_inr=300.0,
            stock_delta=0,
            capacity_delta=1,
            description="Increase W2 capacity by 1",
        ),
        Intervention(
            id="INT-W3-CAP",
            name="W3 Overtime Capacity",
            type=InterventionType.EXTRA_CAPACITY,
            target_id="W3",
            cost_inr=500.0,
            stock_delta=0,
            capacity_delta=1,
            description="Increase W3 capacity by 1",
        ),
    ]

    disruptions = [
        DisruptionScenario(
            id="DIS-W1-FAIL",
            name="W1 Complete Failure",
            failed_warehouse_ids=["W1"],
            closed_route_ids=[],
            capacity_reductions={},
            description="W1 fails completely",
        )
    ]

    return NetworkData(
        city_id="known-10",
        city_name="Known Answer Test Network",
        currency="INR",
        warehouses=warehouses,
        orders=orders,
        routes=routes,
        available_interventions=interventions,
        disruptions=disruptions,
    )


def test_known_answer_natural_recovery():
    network = create_known_answer_fixture()
    disruption = network.disruptions[0]
    engine = SolverEngine()

    plan = engine.calculate_max_natural_recovery(
        network=network, disruption=disruption, priority_policy=PriorityPolicy.HARD
    )

    # 1. Assert max natural recovery is exactly 8 out of 10 (80%)
    assert plan.fulfilled_orders_count == 8
    assert plan.total_orders_count == 10
    assert plan.achieved_service_percentage == 80.0
    assert plan.solver_status == SolverStatus.OPTIMAL
    assert plan.is_optimal is True
    assert plan.emergency_intervention_cost == 0.0
    assert len(plan.selected_interventions) == 0

    # 2. Verify with independent verifier
    verifier = IndependentVerifier()
    v_res = verifier.verify_plan(network, plan, disruption)
    assert v_res.is_valid is True
    assert len(v_res.violations) == 0
    assert v_res.recalculated_fulfilled_count == 8


def test_known_answer_target_100_percent_recovery():
    network = create_known_answer_fixture()
    disruption = network.disruptions[0]
    engine = SolverEngine()

    req = OptimizationRequest(
        network=network,
        disruption=disruption,
        target_service_percentage=100.0,
        budget_inr=1500.0,
        allowed_intervention_ids=["INT-W2-CAP", "INT-W3-CAP"],
        priority_policy=PriorityPolicy.HARD,
    )

    plan = engine.optimize_target_recovery(req)

    # 1. Assert achieved service is 100% (10 out of 10)
    assert plan.fulfilled_orders_count == 10
    assert plan.total_orders_count == 10
    assert plan.achieved_service_percentage == 100.0
    assert plan.solver_status == SolverStatus.OPTIMAL
    assert plan.is_optimal is True

    # 2. Assert both interventions were selected
    selected_ids = {i.id for i in plan.selected_interventions}
    assert "INT-W2-CAP" in selected_ids
    assert "INT-W3-CAP" in selected_ids

    # 3. Assert emergency intervention expenditure is exactly Rs. 800 (300 + 500)
    assert plan.emergency_intervention_cost == 800.0
    # Modeled delivery cost = 10 * Rs. 50 = Rs. 500, total = Rs. 1300
    assert plan.total_recovery_cost == 1300.0
    assert plan.is_within_budget is True
    assert plan.budget_shortfall == 0.0

    # Test that setting an insufficient budget (e.g. Rs. 1000) correctly flags shortfall without physical infeasibility
    req_tight_budget = OptimizationRequest(
        network=network,
        disruption=disruption,
        target_service_percentage=100.0,
        budget_inr=1000.0,
        allowed_intervention_ids=["INT-W2-CAP", "INT-W3-CAP"],
        priority_policy=PriorityPolicy.HARD,
    )
    plan_shortfall = engine.optimize_target_recovery(req_tight_budget)
    assert plan_shortfall.solver_status == SolverStatus.OPTIMAL
    assert plan_shortfall.is_within_budget is False
    assert plan_shortfall.budget_shortfall == 300.0

    # 4. Verify with independent verifier
    verifier = IndependentVerifier()
    v_res = verifier.verify_plan(network, plan, disruption)
    assert v_res.is_valid is True
    assert len(v_res.violations) == 0
    assert v_res.recalculated_fulfilled_count == 10
    assert v_res.recalculated_intervention_cost == 800.0
