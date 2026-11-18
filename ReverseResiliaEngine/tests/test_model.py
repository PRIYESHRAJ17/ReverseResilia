import pytest
from pydantic import ValidationError
from backend.models import Network, Scenario
from backend.solver import natural, solve
from backend.verifier import verify


@pytest.fixture
def case():
    point=dict(name="Fixture",pin="000000",lat=0.,lon=0.,node=1,snap_m=0)
    wh=[dict(**point,id=f"W{i}",stock_units=4 if i==1 else 5,capacity_orders=4,active=True) for i in (1,2,3)]
    orders=[dict(**point,id=f"O{i}",customer_id=f"C{i}",quantity_units=1,deadline_min=60,critical=i==0) for i in range(10)]
    lanes=[dict(id=w["id"]+"-"+o["id"],warehouse=w["id"],order=o["id"],distance_m=100,travel_min=5,cost_inr=10,available=True) for w in wh for o in orders]
    packages=[dict(id=f"P{i}",warehouse=f"W{i}",kind="capacity",amount=1,price_inr=price,lead_min=0) for i,price in [(2,300),(3,500)]]
    n=Network(id="fixture",name="Fixture",schema_version=1,seed=1,horizon_min=1440,warehouses=wh,orders=orders,lanes=lanes,packages=packages,provenance={})
    return Scenario(network=n,disruption={"kind":"outage","entity":"W1"},allowed=["P2","P3"],budget_inr=850)


def test_contract(case):
    a,b=natural(case)
    assert a.solver_status==b.solver_status=="OPTIMAL"
    assert a.achieved==b.achieved==8 and b.percentage==80 and b.total_inr==80
    c=solve(case,"C")
    assert c.solver_status=="OPTIMAL" and c.achieved==10
    assert (c.package_inr,c.total_inr,c.budget_gap)==(800,900,50)
    assert verify(case,c,"C").passed
    assert all(not l.startswith("W1") for l in c.assignments)


@pytest.mark.parametrize("field",["stock_units","capacity_orders"])
def test_resource_mutation(case,field):
    before=solve(case,"A")
    setattr(case.network.warehouses[1],field,1)
    assert solve(case,"A").achieved<before.achieved


def test_closure_deadline_and_priority(case):
    case.disruption.kind="closure"
    case.disruption.entity="W1-O0"
    for l in case.network.lanes:
        if l.order=="O0" and l.warehouse!="W1":
            l.travel_min=70
    assert "O0" in solve(case,"A").unfulfilled
    case.protect_critical=True
    assert solve(case,"A").solver_status=="INFEASIBLE"


def test_packages_and_timeout(case):
    case.allowed=[]
    assert solve(case,"C").solver_status=="INFEASIBLE"
    assert solve(case,"A",limit=0).solver_status=="UNKNOWN"
    assert natural(case,limit=0)[1] is None
    case.allowed=["absent"]
    with pytest.raises(ValidationError):
        Scenario.model_validate(case.model_dump())


@pytest.mark.parametrize("corruption",["hash","assignment","fee","duplicate_package","priority","stage","timing","capacity"])
def test_verifier_rejects(case,corruption):
    c=solve(case,"C")
    if corruption=="hash": c.input_hash="old"
    if corruption=="assignment": c.assignments.append(c.assignments[0])
    if corruption=="fee": c.total_inr+=30
    if corruption=="duplicate_package": c.selected.append("P2")
    if corruption=="priority":
        case.protect_critical=True
        c.assignments=[k for k in c.assignments if not k.endswith("-O0")]
    if corruption=="stage": c.stage="A"
    if corruption=="timing": case.network.orders[0].deadline_min=0
    if corruption=="capacity": c.selected=[]
    assert not verify(case,c,"C").passed


def test_reproducible(case):
    assert solve(case,"C").total_inr==solve(case,"C").total_inr


def test_lane_activation_and_stock(case):
    from backend.models import Package
    case.network.warehouses[1].stock_units=4
    extra=Package(id="S",kind="stock",warehouse="W2",amount=1,price_inr=13,lead_min=0)
    unlock=Package(id="T",kind="transport",warehouse="W2",lane="W2-O0",amount=1,price_inr=7,lead_min=0)
    for l in case.network.lanes:
        if l.order=="O0":
            l.available=False
    case.network.packages.extend([extra,unlock])
    case.allowed.extend(["S","T"])
    plan=solve(case,"C")
    assert plan.solver_status=="OPTIMAL" and plan.package_inr==820
    assert verify(case,plan,"C").passed
    case.network.lanes[10].distance_m=None
    assert solve(case,"C").solver_status=="INFEASIBLE"


def test_capacity_impact_and_zero_target(case):
    from backend.impact import impact
    case.disruption.kind="capacity"
    case.disruption.slots=0
    result=impact(case)
    assert result["affected"] and all(not k.startswith("W1-") for k in result["preserved"])
    case.target_pct=0
    plan=solve(case,"C")
    assert plan.total_inr==0 and verify(case,plan,"C").passed
    case.protect_critical=True
    plan=solve(case,"C")
    assert plan.achieved==1 and "O0" not in plan.unfulfilled

