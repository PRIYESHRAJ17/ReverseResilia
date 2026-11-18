import csv
import io
import pytest
from fastapi.testclient import TestClient
from backend.main import CITIES, app
from tests.test_model import case


@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv("RESILIA_DB",str(tmp_path/"runs.sqlite"))
    return TestClient(app)


def test_api_run_export_and_edit(client,case):
    inputs=case.model_dump()
    before=client.post("/api/scenarios/impact",json=inputs).json()
    assert len(before["preserved"])+len(before["affected"])==before["baseline"]["achieved"]
    assert before["affected"]
    assert client.post("/api/recovery/max-service",json=inputs).json()["plan"]["achieved"]==8
    result=client.post("/api/recovery/optimize",json=inputs).json()
    assert result["verification"]["passed"]
    run_url="/api/runs/"+result["run_id"]
    assert client.get(run_url).json()==result
    rows=list(csv.DictReader(io.StringIO(client.get(run_url+"/export").text)))
    assert len(rows)==10 and {r["total_inr_plan"] for r in rows}=={"900"}
    inputs["network"]["warehouses"][1]["stock_units"]=0
    changed=client.post("/api/recovery/optimize",json=inputs).json()
    assert changed["plan"]["solver_status"]=="INFEASIBLE"
    assert client.get("/api/runs/"+changed["run_id"]+"/export").status_code==409
    evidence=client.post("/api/recovery/verify",json={"scenario":inputs,"plan":result["plan"]}).json()
    assert not evidence["passed"] and evidence["checks"]["Identity"]


def test_validation(client,case):
    n=case.network.model_dump()
    n["lanes"][0]["warehouse"]="missing"
    assert client.post("/api/network/validate",json=n).status_code==422
    assert client.get("/api/network/missing").status_code==404


def test_csv_import_atomic(client,case):
    request={"network":case.network.model_dump(),"table":"warehouses","csv_text":"id,stock_units,active\nW2,9,false"}
    changed=client.post("/api/network/import",json=request)
    assert changed.status_code==200
    assert changed.json()["warehouses"][1]["stock_units"]==9
    assert not changed.json()["warehouses"][1]["active"]
    request["csv_text"]+="\nW2,20,true"
    assert client.post("/api/network/import",json=request).status_code==422


@pytest.mark.parametrize("city",CITIES)
def test_city(client,city):
    res=client.get("/api/network/"+city)
    assert res.status_code==200
    n=res.json()
    assert len(n["warehouses"]) in range(3,6) and len(n["orders"])>100 and any(o["id"].startswith("DEMO-") for o in n["orders"])
    assert len(n["provenance"]["sources"])==2
    assert n["provenance"]["directed_edges"]>0
    s={"network":n,"disruption":{"kind":"outage","entity":"W1"},"allowed":[p["id"] for p in n["packages"]]}
    impact=client.post("/api/scenarios/impact",json=s).json()
    assert impact["baseline"]["achieved"]>0 and impact["affected"]
    natural=client.post("/api/recovery/max-service",json=s).json()
    assert natural["verification"]["passed"] and natural["maximum"]["solver_status"]=="OPTIMAL"
    recovered=client.post("/api/recovery/optimize",json=s).json()
    assert recovered["plan"]["solver_status"] in ("OPTIMAL","FEASIBLE","INFEASIBLE")
    if recovered["plan"]["assignments"] is not None:
        assert recovered["verification"]["passed"]

