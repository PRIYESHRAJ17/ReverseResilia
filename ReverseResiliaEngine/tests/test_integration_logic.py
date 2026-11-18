from backend.main import Pricing, price_routes
from backend.models import Package
from backend.solver import solve
from backend.verifier import verify
from tests.test_model import case
from tests.test_api import client


def test_package_arrival_respects_individual_deadlines(case):
    for p in case.network.packages:
        p.lead_min = 56
    assert solve(case, "C").solver_status == "INFEASIBLE"
    for order in case.network.orders:
        order.deadline_min = 61
    plan = solve(case, "C")
    assert max(plan.completion_min.values()) == 61 and verify(case, plan, "C").passed
    plan.completion_min = {k:5 for k in plan.assignments}
    assert not verify(case, plan, "C").passed


def test_budget_comparison_and_json_export(client, case):
    response = client.post("/api/recovery/optimize", json=case.model_dump()).json()
    assert response["plan"]["budget_gap"] == 50
    assert response["budget_maximum_proven"] and response["budget_verification"]["passed"]
    assert response["budget_plan"]["achieved"] == 9 and response["budget_plan"]["total_inr"] == 390
    assert client.get("/api/runs/"+response["run_id"]+"/export?plan=budget").status_code == 200
    saved = client.get("/api/runs/"+response["run_id"]+"/scenario").json()
    assert client.post("/api/scenarios/validate", json=saved).json() == case.model_dump()


def test_orders_capacity_and_pricing(client,case):
    network = case.network.model_dump()
    network["warehouses"][0]["stock_units"] = 2
    assert client.post("/api/network/validate",json=network).json()["warehouses"][0]["capacity_orders"] == 2
    header = "id,site_order_id,quantity_units"
    rows = [f"NEW-{i},O0,2" for i in range(250)]
    body = dict(network=network,table="orders",csv_text="\n".join([header]+rows))
    updated = client.post("/api/network/import", json=body).json()
    assert len(updated["orders"]) == 260 and len(updated["lanes"]) == 780
    body["csv_text"] += "\nNEW-0,O0,1"
    assert client.post("/api/network/import",json=body).status_code == 422
    quotes = price_routes(Pricing(network=case.network,speed_kmh=30,dispatch_min=7,fee_inr=15,inr_per_km=12))
    assert quotes.lanes[0].travel_min==8 and quotes.lanes[0].cost_inr==17


def test_closed_route_waits_for_activation(case):
    case.disruption.kind="closure"
    case.disruption.entity="W2-O0"
    for lane in case.network.lanes:
        if lane.order=="O0" and lane.id!="W2-O0":
            lane.available=False
    case.protect_critical=True
    case.network.packages.append(Package(id="T",kind="transport",warehouse="W2",lane="W2-O0",amount=1,price_inr=1,lead_min=55))
    case.allowed.append("T")
    plan=solve(case,"C")
    assert plan.completion_min["W2-O0"]==60 and verify(case,plan,"C").passed
    case.network.packages[-1].lead_min+=1
    assert solve(case,"C").solver_status=="INFEASIBLE"


def test_fractional_target(case):
    case.target_pct=80.01
    p=solve(case,"C")
    assert p.achieved==9 and verify(case,p,"C").passed
