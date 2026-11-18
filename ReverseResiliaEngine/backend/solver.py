import os
from collections import defaultdict
from decimal import Decimal
from math import ceil

from ortools.sat.python import cp_model

from .models import Plan, indexed
from .timing import completion_times


def disrupted(s):
    n=s.network.model_copy(deep=True)
    d=s.disruption
    if d.kind=="outage":
        indexed(n.warehouses)[d.entity].active=False
    elif d.kind=="capacity":
        indexed(n.warehouses)[d.entity].capacity_orders=d.slots
    elif d.kind=="closure":
        indexed(n.lanes)[d.entity].available=False
    return n


def solve(s,stage,fixed_count=None,limit=8,*,within_budget=False):
    n=disrupted(s)
    m=cp_model.CpModel()
    facilities,orders=map(indexed,(n.warehouses,n.orders))
    packages={p.id:p for p in n.packages if stage=="C" and p.id in s.allowed and facilities[p.warehouse].active}
    activated={k:m.new_bool_var(k) for k in packages}
    assigned={}
    by_order=defaultdict(list)
    by_wh=defaultdict(list)
    base_slots={w.id:w.capacity_orders for w in n.warehouses}
    for lane in n.lanes:
        o=orders[lane.order]
        if (not facilities[lane.warehouse].active or None in (lane.travel_min,lane.cost_inr,lane.distance_m)
                or lane.travel_min>min(o.deadline_min,n.horizon_min)):
            continue
        latest = min(o.deadline_min, n.horizon_min) - lane.travel_min
        unlock=[activated[k] for k,p in packages.items() if p.kind=="transport" and p.lane==lane.id and p.lead_min<=latest]
        if not lane.available and not unlock:
            continue
        x=m.new_bool_var(lane.id)
        assigned[lane.id]=x
        by_order[o.id].append(x)
        by_wh[lane.warehouse].append((x,o.quantity_units,latest))
        if not lane.available:
            m.add(x<=sum(unlock))
    for o in n.orders:
        count=sum(by_order[o.id])
        if s.protect_critical and o.critical:
            m.add(count==1)
        else:
            m.add(count<=1)
    for w in n.warehouses:
        local=by_wh[w.id]
        for kind, base in (("stock", w.stock_units), ("capacity", base_slots[w.id])):
            resource = [p for p in packages.values() if p.warehouse == w.id and p.kind == kind]
            # Before each delivery of resources, only earlier resources may serve the due orders.
            for cutoff in {p.lead_min for p in resource if p.lead_min > 0} | {float("inf")}:
                used = sum(x * (quantity if kind == "stock" else 1)
                           for x, quantity, latest in local if latest < cutoff)
                available = base + sum(p.amount * activated[p.id] for p in resource if p.lead_min < cutoff)
                m.add(used <= available)
    served=sum(assigned.values())
    costs=sum(l.cost_inr*assigned[l.id] for l in n.lanes if l.id in assigned)
    total_cost = costs + sum(p.price_inr * activated[k] for k,p in packages.items())
    if within_budget:
        m.add(total_cost <= s.budget_inr)
    if stage=="A" or (within_budget and fixed_count is None):
        m.maximize(served)
    else:
        if stage=="B" or within_budget:
            m.add(served==fixed_count)
        else:
            m.add(served >= ceil(Decimal(str(s.target_pct)) * len(orders) / 100))
        m.minimize(total_cost)
    solver=cp_model.CpSolver()
    solver.parameters.max_time_in_seconds=limit
    solver.parameters.num_search_workers=min(8, max(2, os.cpu_count() or 4))
    status=solver.solve(m)
    plan=Plan(input_hash=s.fingerprint(),city_id=n.id,stage=stage,solver_status=solver.status_name(status),
              requested_target_pct=s.target_pct if stage=="C" else None,seconds=solver.wall_time,
              best_bound=solver.best_objective_bound if status in (cp_model.OPTIMAL,cp_model.FEASIBLE) else None)
    if status not in (cp_model.OPTIMAL,cp_model.FEASIBLE):
        if status==cp_model.INFEASIBLE:
            empty=[o.id for o in n.orders if not by_order[o.id]]
            plan.diagnostics=["No plan meets these constraints."] + (["No eligible on-time lane: "+", ".join(empty)] if empty else [])
            slots=sum(w.capacity_orders for w in n.warehouses if w.active)+sum(p.amount for p in packages.values() if p.kind=="capacity")
            plan.diagnostics.append(f"Handling upper bound: {slots} order slots across active warehouses.")
        else:
            plan.diagnostics=["No conclusive plan returned. Inspect the solver status."]
        return plan
    lanes=[l for l in n.lanes if l.id in assigned and solver.value(assigned[l.id])]
    selected=[p for k,p in packages.items() if solver.value(activated[k])]
    fulfilled={l.order for l in lanes}
    plan.assignments=[l.id for l in lanes]
    plan.selected=[p.id for p in selected]
    plan.completion_min=completion_times(s,plan.assignments,plan.selected)
    plan.unfulfilled=[o for o in orders if o not in fulfilled]
    plan.achieved=len(fulfilled)
    plan.percentage=round(100*len(fulfilled)/len(orders),2)
    plan.delivery_inr=sum(l.cost_inr for l in lanes)
    plan.package_inr=sum(p.price_inr for p in selected)
    plan.total_inr=plan.delivery_inr+plan.package_inr
    if within_budget:
        plan.requested_target_pct = 0
    if stage=="C" and status==cp_model.OPTIMAL:
        plan.budget_gap=max(0,plan.total_inr-s.budget_inr)
    return plan


def natural(s,limit=8):
    maximum=solve(s,"A",limit=limit)
    cheapest=solve(s,"B",maximum.achieved,limit) if maximum.solver_status=="OPTIMAL" else None
    return maximum,cheapest

