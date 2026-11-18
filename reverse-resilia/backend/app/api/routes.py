"""
FastAPI Routes for ReverseResilia.
Implements the full recommended API contract with strict Pydantic validation.
"""

import io
import csv
from typing import List, Dict, Optional, Any
from fastapi import APIRouter, HTTPException, Response, Query
from pydantic import BaseModel

from ..models.schemas import (
    NetworkData,
    DisruptionScenario,
    ImpactAnalysisRequest,
    ImpactAnalysisResult,
    OptimizationRequest,
    RecoveryPlan,
    VerificationResult,
    ScenarioComparison,
    PriorityPolicy,
)
from ..data.loader import default_loader
from ..solver.engine import default_engine
from ..verifier.independent_verifier import default_verifier

router = APIRouter(prefix="/api")

# In-memory store for recent runs and plans
run_store: Dict[str, RecoveryPlan] = {}
network_store: Dict[str, NetworkData] = {}


class MaxServiceRequest(BaseModel):
    network: NetworkData
    disruption: Optional[DisruptionScenario] = None
    priority_policy: PriorityPolicy = PriorityPolicy.HARD


class VerifyRequest(BaseModel):
    network: NetworkData
    plan: RecoveryPlan
    disruption: Optional[DisruptionScenario] = None
    priority_policy: PriorityPolicy = PriorityPolicy.HARD


class CompareRequest(BaseModel):
    network: NetworkData
    disruption: DisruptionScenario
    plan: RecoveryPlan


@router.get("/health")
def get_health():
    return {
        "status": "healthy",
        "service": "ReverseResilia Supply Chain Recovery Engine",
        "version": "1.0.0",
        "team": "Runtime Rebels",
        "solvers": {
            "highs": "available (scipy.optimize.milp)",
            "ortools_cpsat": "available" if default_engine.ortools_solver else "inactive (environment policy)",
        },
    }


@router.get("/cities")
def list_cities():
    """Feature 1: List the five selectable regions."""
    return default_loader.get_supported_cities()


@router.get("/network/{city_id}", response_model=NetworkData)
def get_network(city_id: str):
    """Load network for the selected city."""
    try:
        network = default_loader.load_city_network(city_id)
        network_store[network.city_id] = network
        return network
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/network/validate")
def validate_network(network: NetworkData):
    """
    Feature 3: Data Import and Validation.
    Validates facility coordinates, non-negative quantities, unique IDs, and route references.
    """
    errors = []
    wh_ids = {w.id for w in network.warehouses}
    ord_ids = {o.id for o in network.orders}

    # Verify duplicate IDs
    if len(wh_ids) != len(network.warehouses):
        errors.append("Duplicate warehouse IDs detected.")
    if len(ord_ids) != len(network.orders):
        errors.append("Duplicate customer order IDs detected.")

    # Verify routes link to existing warehouses and orders
    for r in network.routes:
        if r.warehouse_id not in wh_ids:
            errors.append(f"Route {r.id} references non-existent warehouse {r.warehouse_id}.")
        if r.order_id not in ord_ids:
            errors.append(f"Route {r.id} references non-existent order {r.order_id}.")
        if r.cost_inr < 0:
            errors.append(f"Route {r.id} has negative transport cost {r.cost_inr}.")
        if r.transit_time_minutes < 0:
            errors.append(f"Route {r.id} has negative transit time {r.transit_time_minutes}.")

    # Verify warehouse values
    for w in network.warehouses:
        if w.stock_units < 0:
            errors.append(f"Warehouse {w.id} has negative stock.")
        if w.capacity_orders < 0:
            errors.append(f"Warehouse {w.id} has negative processing capacity.")

    # Verify order values
    for o in network.orders:
        if o.demand_units <= 0:
            errors.append(f"Order {o.id} has non-positive demand.")
        if o.deadline_minutes <= 0:
            errors.append(f"Order {o.id} has non-positive deadline.")

    if errors:
        return {"valid": False, "errors": errors, "total_errors": len(errors)}

    return {
        "valid": True,
        "errors": [],
        "summary": {
            "warehouses": len(network.warehouses),
            "orders": len(network.orders),
            "routes": len(network.routes),
            "interventions": len(network.available_interventions),
            "disruptions": len(network.disruptions),
        },
    }


@router.post("/scenarios/impact", response_model=ImpactAnalysisResult)
def calculate_immediate_impact(req: ImpactAnalysisRequest):
    """
    Feature 6: Immediate Impact Analysis.
    Identifies severed routes, failed warehouses, and immediate service loss before recovery.
    """
    return default_engine.analyze_immediate_impact(req.network, req.disruption)


@router.post("/recovery/max-service", response_model=RecoveryPlan)
def calculate_max_natural_recovery(req: MaxServiceRequest):
    """
    Features 7 & 10: Calculates maximum on-time service achievable without emergency interventions,
    and returns the cheapest existing-resource plan that achieves that maximum level.
    """
    plan = default_engine.calculate_max_natural_recovery(
        network=req.network, disruption=req.disruption, priority_policy=req.priority_policy
    )
    run_store[plan.run_id] = plan
    return plan


@router.post("/recovery/optimize", response_model=RecoveryPlan)
def optimize_recovery(req: OptimizationRequest):
    """
    Features 9, 11, 12, 13: Target-Based Recovery Optimization.
    Minimizes total modeled recovery cost to achieve target service (e.g. 100%),
    evaluates discrete interventions, compares against budget, and reports honest limiting constraints.
    """
    plan = default_engine.optimize_target_recovery(req)
    run_store[plan.run_id] = plan
    return plan


@router.post("/recovery/verify", response_model=VerificationResult)
def verify_recovery_plan(req: VerifyRequest):
    """
    Feature 14: Independent Verification.
    Recalculates all constraints from raw network data, ensuring no blind trust in optimizer.
    """
    return default_verifier.verify_plan(
        network=req.network,
        plan=req.plan,
        disruption=req.disruption,
        priority_policy=req.priority_policy,
    )


@router.post("/scenarios/compare", response_model=List[ScenarioComparison])
def compare_scenarios(req: CompareRequest):
    """
    Feature 16: Scenario Comparison across Baseline, Disrupted, and Recovered states.
    """
    impact = default_engine.analyze_immediate_impact(req.network, req.disruption)
    return default_engine.compare_scenarios(req.network, impact, req.plan)


@router.get("/runs/{run_id}", response_model=RecoveryPlan)
def get_run(run_id: str):
    """Retrieve details of a solved run."""
    if run_id not in run_store:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")
    return run_store[run_id]


@router.get("/runs/{run_id}/export")
def export_recovery_action_sheet(run_id: str):
    """
    Feature 17: Detailed Recovery Action Sheet CSV Export.
    Exports assigned source warehouse, transit time, deadline, transport and handling costs,
    selected emergency interventions, and unfulfilled customer list.
    """
    if run_id not in run_store:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")

    plan = run_store[run_id]

    output = io.StringIO()
    writer = csv.writer(output)

    # Header section
    writer.writerow(["REVERSERESILIA RECOVERY ACTION SHEET"])
    writer.writerow(["Run ID", plan.run_id])
    writer.writerow(["City Network", plan.city_id])
    writer.writerow(["Solver Status", plan.solver_status])
    writer.writerow(["Target Requested", f"{plan.target_service_requested}%" if plan.target_service_requested else "Natural Max"])
    writer.writerow(["Service Achieved", plan.service_fraction_display])
    writer.writerow(["Total Modeled Recovery Cost (INR)", plan.total_recovery_cost])
    writer.writerow(["Emergency Intervention Expenditure (INR)", plan.emergency_intervention_cost])
    writer.writerow(["Budget Shortfall (INR)", plan.budget_shortfall])
    writer.writerow([])

    # Table 1: Order Assignments
    writer.writerow(["ORDER RECOVERY ASSIGNMENTS"])
    writer.writerow([
        "Order ID",
        "Assigned Warehouse",
        "Transit Route ID",
        "Transit Time (min)",
        "Customer Deadline (min)",
        "On Time?",
        "Transport Cost (INR)",
        "Handling Cost (INR)",
        "Total Order Cost (INR)",
    ])
    for a in plan.assignments:
        writer.writerow([
            a.order_id,
            a.warehouse_id,
            a.route_id,
            a.transit_time_minutes,
            a.deadline_minutes,
            "YES" if a.is_on_time else "NO",
            a.transport_cost,
            a.handling_cost,
            a.total_cost,
        ])
    writer.writerow([])

    # Table 2: Selected Interventions
    writer.writerow(["SELECTED EMERGENCY INTERVENTIONS"])
    writer.writerow(["Intervention ID", "Name", "Type", "Target Facility", "Cost (INR)", "Effect Description"])
    for item in plan.selected_interventions:
        effect = []
        if item.stock_delta > 0:
            effect.append(f"+{item.stock_delta} Stock Units")
        if item.capacity_delta > 0:
            effect.append(f"+{item.capacity_delta} Processing Orders")
        writer.writerow([
            item.id,
            item.name,
            item.type,
            item.target_id,
            item.cost_inr,
            ", ".join(effect) if effect else item.description,
        ])
    writer.writerow([])

    # Table 3: Unfulfilled Orders
    writer.writerow(["UNFULFILLED CUSTOMER ORDERS"])
    writer.writerow(["Order ID", "Is Critical?"])
    for u_id in plan.unfulfilled_orders:
        is_crit = "CRITICAL" if u_id in plan.unfulfilled_critical_orders else "Standard"
        writer.writerow([u_id, is_crit])

    csv_data = output.getvalue()
    filename = f"recovery_action_sheet_{plan.run_id}.csv"

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
