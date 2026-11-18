"""
API End-to-End Integration tests using FastAPI TestClient.
Tests all endpoints from the API contract:
- GET /api/health
- GET /api/cities
- GET /api/network/{city_id}
- POST /api/network/validate
- POST /api/scenarios/impact
- POST /api/recovery/max-service
- POST /api/recovery/optimize
- POST /api/recovery/verify
- POST /api/scenarios/compare
- GET /api/runs/{run_id}/export
"""

import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


def test_health_endpoint():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert "solvers" in data


def test_cities_endpoint():
    resp = client.get("/api/cities")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 5
    city_ids = [c["id"] for c in data]
    assert "bengaluru" in city_ids
    assert "mumbai" in city_ids
    assert "delhi" in city_ids
    assert "chennai" in city_ids
    assert "guwahati" in city_ids


def test_network_and_validation():
    resp = client.get("/api/network/bengaluru")
    assert resp.status_code == 200
    network = resp.json()
    assert network["city_id"] == "bengaluru"
    assert len(network["warehouses"]) >= 3

    # Validate valid network
    v_resp = client.post("/api/network/validate", json=network)
    assert v_resp.status_code == 200
    v_data = v_resp.json()
    assert v_data["valid"] is True


def test_scenario_impact_and_recovery():
    # 1. Load Bengaluru
    net_resp = client.get("/api/network/bengaluru")
    network = net_resp.json()
    disruption = network["disruptions"][0]

    # 2. Immediate Impact
    impact_resp = client.post(
        "/api/scenarios/impact",
        json={"network": network, "disruption": disruption},
    )
    assert impact_resp.status_code == 200
    impact = impact_resp.json()
    assert "immediately_disrupted_orders" in impact

    # 3. Max Natural Recovery
    max_rec_resp = client.post(
        "/api/recovery/max-service",
        json={"network": network, "disruption": disruption},
    )
    assert max_rec_resp.status_code == 200
    natural_plan = max_rec_resp.json()
    assert natural_plan["achieved_service_percentage"] > 0

    # 4. Target Optimization
    opt_resp = client.post(
        "/api/recovery/optimize",
        json={
            "network": network,
            "disruption": disruption,
            "target_service_percentage": 100.0,
            "budget_inr": 25000.0,
            "allowed_intervention_ids": [i["id"] for i in network["available_interventions"]],
            "priority_policy": "HARD",
        },
    )
    assert opt_resp.status_code == 200
    opt_plan = opt_resp.json()
    run_id = opt_plan["run_id"]

    # 5. Independent Verification via API
    ver_resp = client.post(
        "/api/recovery/verify",
        json={
            "network": network,
            "plan": opt_plan,
            "disruption": disruption,
            "priority_policy": "HARD",
        },
    )
    assert ver_resp.status_code == 200
    ver_result = ver_resp.json()
    assert ver_result["is_valid"] is True

    # 6. Scenario Comparison
    comp_resp = client.post(
        "/api/scenarios/compare",
        json={
            "network": network,
            "disruption": disruption,
            "plan": opt_plan,
        },
    )
    assert comp_resp.status_code == 200
    comparisons = comp_resp.json()
    assert len(comparisons) >= 5

    # 7. CSV Export
    export_resp = client.get(f"/api/runs/{run_id}/export")
    assert export_resp.status_code == 200
    assert "text/csv" in export_resp.headers["content-type"]
    assert "ORDER RECOVERY ASSIGNMENTS" in export_resp.text
