"""
Dataset Generator for ReverseResilia.
Extracts authentic geographical coordinates from pincode.csv and generates
calibrated operational datasets with explicit provenance tags for the 5 cities:
- Bengaluru
- Mumbai
- Delhi NCR
- Chennai
- Guwahati
"""

import os
import csv
import json
import math
import random
from typing import Dict, List, Tuple
from ..models.schemas import (
    Warehouse,
    CustomerOrder,
    TransportRoute,
    Intervention,
    InterventionType,
    DisruptionScenario,
    NetworkData,
    ProvenanceTag,
)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate Great Circle distance in km between two lat/lon points."""
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def get_city_locations(pincode_csv_path: str) -> Dict[str, List[dict]]:
    city_filters = {
        "bengaluru": lambda d, r, s: "BANGALORE" in d or "BENGALURU" in d,
        "mumbai": lambda d, r, s: "MUMBAI" in d or "THANE" in d,
        "delhi": lambda d, r, s: "DELHI" in d or "GURGAON" in d,
        "chennai": lambda d, r, s: "CHENNAI" in d or "CHENGALPATTU" in d or "KANCHEEPURAM" in d,
        "guwahati": lambda d, r, s: "KAMRUP" in d,
    }

    locations: Dict[str, List[dict]] = {c: [] for c in city_filters}

    with open(pincode_csv_path, mode="r", encoding="utf-8", errors="ignore") as f:
        reader = csv.DictReader(f)
        for row in reader:
            d = (row.get("District") or "").upper()
            r = (row.get("RegionName") or "").upper()
            s = (row.get("StateName") or "").upper()
            lat = row.get("Latitude")
            lng = row.get("Longitude")
            if not lat or not lng or lat == "NA" or lng == "NA":
                continue
            try:
                flat = float(lat)
                flng = float(lng)
                if flat < 8.0 or flat > 37.0 or flng < 68.0 or flng > 98.0:
                    continue
            except ValueError:
                continue

            for cname, fn in city_filters.items():
                if fn(d, r, s):
                    locations[cname].append({
                        "pincode": row.get("Pincode", "000000"),
                        "office": row.get("OfficeName", "Office"),
                        "district": d,
                        "lat": round(flat, 6),
                        "lng": round(flng, 6),
                    })

    return locations


def generate_city_network(
    city_id: str,
    city_name: str,
    raw_locations: List[dict],
    seed: int = 42,
    num_warehouses: int = 4,
    num_orders: int = 30,
) -> NetworkData:
    """Generate a realistic, calibrated network for a city with explicit provenance."""
    rng = random.Random(seed)

    # Deduplicate locations by (lat, lng) to ensure distinct geographic sites
    unique_locs = []
    seen_coords = set()
    for loc in raw_locations:
        coord_key = (round(loc["lat"], 3), round(loc["lng"], 3))
        if coord_key not in seen_coords:
            seen_coords.add(coord_key)
            unique_locs.append(loc)

    if len(unique_locs) < num_warehouses + num_orders:
        raise ValueError(f"Insufficient unique locations for {city_name}")

    rng.shuffle(unique_locs)
    wh_locs = unique_locs[:num_warehouses]
    order_locs = unique_locs[num_warehouses : num_warehouses + num_orders]

    # 1. Create Warehouses
    warehouses: List[Warehouse] = []
    wh_names = [
        f"{city_name} Central Fulfillment Hub",
        f"{city_name} North Distribution Center",
        f"{city_name} South Regional Depot",
        f"{city_name} West Industrial Yard",
        f"{city_name} East Satellite Facility",
    ]

    for i, loc in enumerate(wh_locs):
        wh_id = f"WH-{city_id.upper()[:3]}-{i+1:02d}"
        warehouses.append(
            Warehouse(
                id=wh_id,
                name=wh_names[i % len(wh_names)],
                pincode=loc["pincode"],
                latitude=loc["lat"],
                longitude=loc["lng"],
                stock_units=15 + rng.randint(0, 5),  # 15-20 units
                capacity_orders=14 + rng.randint(0, 4),  # 14-18 orders capacity
                handling_cost_per_order=25.0 + rng.randint(0, 10),
                is_active=True,
                capacity_reduction_percent=0.0,
                provenance={
                    "coordinates": ProvenanceTag.SOURCED.value,
                    "pincode": ProvenanceTag.SOURCED.value,
                    "stock_units": ProvenanceTag.SIMULATED.value,
                    "capacity_orders": ProvenanceTag.SIMULATED.value,
                    "handling_cost_per_order": ProvenanceTag.SIMULATED.value,
                },
            )
        )

    # 2. Create Customer Orders
    orders: List[CustomerOrder] = []
    for i, loc in enumerate(order_locs):
        ord_id = f"ORD-{city_id.upper()[:3]}-{i+1:03d}"
        is_crit = (i % 6 == 0)  # ~17% critical orders
        # Deadlines between 90 and 180 minutes
        deadline = 90 + (rng.randint(2, 9) * 10)
        orders.append(
            CustomerOrder(
                id=ord_id,
                customer_name=f"Customer {loc['office']}",
                pincode=loc["pincode"],
                latitude=loc["lat"],
                longitude=loc["lng"],
                demand_units=1,  # indivisible 1 unit per order
                deadline_minutes=deadline,
                is_critical=is_crit,
                provenance={
                    "coordinates": ProvenanceTag.SOURCED.value,
                    "pincode": ProvenanceTag.SOURCED.value,
                    "demand_units": ProvenanceTag.SIMULATED.value,
                    "deadline_minutes": ProvenanceTag.SIMULATED.value,
                    "is_critical": ProvenanceTag.SIMULATED.value,
                },
            )
        )

    # 3. Create Transport Routes between all warehouse and order pairs
    routes: List[TransportRoute] = []
    circuity_factor = 1.32  # Real road distance vs straight-line
    avg_speed_kmh = 32.0   # Urban delivery transit speed in km/h

    for wh in warehouses:
        for ord_item in orders:
            dist_straight = haversine_km(
                wh.latitude, wh.longitude, ord_item.latitude, ord_item.longitude
            )
            road_dist_km = round(dist_straight * circuity_factor, 2)
            # Transit time = (distance / speed) * 60 + 15 min dispatch prep
            transit_minutes = int(math.ceil((road_dist_km / avg_speed_kmh) * 60.0)) + 15
            # Transport cost: base ₹40 + ₹8.5 per km
            cost_inr = round(40.0 + (road_dist_km * 8.5), 2)

            route_id = f"ROUTE-{wh.id}-{ord_item.id}"
            routes.append(
                TransportRoute(
                    id=route_id,
                    warehouse_id=wh.id,
                    order_id=ord_item.id,
                    distance_km=road_dist_km,
                    transit_time_minutes=transit_minutes,
                    cost_inr=cost_inr,
                    is_open=True,
                    is_express=False,
                    provenance={
                        "distance_km": ProvenanceTag.DERIVED.value,
                        "transit_time_minutes": ProvenanceTag.DERIVED.value,
                        "cost_inr": ProvenanceTag.SIMULATED.value,
                    },
                )
            )

    # Assign each order a baseline warehouse based on minimal cost with valid deadline
    route_by_pair = {(r.warehouse_id, r.order_id): r for r in routes}
    for ord_item in orders:
        best_wh = None
        min_cost = float("inf")
        for wh in warehouses:
            r = route_by_pair.get((wh.id, ord_item.id))
            if r and r.transit_time_minutes <= ord_item.deadline_minutes:
                if r.cost_inr < min_cost:
                    min_cost = r.cost_inr
                    best_wh = wh.id
        if best_wh:
            ord_item.baseline_warehouse_id = best_wh
        else:
            # Fallback to closest warehouse and expand deadline slightly to ensure valid baseline
            closest_wh = min(
                warehouses,
                key=lambda w: route_by_pair[(w.id, ord_item.id)].transit_time_minutes,
            )
            ord_item.baseline_warehouse_id = closest_wh.id
            r = route_by_pair[(closest_wh.id, ord_item.id)]
            ord_item.deadline_minutes = max(ord_item.deadline_minutes, r.transit_time_minutes + 15)

    # Balance warehouse stock & capacity to comfortably cover baseline demand
    baseline_counts: Dict[str, int] = {w.id: 0 for w in warehouses}
    for ord_item in orders:
        if ord_item.baseline_warehouse_id:
            baseline_counts[ord_item.baseline_warehouse_id] += ord_item.demand_units

    for wh in warehouses:
        needed = baseline_counts[wh.id]
        # Assign stock and capacity with a small realistic buffer (e.g. +3 to +6)
        wh.stock_units = max(wh.stock_units, needed + 4)
        wh.capacity_orders = max(wh.capacity_orders, needed + 3)

    # 4. Create Available Discrete Interventions
    interventions: List[Intervention] = []
    for i, wh in enumerate(warehouses):
        # Emergency Stock Bundle
        interventions.append(
            Intervention(
                id=f"INT-{city_id.upper()[:3]}-STK-{wh.id}",
                name=f"Emergency Stock Bundle for {wh.name}",
                type=InterventionType.EMERGENCY_STOCK,
                target_id=wh.id,
                cost_inr=1800.0 + (i * 200.0),
                stock_delta=8,
                capacity_delta=0,
                description=f"Expedited stock transfer adding 8 inventory units to {wh.id}",
                provenance=ProvenanceTag.SIMULATED.value,
            )
        )
        # Extra Handling Shift / Overtime Capacity
        interventions.append(
            Intervention(
                id=f"INT-{city_id.upper()[:3]}-CAP-{wh.id}",
                name=f"Overtime Handling Shift for {wh.name}",
                type=InterventionType.EXTRA_CAPACITY,
                target_id=wh.id,
                cost_inr=1400.0 + (i * 150.0),
                stock_delta=0,
                capacity_delta=7,
                description=f"Overtime labor crew adding 7 order handling slots to {wh.id}",
                provenance=ProvenanceTag.SIMULATED.value,
            )
        )

    # 5. Create Realistic Disruption Scenarios
    primary_wh = warehouses[0].id
    secondary_wh = warehouses[1].id if len(warehouses) > 1 else warehouses[0].id

    # Find routes connected to secondary warehouse for lane disruptions
    sample_routes_to_close = [
        r.id for r in routes if r.warehouse_id == secondary_wh
    ][:4]

    disruptions = [
        DisruptionScenario(
            id=f"DIS-{city_id.upper()[:3]}-01",
            name=f"{city_name} Primary Hub Complete Outage",
            failed_warehouse_ids=[primary_wh],
            closed_route_ids=[],
            capacity_reductions={},
            description=f"Total operational shutdown at {warehouses[0].name} ({primary_wh}) due to facility flood / structural hazard.",
        ),
        DisruptionScenario(
            id=f"DIS-{city_id.upper()[:3]}-02",
            name=f"{city_name} Arterial Road Corridor Blockage",
            failed_warehouse_ids=[],
            closed_route_ids=sample_routes_to_close,
            capacity_reductions={},
            description="Severe traffic lockdown and arterial road collapse blocking 4 key delivery lanes.",
        ),
        DisruptionScenario(
            id=f"DIS-{city_id.upper()[:3]}-03",
            name=f"{city_name} Compound Disruption: Outage & Capacity Shock",
            failed_warehouse_ids=[primary_wh],
            closed_route_ids=sample_routes_to_close[:2],
            capacity_reductions={secondary_wh: 50.0},
            description=f"Primary hub failure at {primary_wh} combined with a 50% labor capacity reduction at {secondary_wh}.",
        ),
    ]

    return NetworkData(
        city_id=city_id,
        city_name=city_name,
        currency="INR",
        warehouses=warehouses,
        orders=orders,
        routes=routes,
        available_interventions=interventions,
        disruptions=disruptions,
        metadata={
            "provenance_summary": {
                "geography": "Sourced from real pincode.csv GPS coordinates",
                "operations": "Simulated operational parameters with deterministic seeds",
                "road_metrics": "Derived from Great Circle + 1.32 circuity factor",
            },
            "total_orders": len(orders),
            "total_warehouses": len(warehouses),
            "total_routes": len(routes),
            "initial_total_stock": sum(w.stock_units for w in warehouses),
            "initial_total_capacity": sum(w.capacity_orders for w in warehouses),
        },
    )


def generate_all_cities(pincode_csv_path: str, output_dir: str):
    """Generate datasets for all 5 cities and write to output_dir."""
    print("Reading real pincode data...")
    city_locations = get_city_locations(pincode_csv_path)

    configs = [
        ("bengaluru", "Bengaluru", 101, 4, 30),
        ("mumbai", "Mumbai", 202, 4, 30),
        ("delhi", "Delhi NCR", 303, 4, 30),
        ("chennai", "Chennai", 404, 4, 30),
        ("guwahati", "Guwahati", 505, 4, 25),
    ]

    os.makedirs(output_dir, exist_ok=True)

    for city_id, city_name, seed, num_wh, num_ord in configs:
        locs = city_locations.get(city_id, [])
        if not locs:
            print(f"Warning: No locations found for {city_name}")
            continue

        network = generate_city_network(
            city_id=city_id,
            city_name=city_name,
            raw_locations=locs,
            seed=seed,
            num_warehouses=num_wh,
            num_orders=num_ord,
        )

        out_path = os.path.join(output_dir, f"{city_id}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(network.model_dump_json(indent=2))
        print(f"Generated {city_name}: {out_path} ({len(network.warehouses)} WH, {len(network.orders)} Orders, {len(network.routes)} Routes)")
