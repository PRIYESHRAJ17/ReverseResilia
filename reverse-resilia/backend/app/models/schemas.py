"""
Data contracts and Pydantic schemas for ReverseResilia.
All schemas adhere to real geography + simulated operational data provenance rules.
"""

from typing import List, Dict, Optional, Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator
from enum import Enum


class ProvenanceTag(str, Enum):
    SOURCED = "sourced geography"
    SIMULATED = "simulated operations"
    DERIVED = "derived from sourced geography"


class PriorityPolicy(str, Enum):
    HARD = "HARD"  # Critical orders must be fulfilled on time, otherwise infeasible
    SOFT = "SOFT"  # Prioritize critical orders via high objective weight


class SolverStatus(str, Enum):
    OPTIMAL = "OPTIMAL"
    FEASIBLE = "FEASIBLE"
    INFEASIBLE = "INFEASIBLE"
    UNKNOWN = "UNKNOWN"
    MODEL_INVALID = "MODEL_INVALID"


class InterventionType(str, Enum):
    EMERGENCY_STOCK = "EMERGENCY_STOCK"
    EXTRA_CAPACITY = "EXTRA_CAPACITY"
    EXPRESS_TRANSPORT = "EXPRESS_TRANSPORT"
    BACKUP_FACILITY = "BACKUP_FACILITY"


class Warehouse(BaseModel):
    id: str
    name: str
    pincode: str
    latitude: float
    longitude: float
    stock_units: int = Field(ge=0, description="Available inventory of units")
    capacity_orders: int = Field(ge=0, description="Order processing capacity per period")
    handling_cost_per_order: float = Field(default=0.0, ge=0.0)
    is_active: bool = True
    capacity_reduction_percent: float = Field(default=0.0, ge=0.0, le=100.0)
    provenance: Dict[str, str] = Field(
        default_factory=lambda: {
            "coordinates": ProvenanceTag.SOURCED.value,
            "stock_units": ProvenanceTag.SIMULATED.value,
            "capacity_orders": ProvenanceTag.SIMULATED.value,
            "handling_cost_per_order": ProvenanceTag.SIMULATED.value,
        }
    )

    @property
    def effective_capacity(self) -> int:
        if not self.is_active:
            return 0
        factor = max(0.0, 1.0 - (self.capacity_reduction_percent / 100.0))
        return int(self.capacity_orders * factor)

    @property
    def effective_stock(self) -> int:
        return self.stock_units if self.is_active else 0


class CustomerOrder(BaseModel):
    id: str
    customer_name: str
    pincode: str
    latitude: float
    longitude: float
    demand_units: int = Field(default=1, ge=1, description="Quantity required")
    deadline_minutes: int = Field(ge=1, description="Delivery cutoff in minutes")
    is_critical: bool = False
    baseline_warehouse_id: Optional[str] = None
    provenance: Dict[str, str] = Field(
        default_factory=lambda: {
            "coordinates": ProvenanceTag.SOURCED.value,
            "demand_units": ProvenanceTag.SIMULATED.value,
            "deadline_minutes": ProvenanceTag.SIMULATED.value,
            "is_critical": ProvenanceTag.SIMULATED.value,
        }
    )


class TransportRoute(BaseModel):
    id: str
    warehouse_id: str
    order_id: str
    distance_km: float = Field(ge=0.0)
    transit_time_minutes: int = Field(ge=0)
    cost_inr: float = Field(ge=0.0)
    is_open: bool = True
    is_express: bool = False
    provenance: Dict[str, str] = Field(
        default_factory=lambda: {
            "distance_km": ProvenanceTag.DERIVED.value,
            "transit_time_minutes": ProvenanceTag.DERIVED.value,
            "cost_inr": ProvenanceTag.SIMULATED.value,
        }
    )


class Intervention(BaseModel):
    id: str
    name: str
    type: InterventionType
    target_id: str = Field(description="warehouse_id or route_id")
    cost_inr: float = Field(ge=0.0, description="Discrete fixed cost to activate")
    stock_delta: int = Field(default=0, ge=0)
    capacity_delta: int = Field(default=0, ge=0)
    time_reduction_minutes: int = Field(default=0, ge=0)
    description: str = ""
    provenance: str = ProvenanceTag.SIMULATED.value


class DisruptionScenario(BaseModel):
    id: str
    name: str
    failed_warehouse_ids: List[str] = Field(default_factory=list)
    closed_route_ids: List[str] = Field(default_factory=list)
    capacity_reductions: Dict[str, float] = Field(
        default_factory=dict,
        description="warehouse_id -> percent reduction (0 to 100)"
    )
    description: str = ""


class NetworkData(BaseModel):
    city_id: str
    city_name: str
    currency: str = "INR"
    warehouses: List[Warehouse]
    orders: List[CustomerOrder]
    routes: List[TransportRoute]
    available_interventions: List[Intervention] = Field(default_factory=list)
    disruptions: List[DisruptionScenario] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("warehouses")
    @classmethod
    def validate_unique_warehouses(cls, v: List[Warehouse]):
        ids = [w.id for w in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate warehouse IDs detected")
        return v

    @field_validator("orders")
    @classmethod
    def validate_unique_orders(cls, v: List[CustomerOrder]):
        ids = [o.id for o in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate order IDs detected")
        return v

    @field_validator("routes")
    @classmethod
    def validate_unique_routes(cls, v: List[TransportRoute]):
        ids = [r.id for r in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate route IDs detected")
        return v


class ImpactAnalysisRequest(BaseModel):
    network: NetworkData
    disruption: DisruptionScenario


class ImpactAnalysisResult(BaseModel):
    total_orders: int
    baseline_fulfilled_orders: int
    immediately_disrupted_orders: List[str]
    surviving_valid_orders: List[str]
    disrupted_warehouses: List[str]
    closed_routes: List[str]
    baseline_service_percentage: float
    immediate_service_percentage: float
    service_loss_percentage: float
    affected_critical_orders: List[str]
    summary: str


class OrderAssignment(BaseModel):
    order_id: str
    warehouse_id: str
    route_id: str
    transit_time_minutes: int
    deadline_minutes: int
    is_on_time: bool
    transport_cost: float
    handling_cost: float
    total_cost: float


class OptimizationRequest(BaseModel):
    network: NetworkData
    disruption: Optional[DisruptionScenario] = None
    target_service_percentage: Optional[float] = Field(
        default=None, ge=0.0, le=100.0, description="Desired service level, e.g. 100.0"
    )
    budget_inr: Optional[float] = Field(
        default=None, ge=0.0, description="Available recovery budget in INR"
    )
    allowed_intervention_ids: Optional[List[str]] = None
    priority_policy: PriorityPolicy = PriorityPolicy.HARD
    timeout_seconds: float = Field(default=10.0, gt=0.0)


class RecoveryPlan(BaseModel):
    run_id: str
    city_id: str
    target_service_requested: Optional[float]
    achieved_service_percentage: float
    fulfilled_orders_count: int
    total_orders_count: int
    service_fraction_display: str  # e.g., "8/10 (80.0%)"
    solver_status: SolverStatus
    is_optimal: bool
    solve_time_ms: float
    assignments: List[OrderAssignment]
    unfulfilled_orders: List[str]
    unfulfilled_critical_orders: List[str]
    selected_interventions: List[Intervention]
    baseline_cost: float
    recovery_transport_cost: float
    handling_cost: float
    emergency_intervention_cost: float
    total_recovery_cost: float
    budget_limit: Optional[float]
    budget_shortfall: float
    is_within_budget: bool
    limiting_constraints: List[str] = Field(default_factory=list)
    input_hash: str


class VerificationCheck(BaseModel):
    check_name: str
    passed: bool
    message: str
    details: Optional[Dict[str, Any]] = None


class VerificationResult(BaseModel):
    is_valid: bool
    checks: List[VerificationCheck]
    recalculated_fulfilled_count: int
    recalculated_total_orders: int
    recalculated_service_percentage: float
    recalculated_total_cost: float
    recalculated_intervention_cost: float
    violations: List[str]
    verified_at: str


class ScenarioComparison(BaseModel):
    metric: str
    baseline: Any
    disrupted: Any
    recovered: Any
    unit: str = ""
