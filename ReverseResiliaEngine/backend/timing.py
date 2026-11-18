from collections import defaultdict

from .models import indexed


def completion_times(scenario, assignments, selected):
    """Allocate warehouse resources in order of the latest feasible departure."""
    network = scenario.network
    warehouses, orders, lanes, packages = map(indexed, (network.warehouses, network.orders, network.lanes, network.packages))
    arrivals = defaultdict(list)
    restored = {}
    for key in selected:
        package = packages[key]
        if package.kind == "transport":
            restored[package.lane] = min(restored.get(package.lane, package.lead_min), package.lead_min)
        else:
            arrivals[package.warehouse, package.kind].append((package.lead_min, package.amount))
    by_hub = defaultdict(list)
    for key in assignments:
        lane = lanes[key]
        order = orders[lane.order]
        by_hub[lane.warehouse].append((min(order.deadline_min, network.horizon_min) - lane.travel_min, key))
    times = {}
    for hub, jobs in by_hub.items():
        warehouse = warehouses[hub]
        disruption = scenario.disruption
        slots = disruption.slots if disruption.kind == "capacity" and disruption.entity == hub else warehouse.capacity_orders
        available = {"stock": warehouse.stock_units, "capacity": slots}
        events = {kind: iter(sorted(arrivals[hub, kind])) for kind in available}
        ready = 0
        for _, key in sorted(jobs):
            lane = lanes[key]
            for kind, amount in (("stock", orders[lane.order].quantity_units), ("capacity", 1)):
                available[kind] -= amount
                while available[kind] < 0:
                    event = next(events[kind], None)
                    if event is None:
                        raise ValueError(f"{hub}: insufficient {kind}")
                    when, quantity = event
                    ready = max(ready, when)
                    available[kind] += quantity
            closed = not lane.available or (disruption.kind == "closure" and disruption.entity == key)
            start = max(ready, restored.get(key, 0) if closed else 0)
            times[key] = start + lane.travel_min
    return times
