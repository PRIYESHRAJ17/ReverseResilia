"""Independent arithmetic checks against original inputs; no optimizer imports."""
from collections import Counter
from decimal import Decimal

from .models import Evidence, indexed
from .timing import completion_times


def verify(s,plan,expected_stage):
    n,d=s.network,s.disruption
    checks={name:[] for name in ("Identity","Plan","Interventions","Assignments","Availability","Timing",
                                 "Inventory","Capacity","Priorities","Target","Service","Cost","Budget")}
    if (plan.input_hash,plan.city_id,plan.stage)!=(s.fingerprint(),n.id,expected_stage):
        checks["Identity"].append("Input hash, city or stage differs.")
    if plan.solver_status not in {"OPTIMAL","FEASIBLE"} or plan.assignments is None or plan.selected is None:
        checks["Plan"].append("No candidate assignment list to verify.")
        return Evidence(passed=False,checks=checks)
    warehouses,orders,lanes,packages=map(indexed,(n.warehouses,n.orders,n.lanes,n.packages))
    active={k:w.active and not(d.kind=="outage" and d.entity==k) for k,w in warehouses.items()}
    stock={k:w.stock_units for k,w in warehouses.items()}
    slots={k:(d.slots if d.kind=="capacity" and d.entity==k else w.capacity_orders) for k,w in warehouses.items()}
    enabled=set()
    fees=0
    for k,count in Counter(plan.selected).items():
        p=packages.get(k)
        if count!=1 or expected_stage!="C" or not p or k not in s.allowed or not active[p.warehouse]:
            checks["Interventions"].append(f"{k}: duplicate, unavailable or unauthorized package")
            continue
        fees+=p.price_inr
        if p.kind=="transport":
            enabled.add(p.lane)
        elif p.kind=="capacity":
            slots[p.warehouse]+=p.amount
        else:
            stock[p.warehouse]+=p.amount
    served=set()
    delivery=0
    for k in plan.assignments:
        l=lanes.get(k)
        if not l:
            checks["Assignments"].append(f"{k}: unknown transport option")
            continue
        if l.order in served:
            checks["Assignments"].append(f"{l.order}: assigned twice")
        served.add(l.order)
        stock[l.warehouse]-=orders[l.order].quantity_units
        slots[l.warehouse]-=1
        closed=not l.available or (d.kind=="closure" and d.entity==k)
        if not active[l.warehouse] or (closed and k not in enabled) or l.distance_m is None:
            checks["Availability"].append(f"{k}: warehouse or road option unavailable")
        if l.travel_min is None or l.travel_min>min(orders[l.order].deadline_min,n.horizon_min):
            checks["Timing"].append(f"{k}: deadline or horizon failed")
        if l.cost_inr is None:
            checks["Cost"].append(f"{k}: missing price")
        else:
            delivery+=l.cost_inr
    checks["Inventory"].extend(f"{k}: short {-v} units" for k,v in stock.items() if v<0)
    checks["Capacity"].extend(f"{k}: short {-v} slots" for k,v in slots.items() if v<0)
    if not any(checks.values()):
        times = completion_times(s, plan.assignments, plan.selected)
        for key, arrival in times.items():
            if arrival > min(orders[lanes[key].order].deadline_min, n.horizon_min):
                checks["Timing"].append(f"{key}: activation and transit exceed the deadline")
        if (plan.completion_min or any(packages[k].lead_min for k in plan.selected)) and times != plan.completion_min:
            checks["Timing"].append("Reported completion times differ from the assignment schedule")
    if s.protect_critical:
        checks["Priorities"].extend(o.id for o in n.orders if o.critical and o.id not in served)
    target=s.target_pct if expected_stage=="C" else None
    if plan.requested_target_pct!=target or (target is not None and len(served)*100<Decimal(str(target))*len(orders)):
        checks["Target"].append("Requested service target differs or is unmet")
    if (plan.achieved!=len(served) or plan.percentage!=round(100*len(served)/len(orders),2)
        or plan.unfulfilled is None or sorted(plan.unfulfilled)!=sorted(orders.keys()-served)):
        checks["Service"].append("Service count, percentage or unfulfilled orders differ")
    if (delivery,fees,delivery+fees)!=(plan.delivery_inr,plan.package_inr,plan.total_inr):
        checks["Cost"].append("Reported cost differs from assignment and activation costs")
    gap=max(0,delivery+fees-s.budget_inr) if expected_stage=="C" and plan.solver_status=="OPTIMAL" else None
    if gap!=plan.budget_gap:
        checks["Budget"].append("Budget comparison differs")
    return Evidence(passed=not any(checks.values()),checks=checks)

