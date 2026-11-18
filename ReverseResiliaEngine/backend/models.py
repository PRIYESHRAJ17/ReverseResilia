import hashlib
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Number = Annotated[int, Field(ge=0, le=10**8)]
Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")]
Stage = Literal["A", "B", "C"]
Status = Literal["OPTIMAL","FEASIBLE","INFEASIBLE","UNKNOWN","MODEL_INVALID"]


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class Point(Record):
    id: Identifier
    name: str
    pin: str
    lat: float = Field(ge=-90,le=90)
    lon: float = Field(ge=-180,le=180)
    node: int
    snap_m: Number


class Warehouse(Point):
    stock_units: Number
    capacity_orders: Number
    active: bool

    @model_validator(mode="after")
    def limit_slots_to_inventory(self):
        self.capacity_orders = min(self.capacity_orders, self.stock_units)
        return self


class Order(Point):
    customer_id: Identifier
    quantity_units: int = Field(gt=0,le=10**8)
    deadline_min: Number
    critical: bool


class Lane(Record):
    id: Identifier
    warehouse: Identifier
    order: Identifier
    distance_m: Number | None
    travel_min: Number | None
    cost_inr: Number | None
    available: bool
    shape: list[list[float]] = Field(default_factory=list)

    @model_validator(mode="after")
    def coordinates(self):
        for pair in self.shape:
            if len(pair)!=2 or not (-90<=pair[0]<=90 and -180<=pair[1]<=180):
                raise ValueError(f"{self.id}: invalid route geometry")
        return self


class Package(Record):
    id: Identifier
    kind: Literal["stock","capacity","transport"]
    warehouse: Identifier
    lane: Identifier | None = None
    amount: int = Field(gt=0,le=10**8)
    price_inr: Number
    lead_min: Number = 0


def indexed(records):
    return {r.id:r for r in records}


class Network(Record):
    id: Identifier
    name: str
    schema_version: Literal[1]
    seed: Number
    horizon_min: int = Field(gt=0,le=1440)
    warehouses: list[Warehouse] = Field(min_length=1,max_length=100)
    orders: list[Order] = Field(min_length=1,max_length=1000)
    lanes: list[Lane] = Field(max_length=100000)
    packages: list[Package] = Field(max_length=1000)
    provenance: dict

    @model_validator(mode="after")
    def references(self):
        for group in (self.warehouses,self.orders,self.lanes,self.packages):
            if len(indexed(group))!=len(group):
                raise ValueError(f"Duplicate ID in {type(group[0]).__name__} records")
        if len({o.customer_id for o in self.orders})!=len(self.orders):
            raise ValueError("Customer IDs must be unique")
        warehouses,orders,lanes=map(indexed,(self.warehouses,self.orders,self.lanes))
        pairs=set()
        for l in self.lanes:
            if l.warehouse not in warehouses or l.order not in orders:
                raise ValueError(f"{l.id}: unknown warehouse or order")
            pair=(l.warehouse,l.order)
            if pair in pairs:
                raise ValueError(f"{l.id}: duplicate warehouse/order pair")
            pairs.add(pair)
            if l.available and None in (l.distance_m,l.travel_min,l.cost_inr):
                raise ValueError(f"{l.id}: available lane requires a sourced distance, time and cost")
        for p in self.packages:
            if p.warehouse not in warehouses:
                raise ValueError(f"{p.id}: unknown warehouse")
            if p.kind=="transport":
                if p.lane not in lanes or lanes[p.lane].warehouse!=p.warehouse or p.amount!=1:
                    raise ValueError(f"{p.id}: transport package must enable one matching lane")
            elif p.lane is not None:
                raise ValueError(f"{p.id}: only transport packages enable a lane")
        return self


class Disruption(Record):
    kind: Literal["none","outage","closure","capacity"]="none"
    entity: Identifier | None=None
    slots: Number=0


def _baseline_prices(network):
    prices = {}
    if network:
        active = {w.id for w in network.warehouses if w.active and w.capacity_orders and w.stock_units}
        for lane in network.lanes:
            if lane.available and lane.warehouse in active:
                prices.setdefault(lane.order, []).append(lane.cost_inr)
    return prices


class Scenario(Record):
    network: Network
    disruption: Disruption=Field(default_factory=Disruption)
    protect_critical: bool=False
    target_pct: int | float=Field(default=100,ge=0,le=100)
    budget_inr: Number = Field(default_factory=lambda data: sum(min(prices) for prices in _baseline_prices(data.get("network")).values()))
    allowed: list[Identifier]=Field(default_factory=list)

    @model_validator(mode="after")
    def references(self):
        n,d=self.network,self.disruption
        if len(set(self.allowed))!=len(self.allowed) or set(self.allowed)-indexed(n.packages).keys():
            raise ValueError("Duplicate or unknown allowed intervention")
        if d.kind!="none":
            entities=n.lanes if d.kind=="closure" else n.warehouses
            if d.entity not in indexed(entities):
                raise ValueError(f"Unknown {d.kind} resource {d.entity}")
            if d.kind=="capacity" and d.slots>indexed(n.warehouses)[d.entity].capacity_orders:
                raise ValueError("Reduced capacity must be at most the original capacity")
        return self

    def fingerprint(self):
        content=json.dumps(self.model_dump(),sort_keys=True,separators=(",",":"),allow_nan=False)
        return hashlib.sha256(content.encode()).hexdigest()


class Plan(Record):
    input_hash: str
    city_id: str
    stage: Stage
    solver_status: Status
    requested_target_pct: int | float | None
    best_bound: float | None
    seconds: float
    assignments: list[str] | None=None
    selected: list[str] | None=None
    unfulfilled: list[str] | None=None
    achieved: int | None=None
    percentage: float | None=None
    delivery_inr: int | None=None
    package_inr: int | None=None
    total_inr: int | None=None
    budget_gap: int | None=None
    completion_min: dict[str, int] = Field(default_factory=dict)
    diagnostics: list[str]=Field(default_factory=list)


class Evidence(Record):
    passed: bool
    checks: dict[str,list[str]]


class VerificationRequest(Record):
    scenario: Scenario
    plan: Plan
    expected_stage: Stage="C"

