"""
Integration tests for the 5 Selectable City Datasets:
- Bengaluru
- Mumbai
- Delhi NCR
- Chennai
- Guwahati
Verifies that all 5 cities load valid networks, support disruption impact analysis,
and run natural recovery and target recovery with independent verification.
"""

import pytest
from backend.app.data.loader import DataLoader
from backend.app.solver.engine import SolverEngine
from backend.app.verifier.independent_verifier import IndependentVerifier
from backend.app.models.schemas import OptimizationRequest, PriorityPolicy


@pytest.fixture
def loader():
    return DataLoader()


@pytest.fixture
def engine():
    return SolverEngine()


@pytest.fixture
def verifier():
    return IndependentVerifier()


def test_all_five_cities_load_and_validate(loader):
    cities = loader.get_supported_cities()
    assert len(cities) == 5

    for c in cities:
        network = loader.load_city_network(c["id"])
        assert network.city_id == c["id"]
        assert len(network.warehouses) >= 3
        assert len(network.orders) >= 20
        assert len(network.routes) > 0
        assert len(network.disruptions) >= 3
        assert len(network.available_interventions) > 0

        # Verify real coordinates are within India's lat/lng bounds
        for w in network.warehouses:
            assert 8.0 <= w.latitude <= 37.0
            assert 68.0 <= w.longitude <= 98.0
            assert w.stock_units > 0
            assert w.capacity_orders > 0

        for o in network.orders:
            assert 8.0 <= o.latitude <= 37.0
            assert 68.0 <= o.longitude <= 98.0
            assert o.deadline_minutes > 0


@pytest.mark.parametrize("city_id", ["bengaluru", "mumbai", "delhi", "chennai", "guwahati"])
def test_city_recovery_pipeline(loader, engine, verifier, city_id):
    network = loader.load_city_network(city_id)
    disruption = network.disruptions[0]  # Primary hub outage

    # 1. Immediate Impact Analysis
    impact = engine.analyze_immediate_impact(network, disruption)
    assert impact.total_orders == len(network.orders)
    assert len(impact.immediately_disrupted_orders) > 0
    assert impact.immediate_service_percentage < 100.0

    # 2. Maximum Natural Recovery
    natural_plan = engine.calculate_max_natural_recovery(network, disruption)
    assert natural_plan.achieved_service_percentage >= impact.immediate_service_percentage
    assert natural_plan.emergency_intervention_cost == 0.0

    # 3. Independent Verification of Natural Plan
    v_nat = verifier.verify_plan(network, natural_plan, disruption)
    assert v_nat.is_valid is True
    assert len(v_nat.violations) == 0

    # 4. Target Recovery (e.g. 100% or high target with permitted interventions)
    req = OptimizationRequest(
        network=network,
        disruption=disruption,
        target_service_percentage=90.0,
        budget_inr=50000.0,
        allowed_intervention_ids=[i.id for i in network.available_interventions],
        priority_policy=PriorityPolicy.HARD,
    )
    target_plan = engine.optimize_target_recovery(req)

    # 5. Independent Verification of Target Plan
    if target_plan.solver_status in ("OPTIMAL", "FEASIBLE"):
        v_target = verifier.verify_plan(network, target_plan, disruption)
        assert v_target.is_valid is True
        assert len(v_target.violations) == 0
        assert v_target.recalculated_fulfilled_count >= int(0.9 * len(network.orders))
