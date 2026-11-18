"""
Unit tests for the Independent Verifier Module.
Tests that valid plans pass and deliberately corrupted plans are strictly rejected.
"""

import pytest
from backend.app.models.schemas import OrderAssignment
from backend.app.verifier.independent_verifier import IndependentVerifier
from backend.app.solver.engine import SolverEngine
from tests.test_known_answer import create_known_answer_fixture


def test_verifier_accepts_valid_plan():
    network = create_known_answer_fixture()
    engine = SolverEngine()
    plan = engine.calculate_max_natural_recovery(network, network.disruptions[0])

    verifier = IndependentVerifier()
    res = verifier.verify_plan(network, plan, network.disruptions[0])

    assert res.is_valid is True
    assert len(res.violations) == 0


def test_verifier_rejects_duplicate_order_assignment():
    network = create_known_answer_fixture()
    engine = SolverEngine()
    plan = engine.calculate_max_natural_recovery(network, network.disruptions[0])

    # Corrupt plan: duplicate the first assignment with another warehouse
    corrupted_plan = plan.model_copy(deep=True)
    first_a = corrupted_plan.assignments[0]
    corrupted_plan.assignments.append(
        OrderAssignment(
            order_id=first_a.order_id,
            warehouse_id="W3",
            route_id=f"R-W3-{first_a.order_id}",
            transit_time_minutes=30,
            deadline_minutes=120,
            is_on_time=True,
            transport_cost=50.0,
            handling_cost=0.0,
            total_cost=50.0,
        )
    )

    verifier = IndependentVerifier()
    res = verifier.verify_plan(network, corrupted_plan, network.disruptions[0])

    assert res.is_valid is False
    assert any("Duplicate assignment detected" in v for v in res.violations)


def test_verifier_rejects_assignment_to_failed_warehouse():
    network = create_known_answer_fixture()
    engine = SolverEngine()
    plan = engine.calculate_max_natural_recovery(network, network.disruptions[0])

    # Corrupt plan: assign an order to W1 (which is failed in this disruption)
    corrupted_plan = plan.model_copy(deep=True)
    corrupted_plan.assignments[0].warehouse_id = "W1"

    verifier = IndependentVerifier()
    res = verifier.verify_plan(network, corrupted_plan, network.disruptions[0])

    assert res.is_valid is False
    assert any("failed/inactive facilities" in v for v in res.violations)


def test_verifier_rejects_stock_overflow():
    network = create_known_answer_fixture()
    engine = SolverEngine()
    plan = engine.calculate_max_natural_recovery(network, network.disruptions[0])

    # Corrupt plan: artificially inflate order demand or reduce warehouse stock
    corrupted_network = network.model_copy(deep=True)
    # W2 has 5 stock. Allocate 6 units to W2
    for w in corrupted_network.warehouses:
        if w.id == "W2":
            w.stock_units = 1  # W2 now only has 1 unit, but plan assigned multiple

    verifier = IndependentVerifier()
    res = verifier.verify_plan(corrupted_network, plan, network.disruptions[0])

    assert res.is_valid is False
    assert any("stock exceeded" in v for v in res.violations)


def test_verifier_rejects_deadline_violation():
    network = create_known_answer_fixture()
    engine = SolverEngine()
    plan = engine.calculate_max_natural_recovery(network, network.disruptions[0])

    # Corrupt network: set customer deadline to 10 minutes, but route is 30 minutes
    corrupted_network = network.model_copy(deep=True)
    first_assigned_id = plan.assignments[0].order_id
    for o in corrupted_network.orders:
        if o.id == first_assigned_id:
            o.deadline_minutes = 10

    verifier = IndependentVerifier()
    res = verifier.verify_plan(corrupted_network, plan, network.disruptions[0])

    assert res.is_valid is False
    assert any("deadline violations" in v for v in res.violations)


def test_verifier_rejects_fabricated_costs():
    network = create_known_answer_fixture()
    engine = SolverEngine()
    plan = engine.calculate_max_natural_recovery(network, network.disruptions[0])

    # Corrupt plan: tamper with reported total recovery cost
    corrupted_plan = plan.model_copy(deep=True)
    corrupted_plan.total_recovery_cost = 999999.0

    verifier = IndependentVerifier()
    res = verifier.verify_plan(network, corrupted_plan, network.disruptions[0])

    assert res.is_valid is False
    assert any("Cost discrepancy" in v for v in res.violations)
