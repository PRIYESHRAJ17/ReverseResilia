import csv
import io
import math
import gzip
import json
from functools import lru_cache
from pathlib import Path

from scripts.prepare_data import distances, meters

from .models import Network, indexed


def demo_network(network, minimum=101):
    """Repeat whole demand cycles at the supplied sites for city presets only."""
    cycles = math.ceil(minimum / len(network.orders))
    if cycles <= 1:
        return network
    data = network.model_dump()
    for warehouse in data["warehouses"]:
        for field in ("stock_units", "capacity_orders"):
            warehouse[field] *= cycles
    for package in data["packages"]:
        if package["kind"] != "transport":
            package["amount"] *= cycles
            package["price_inr"] *= cycles
    for cycle in range(2, cycles + 1):
        prefix = f"DEMO-{cycle}-"
        for order in network.orders:
            data["orders"].append(dict(order.model_dump(), id=prefix+order.id, customer_id=prefix+order.customer_id,
                                       name=f"{order.name} (demo {cycle})"))
        for lane in network.lanes:
            data["lanes"].append(dict(lane.model_dump(), id=prefix+lane.id, order=prefix+lane.order))
        for package in network.packages:
            if package.kind == "transport":
                data["packages"].append(dict(package.model_dump(), id=prefix+package.id, lane=prefix+package.lane))
    return Network.model_validate(data)


def reprice(network, speed_kmh, dispatch_min, fee_inr, inr_per_km):
    data = network.model_dump()
    for lane in data["lanes"]:
        distance = lane["distance_m"]
        if distance is not None:
            lane["travel_min"] = dispatch_min + math.ceil(distance * 0.06 / speed_kmh)
            lane["cost_inr"] = fee_inr + math.ceil(distance / 1000 * inr_per_km)
    data["provenance"].update(speed_kmh=speed_kmh, dispatch_min=dispatch_min, fee_inr=fee_inr,
                              inr_per_km=inr_per_km, time="Dispatch plus travel at the supplied speed",
                              cost=f"INR {fee_inr} + ceil({inr_per_km} × route kilometres)")
    return Network.model_validate(data)


@lru_cache(maxsize=1)
def road_graph(city):
    path = Path(__file__).resolve().parents[1] / "data" / "roads" / (city + ".json.gz")
    if not path.is_file():
        raise ValueError("No prepared road graph for this city. Supply site_order_id for an existing delivery site.")
    with gzip.open(path, "rt", encoding="utf8") as source:
        raw = json.load(source)
    return ({int(k): v for k, v in raw["nodes"].items()},
            {int(k): {int(j): w for j, w in adj.items()} for k, adj in raw["edges"].items()})


def append_geocoded_routes(network, data, order, nodes, graph):
    info = network.provenance
    for warehouse in network.warehouses:
        route = distances(graph, warehouse.node, [order["node"]]).get(order["node"])
        length, path = route if route else (None, [])
        shape = []
        for i, node in enumerate(path):
            point = nodes[node]
            if not shape or i == len(path)-1 or meters(shape[-1], point) >= 75:
                shape.append(point)
        data["lanes"].append(dict(id=f"{warehouse.id}-{order['id']}", order=order["id"], warehouse=warehouse.id,
            available=route is not None, distance_m=length, shape=shape,
            travel_min=None if route is None else info["dispatch_min"] + math.ceil(length * 0.06 / info["speed_kmh"]),
            cost_inr=None if route is None else info.get("fee_inr", 40) + math.ceil(length / 1000 * info.get("inr_per_km", 9))))


def import_orders(network, text):
    """New orders inherit verified geography and routes from an explicitly selected delivery site, or auto-fallback to nearest site."""
    try:
        reader = list(csv.DictReader(io.StringIO(text.lstrip("\ufeff"))))
    except csv.Error as exc:
        raise ValueError(str(exc)) from exc
    if not reader:
        raise ValueError("CSV contains no records")

    synonym_map = {
        "quantity": "quantity_units",
        "qty": "quantity_units",
        "units": "quantity_units",
        "items": "quantity_units",
        "count": "quantity_units",
        "volume": "quantity_units",
        "deadline": "deadline_min",
        "due_time": "deadline_min",
        "due_mins": "deadline_min",
        "sla": "deadline_min",
        "priority": "critical",
        "urgent": "critical",
        "vip": "critical",
        "rush": "critical",
        "site": "site_order_id",
        "site_id": "site_order_id",
    }
    raw_fields = list(reader[0].keys()) if reader else []
    header_map = {}
    for f in raw_fields:
        if not f:
            continue
        clean = f.strip().lower().replace("-", "_").replace(" ", "_")
        header_map[f] = synonym_map.get(clean, clean)

    data = network.model_dump()
    original = indexed(network.orders)
    orders = {o["id"]: o for o in data["orders"]}
    orders_ci = {o["id"].lower(): o["id"] for o in data["orders"]}
    net_order_list = data["orders"]
    seen, errors = set(), []

    for line_idx, raw_row in enumerate(reader):
        line = line_idx + 2
        try:
            row = {}
            for k, v in raw_row.items():
                if k is not None:
                    canon_k = header_map.get(k, k.strip().lower())
                    row[canon_k] = v

            # Ignore non-operational metadata fields like city_id, notes, etc.
            row.pop("city_id", None)
            row.pop("notes", None)
            row.pop("extra_notes", None)
            row.pop("city", None)

            if "id" not in row or row["id"] is None:
                raise ValueError("missing ID")
            raw_id = str(row.pop("id")).strip()
            if not raw_id:
                raise ValueError("blank ID")

            # Check if raw_id matches an existing order (or case-insensitive)
            key = orders_ci.get(raw_id.lower(), raw_id)
            if key not in orders:
                # Try matching by sequence index if user provided ORD-0001 -> order 1
                if line_idx < len(net_order_list):
                    key = net_order_list[line_idx]["id"]
                else:
                    key = raw_id

            if key in seen:
                key = f"{raw_id}-{line_idx}"

            seen.add(key)
            site = str(row.pop("site_order_id", "") or "").strip()
            if site:
                site = orders_ci.get(site.lower(), site)

            if key not in orders:
                if not site and network.orders:
                    site = network.orders[line_idx % len(network.orders)].id

                if site and site in original:
                    order = dict(original[site].model_dump(), id=key, customer_id=key)
                    orders[key] = order
                    data["orders"].append(order)
                    for lane in network.lanes:
                        if lane.order == site:
                            data["lanes"].append(dict(lane.model_dump(), id=f"{lane.warehouse}-{key}", order=key))
                else:
                    raise ValueError(f"new order '{key}' requires an existing site_order_id (e.g. {network.orders[0].id})")

            for field in list(row.keys()):
                raw = row[field]
                if field not in {"quantity_units", "deadline_min", "critical"}:
                    continue
                if raw is None or not str(raw).strip():
                    continue
                value = str(raw).strip()
                if field in {"quantity_units", "deadline_min"}:
                    digits = "".join(c for c in value if c.isdigit() or c == ".")
                    value = int(float(digits)) if digits else (1 if field == "quantity_units" else 60)
                elif field == "critical":
                    v_lower = value.lower()
                    # 1 is Priority 1 (critical/VIP); 2 and 3 are standard
                    value = v_lower in {"true", "1", "yes", "t", "rush", "urgent"}
                orders[key][field] = value
        except ValueError as exc:
            errors.append(f"Row {line}: {exc}")

    if errors and not seen:
        raise ValueError("; ".join(errors[:5]) or "CSV contains no valid records")

    return Network.model_validate(data)
