from functools import lru_cache

from .models import Network, Scenario, indexed
from .solver import disrupted, natural


@lru_cache(maxsize=32)
def baseline(network_json):
    n=Network.model_validate_json(network_json)
    a,b=natural(Scenario(network=n))
    candidate=b if b and b.assignments is not None else a
    if candidate.assignments is None:
        raise RuntimeError(f"Baseline unavailable: {candidate.solver_status}")
    return candidate


def impact(s):
    original=baseline(s.network.model_dump_json())
    n=disrupted(s)
    warehouses,orders,lanes=map(indexed,(n.warehouses,n.orders,n.lanes))
    slots={k:w.capacity_orders for k,w in warehouses.items()}
    stock={k:w.stock_units for k,w in warehouses.items()}
    kept=[]
    affected=[]
    # For reduced slots retain original orders earliest-deadline first, then ID.
    original_lanes=sorted((lanes[k] for k in original.assignments),key=lambda l:(orders[l.order].deadline_min,l.order))
    for l in original_lanes:
        w,o=warehouses[l.warehouse],orders[l.order]
        if w.active and l.available and slots[w.id]>0 and stock[w.id]>=o.quantity_units:
            kept.append(l)
            slots[w.id]-=1
            stock[w.id]-=o.quantity_units
        else:
            affected.append(o.id)
    return dict(input_hash=s.fingerprint(),baseline=original,affected=affected,preserved=[l.id for l in kept],
                disrupted_cost=sum(l.cost_inr for l in kept))

