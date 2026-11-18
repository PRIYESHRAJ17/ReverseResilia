"""
Unit tests for Solver Stages:
- Stage A: Maximum Natural Recovery
- Stage B: Cheapest Natural Recovery
- Stage C: Target-Based Recovery
- Budget Shortfall vs Physical Infeasibility
- Honest Infeasibility Diagnostics
"""

import pytest
from backend.app.models.schemas import (
    OptimizationRequest,
    PriorityPolicy,
    SolverStatus,
    DisruptionScenario,
)
from backend.app.solver.engine import SolverEngine
from tests.test_known_answer import create_known_answer_fixture


def test_stage_b_preserves_maximum_fulfilled_orders():
    network = create_known_answer_fixture()
    engine = SolverEngine()
    disruption = network.disruptions[0]

    # Vary route costs to make Stage B meaningfully differentiate cost
    for r in network.routes:
        if r.warehouse_id == "W2":
            r.cost_inr = 80.0
        elif r.warehouse_id == "W3":
            r.cost_inr = 20.0

    plan = engine.calculate_max_natural_recovery(network, disruption)

    # Must preserve max natural recovery (8 orders)
    assert plan.fulfilled_orders_count == 8
    # W3 was cheaper (20 INR vs 80 INR) and had capacity 4.
    # W3 should be fully saturated with 4 orders!
    w3_assigned = sum(1 for a in plan.assignments if a.warehouse_id == "W3")
    assert w3_assigned == 4


def test_budget_shortfall_is_honest():
    """Test that insufficient budget does not falsely trigger physical infeasibility."""
    network = create_known_answer_fixture()
    engine = SolverEngine()
    disruption = network.disruptions[0]

    # Target 100% requires Rs. 800 in interventions + route costs
    # Set user budget to Rs. 200 (insufficient)
    req = OptimizationRequest(
        network=network,
        disruption=disruption,
        target_service_percentage=100.0,
        budget_inr=200.0,
        allowed_intervention_ids=["INT-W2-CAP", "INT-W3-CAP"],
    )

    plan = engine.optimize_target_recovery(req)

    # The plan must still be found mathematically, not marked physically infeasible!
    assert plan.solver_status == SolverStatus.OPTIMAL
    assert plan.fulfilled_orders_count == 10
    assert plan.is_within_budget is False
    assert plan.budget_shortfall > 0.0
    assert plan.budget_limit == 200.0


def test_honest_infeasibility_when_physically_impossible():
    """Test that when a target is physically unachievable, solver reports INFEASIBLE with limiting diagnostics."""
    network = create_known_answer_fixture()
    engine = SolverEngine()
    disruption = network.disruptions[0]

    # Disallow all interventions
    req = OptimizationRequest(
        network=network,
        disruption=disruption,
        target_service_percentage=100.0,
        allowed_intervention_ids=[],  # No interventions permitted
    )

    plan = engine.optimize_target_recovery(req)

    # Maximum achievable is only 8 orders (80%). Requesting 100% must be INFEASIBLE.
    assert plan.solver_status == SolverStatus.INFEASIBLE
    assert plan.fulfilled_orders_count == 0
    assert plan.total_recovery_cost == 0.0  # Must NOT fabricate costs
    assert len(plan.limiting_constraints) > 0
