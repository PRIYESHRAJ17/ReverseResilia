import csv
import io
import os
import sqlite3
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from .impact import impact
from .network_inputs import demo_network, import_orders, reprice
from .models import Evidence, Network, Plan, Record, Scenario, VerificationRequest, indexed
from .solver import natural, solve
from .verifier import verify

ROOT=Path(__file__).resolve().parents[1]
CITIES={"bengaluru":"Bengaluru","mumbai":"Mumbai","delhi_ncr":"Delhi NCR","chennai":"Chennai","guwahati":"Guwahati"}
app=FastAPI(title="ReverseResilia")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path in ("/", "/index.html") or request.url.path.endswith(".html"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


class Impact(Record):
    input_hash: str
    baseline: Plan
    affected: list[str]
    preserved: list[str]
    disrupted_cost: int


class Result(Record):
    run_id: str
    plan: Plan
    verification: Evidence | None
    maximum: Plan | None=None
    cheapest: Plan | None=None
    budget_plan: Plan | None=None
    budget_maximum_proven: bool | None=None
    budget_verification: Evidence | None=None


class TableImport(Record):
    network: Network
    table: str
    csv_text: str


def connect():
    db=sqlite3.connect(os.environ.get("RESILIA_DB",str(ROOT/"runs.sqlite")),timeout=15)
    db.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, scenario TEXT NOT NULL, result TEXT NOT NULL)")
    return db


def save(s,plan,maximum=None,cheapest=None,**comparison):
    evidence=verify(s,plan,plan.stage) if plan.assignments is not None else None
    result=Result(run_id=uuid4().hex,plan=plan,verification=evidence,maximum=maximum,cheapest=cheapest,**comparison)
    db=connect()
    try:
        with db:
            db.execute("INSERT INTO runs VALUES (?,?,?)",(result.run_id,s.model_dump_json(),result.model_dump_json()))
    finally:
        db.close()
    return result


def fetch(run_id):
    db=connect()
    try:
        row=db.execute("SELECT scenario,result FROM runs WHERE id=?",(run_id,)).fetchone()
    finally:
        db.close()
    if not row:
        raise HTTPException(404,"Unknown run")
    return Scenario.model_validate_json(row[0]),Result.model_validate_json(row[1])


@app.get("/api/health")
def health():
    return {"status":"ok"}


@app.get("/api/cities")
def cities():
    return [{"id":k,"name":v} for k,v in CITIES.items()]


@app.get("/api/network/{city_id}",response_model=Network)
def network(city_id:str):
    if city_id not in CITIES:
        raise HTTPException(404,"Unknown city")
    path=ROOT/"data"/(city_id+".json")
    if not path.is_file():
        raise HTTPException(503,f"Run data preparation for {CITIES[city_id]}")
    return demo_network(Network.model_validate_json(path.read_bytes()))


@app.post("/api/network/validate",response_model=Network)
def validate(n:Network):
    return n


@app.post("/api/network/import", response_model=Network)
def import_table(body: TableImport):
    """Apply an atomic, ID-keyed patch to operational fields only."""
    editable = {
        "warehouses": {"stock_units", "capacity_orders", "active"},
        "orders": {"quantity_units", "deadline_min", "critical"},
        "lanes": {"cost_inr", "travel_min", "available"},
        "packages": {"amount", "price_inr", "lead_min"},
    }
    table = body.table.lower().strip()
    if table not in editable:
        raise HTTPException(422, f"Invalid table '{body.table}'. Expected one of: warehouses, orders, lanes, packages.")

    # Auto-detect table mismatch if user uploaded an orders CSV while on warehouses
    raw_lines = [l.strip() for l in body.csv_text.lstrip("\ufeff").split("\n") if l.strip()]
    raw_header_str = raw_lines[0].lower() if raw_lines else ""
    first_id_str = raw_lines[1].split(",")[0].strip().upper() if len(raw_lines) > 1 else ""

    order_signals = ("deadline_min", "priority", "critical", "quantity", "ord-")
    wh_signals = ("stock_units", "capacity_orders", "handling_slots", "wh_depot")

    # If orders signals detected and ID starts with ORD or has order columns, route to orders
    if table == "warehouses" and (any(s in raw_header_str for s in order_signals) or first_id_str.startswith("ORD")):
        table = "orders"
    elif table == "orders" and any(s in raw_header_str for s in wh_signals):
        table = "warehouses"

    if table == "orders":
        try:
            return import_orders(body.network, body.csv_text)
        except (ValueError, csv.Error) as exc:
            raise HTTPException(422, str(exc)) from exc

    try:
        reader = csv.DictReader(io.StringIO(body.csv_text.lstrip("\ufeff")))
        raw_fields = reader.fieldnames or []
    except csv.Error as exc:
        raise HTTPException(422, str(exc)) from exc

    fields_norm = [f.strip().lower() for f in raw_fields if f and f.strip()]
    if "id" not in fields_norm or len(fields_norm) < 2 or len(set(fields_norm)) != len(fields_norm):
        raise HTTPException(422, "Include ID and one or more supported operational field names with no duplicates.")

    unsupported = set(fields_norm) - editable[table] - {"id"}
    if unsupported:
        raise HTTPException(422, f"Unsupported fields for {table}: {', '.join(unsupported)}. Supported: id, {', '.join(sorted(editable[table]))}")

    header_map = {f: f.strip().lower() for f in raw_fields if f}
    n = body.network.model_dump()
    records = {r["id"]: r for r in n[table]}
    records_ci = {r["id"].lower(): r["id"] for r in n[table]}
    seen = set()

    try:
        for line, row in enumerate(reader, 2):
            cleaned = {}
            for k, v in row.items():
                if k is not None:
                    norm_k = header_map.get(k, k.strip().lower())
                    cleaned[norm_k] = v

            raw_key = cleaned.pop("id", None)
            if raw_key is None or not str(raw_key).strip():
                raise ValueError(f"Row {line}: missing ID")

            key_str = str(raw_key).strip()
            if key_str not in records and key_str.lower() in records_ci:
                key_str = records_ci[key_str.lower()]

            if key_str not in records or key_str in seen:
                raise ValueError(f"Row {line}: unknown or duplicate ID '{raw_key}'")
            seen.add(key_str)

            for field, raw in cleaned.items():
                if raw is None or not str(raw).strip():
                    raise ValueError(f"Row {line}: missing value for {field}")
                value = str(raw).strip()
                if field in {"available", "active", "critical"}:
                    v_lower = value.lower()
                    if v_lower not in {"true", "false", "1", "0", "yes", "no", "t", "f"}:
                        raise ValueError(f"Row {line}: {field} requires true or false")
                    records[key_str][field] = v_lower in {"true", "1", "yes", "t"}
                else:
                    try:
                        records[key_str][field] = int(float(value.replace(",", "")))
                    except ValueError as exc:
                        raise ValueError(f"Row {line}: {field} requires a number") from exc

        if not seen:
            raise ValueError("CSV contains no records")
        return Network.model_validate(n)
    except (ValueError, csv.Error) as exc:
        raise HTTPException(422, str(exc)) from exc


class Pricing(Record):
    network: Network
    speed_kmh: float = Field(gt=0)
    dispatch_min: int = Field(ge=0)
    fee_inr: int = Field(ge=0)
    inr_per_km: float = Field(ge=0)


@app.post("/api/network/reprice", response_model=Network)
def price_routes(body: Pricing):
    return reprice(**dict(body))


@app.post("/api/scenarios/validate", response_model=Scenario)
def restore_scenario(s: Scenario):
    return s


@app.post("/api/scenarios/impact",response_model=Impact)
def scenario_impact(s:Scenario):
    return impact(s)


@app.post("/api/recovery/max-service",response_model=Result)
def maximum_service(s:Scenario):
    a,b=natural(s)
    return save(s,b if b and b.assignments is not None else a,a,b)


@app.post("/api/recovery/optimize",response_model=Result)
def optimize(s:Scenario):
    target = solve(s, "C")
    comparison = s.model_copy(update={"target_pct": 0})
    maximum = solve(comparison, "C", within_budget=True)
    best = maximum
    proven = maximum.solver_status == "OPTIMAL"
    if proven:
        cheapest = solve(comparison, "C", fixed_count=maximum.achieved, within_budget=True)
        if cheapest.assignments is not None:
            best = cheapest
    evidence = verify(comparison, best, "C") if best.assignments is not None else None
    if evidence and best.total_inr > s.budget_inr:
        evidence.checks["Budget"].append("Plan exceeds the available budget")
        evidence.passed = False
    if evidence and evidence.passed:
        label = "Maximum" if proven else "Achievable"
        target.diagnostics.append(f"{label} within budget: {best.achieved}/{len(s.network.orders)} orders for INR {best.total_inr:,}.")
    elif maximum.solver_status == "INFEASIBLE":
        target.diagnostics.append("No plan within budget meets the current priority requirements.")
    else:
        target.diagnostics.append("Within-budget comparison is unresolved.")
    return save(s, target, budget_plan=best, budget_maximum_proven=proven, budget_verification=evidence)


@app.post("/api/recovery/verify",response_model=Evidence)
def verify_candidate(request:VerificationRequest):
    return verify(request.scenario,request.plan,request.expected_stage)


@app.get("/api/runs/{run_id}",response_model=Result)
def run(run_id:str):
    return fetch(run_id)[1]


@app.get("/api/runs/{run_id}/scenario", response_model=Scenario)
def export_scenario(run_id:str):
    return fetch(run_id)[0]


@app.get("/api/runs/{run_id}/export")
def export(run_id:str, plan:Literal["target","budget"]="target"):
    s,r=fetch(run_id)
    p,evidence=r.plan,r.verification
    if plan=="budget":
        s=s.model_copy(update={"target_pct":0})
        p,evidence=r.budget_plan,r.budget_verification
    if (not p or not evidence or not evidence.passed or not verify(s,p,p.stage).passed
            or (plan=="budget" and p.total_inr>s.budget_inr)):
        raise HTTPException(409,"A verified candidate is required for export")
    lane_by_id=indexed(s.network.lanes)
    served={lane_by_id[k].order:lane_by_id[k] for k in p.assignments}
    buf=io.StringIO(newline="")
    writer=csv.writer(buf)
    writer.writerow(["run_id","city","input_hash","stage","solver_status","verified","order","customer","quantity_units","deadline_min","warehouse","lane","completion_min","delivery_inr","outcome","selected_packages","package_inr_plan","total_inr_plan","budget_inr","budget_gap_inr","target_pct","achieved_pct"])
    for o in s.network.orders:
        l=served.get(o.id)
        writer.writerow([run_id,s.network.id,p.input_hash,p.stage,p.solver_status,"PASS",o.id,o.customer_id,o.quantity_units,o.deadline_min,
                         l.warehouse if l else "",l.id if l else "",p.completion_min.get(l.id, l.travel_min) if l else "",l.cost_inr if l else "",
                         "Assigned" if l else "Unfulfilled"," | ".join(p.selected),p.package_inr,p.total_inr,s.budget_inr,p.budget_gap,p.requested_target_pct,p.percentage])
    return Response(buf.getvalue(),media_type="text/csv",headers={"Content-Disposition":f'attachment; filename="{s.network.id}-{run_id}.csv"'})


if (ROOT/"frontend/dist/index.html").exists():
    app.mount("/",StaticFiles(directory=ROOT/"frontend/dist",html=True),name="ui")

