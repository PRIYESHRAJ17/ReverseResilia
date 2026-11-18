"""Build offline regional road graphs and operational presets from the supplied files."""
import argparse
import csv
import gzip
import hashlib
import heapq
import json
import math
import random
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CITIES = [
    ("bengaluru", "Bengaluru", "southern", 12.97, 77.59, "KARNATAKA"),
    ("chennai", "Chennai", "southern", 13.08, 80.27, "TAMIL NADU"),
    ("mumbai", "Mumbai", "western", 19.06, 72.88, "MAHARASHTRA"),
    ("delhi_ncr", "Delhi NCR", "northern", 28.63, 77.21, "DELHI"),
    ("guwahati", "Guwahati", "north-eastern", 26.16, 91.76, "ASSAM"),
]
ROADS = set("motorway trunk primary secondary tertiary unclassified residential living_street service".split())
ROADS.update(r + "_link" for r in ("motorway", "trunk", "primary", "secondary", "tertiary"))
RADIUS = .18
SPEED = 24
DISPATCH = 12
DISTRICTS = {"KARNATAKA":{"BENGALURU URBAN"}, "TAMIL NADU":{"CHENNAI"},
             "MAHARASHTRA":{"MUMBAI","MUMBAI SUBURBAN"}, "ASSAM":{"KAMRUP METRO","KAMRUP"}}


def meters(a, b):
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    half_lat = (lat2 - lat1) / 2
    half_lon = math.radians(b[1] - a[1]) / 2
    return 12742000 * math.asin(math.sqrt(math.sin(half_lat)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(half_lon)**2))


def road_graph(path, cy, cx):
    import osmium
    # Only edges whose consecutive source nodes both fall inside the box survive.
    locations = {}
    for node in osmium.FileProcessor(path, osmium.osm.NODE):
        loc = node.location
        if abs(loc.lat - cy) <= RADIUS and abs(loc.lon - cx) <= RADIUS:
            locations[node.id] = (loc.lat, loc.lon)
    adjacency = defaultdict(dict)
    used = set()
    ways = osmium.FileProcessor(path, osmium.osm.WAY).with_filter(osmium.filter.KeyFilter("highway"))
    for way in ways:
        tags = way.tags
        if tags["highway"] not in ROADS:
            continue
        access = next((tags[k] for k in ("motorcar","motor_vehicle","vehicle","access") if k in tags), "yes")
        if access in {"no","private","agricultural","forestry"} or tags.get("area") == "yes":
            continue
        direction = tags.get("oneway", "yes" if tags.get("junction") == "roundabout" or tags["highway"] == "motorway" else "no")
        previous = None
        for ref in way.nodes:
            current = ref.ref
            if previous in locations and current in locations:
                length = max(1, round(meters(locations[previous], locations[current])*1000))
                if direction != "-1":
                    edges = adjacency[previous]
                    edges[current] = min(length, edges.get(current, length))
                if direction not in {"yes","true","1"}:
                    edges = adjacency[current]
                    edges[previous] = min(length, edges.get(previous, length))
                used.update((previous, current))
            previous = current
    return {k: locations[k] for k in sorted(used)}, adjacency


def distances(graph, origin, targets):
    todo = [(0, origin)]
    result = {origin: 0}
    parent = {}
    remaining = set(targets)
    while todo and remaining:
        distance, node = heapq.heappop(todo)
        if distance != result[node]:
            continue
        remaining.discard(node)
        for other, weight in graph.get(node, {}).items():
            candidate = distance + weight
            if candidate < result.get(other, math.inf):
                result[other] = candidate
                parent[other] = node
                heapq.heappush(todo, (candidate, other))
    routes = {}
    for node in targets:
        if node not in result:
            continue
        path = [node]
        while path[-1] != origin:
            path.append(parent[path[-1]])
        routes[node] = (round(result[node]/1000), list(reversed(path)))
    return routes


def pick_points(rows, state, cy, cx, nodes, rng, n):
    buckets = defaultdict(list)
    for node, (lat, lon) in nodes.items():
        buckets[int(lat*100), int(lon*100)].append(node)
    candidates = sorted(rows, key=lambda r: (r["Pincode"], r["OfficeName"]))
    rng.shuffle(candidates)
    points, seen_pins, seen_nodes = [], set(), set()
    for row in candidates:
        if state in DISTRICTS and row["District"].strip().upper() not in DISTRICTS[state]:
            continue
        pin = row["Pincode"].strip()
        if row["StateName"].strip().upper()!=state or pin in seen_pins or len(pin)!=6 or not pin.isdigit():
            continue
        try:
            lat, lon = float(row["Latitude"]), float(row["Longitude"])
        except ValueError:
            continue
        if not (abs(lat-cy)<.125 and abs(lon-cx)<.125):
            continue
        y,x = int(lat*100),int(lon*100)
        nearby = [k for i in range(y-1,y+2) for j in range(x-1,x+2) for k in buckets[i,j]]
        if not nearby:
            continue
        node = min(nearby,key=lambda k: meters((lat,lon),nodes[k]))
        delta = meters((lat,lon),nodes[node])
        if delta > 500 or node in seen_nodes:
            continue
        points.append(dict(pin=pin,name=row["OfficeName"].strip(),lat=lat,lon=lon,node=node,snap_m=round(delta)))
        seen_pins.add(pin)
        seen_nodes.add(node)
        if len(points)==n:
            break
    if len(points)<24:
        raise ValueError(f"Only {len(points)} distinct routable PIN references for {state}")
    return points


def manifest(path):
    with path.open("rb") as stream:
        return dict(file=path.name, bytes=path.stat().st_size, sha256=hashlib.file_digest(stream,"sha256").hexdigest())


def generate(source, dest, city, rows, csv_source, seed, reuse=False, speed=SPEED, dispatch=DISPATCH):
    key,name,region,cy,cx,state=city
    pbf=source/f"{region}-zone-261112.osm.pbf"
    print(f"{name}: reading {pbf.name}",flush=True)
    extract=dest/"roads"/(key+".json.gz")
    target=dest/(key+".json")
    pbf_source=manifest(pbf)
    if reuse:
        previous=json.loads(target.read_text(encoding="utf8"))["provenance"]
        if previous["sources"][0]!=pbf_source or previous["bbox"]!=[cx-RADIUS,cy-RADIUS,cx+RADIUS,cy+RADIUS]:
            raise ValueError("Cached graph has a different source hash or extent")
        with gzip.open(extract,"rt",encoding="utf8") as f:
            raw=json.load(f)
        nodes={int(k):v for k,v in raw.pop("nodes").items()}
        graph={int(k):{int(j):w for j,w in adj.items()} for k,adj in raw.pop("edges").items()}
    else:
        nodes, graph = road_graph(pbf,cy,cx)
    rng=random.Random(seed)
    points=pick_points(rows,state,cy,cx,nodes,rng,28)
    warehouses=[dict(**p,id=f"W{i+1}",stock_units=rng.randint(18,22),capacity_orders=7,active=True) for i,p in enumerate(points[:4])]
    orders=[dict(**p,id=f"O{i+1:02}",customer_id=f"C{i+1:02}",quantity_units=rng.randint(1,3),deadline_min=rng.choice([75,95,120]),critical=i%7==0) for i,p in enumerate(points[4:])]
    lanes=[]
    packages=[]
    for w in warehouses:
        matrix=distances(graph,w["node"],[o["node"] for o in orders])
        for o in orders:
            length,path=matrix.get(o["node"],(None,[]))
            # Retain turn geometry; downsample dense shape nodes for the offline SVG.
            shape=[]
            for i,node in enumerate(path):
                coord=nodes[node]
                if not shape or i==len(path)-1 or meters(shape[-1],coord)>=75:
                    shape.append(coord)
            lanes.append(dict(id=w["id"]+"-"+o["id"],warehouse=w["id"],order=o["id"],distance_m=length,shape=shape,
                              travel_min=None if length is None else dispatch+math.ceil(length*60/(1000*speed)),
                              cost_inr=None if length is None else 40+math.ceil(length*.009),available=length is not None))
        for kind,amount,price in [("stock",8,520),("capacity",3,360)]:
            packages.append(dict(id=kind+"-"+w["id"],kind=kind,warehouse=w["id"],amount=amount,price_inr=price,lead_min=0))
        lane=next((l for l in lanes if l["warehouse"]==w["id"] and l["available"]),None)
        if lane:
            packages.append(dict(id="transport-"+lane["id"],kind="transport",warehouse=w["id"],lane=lane["id"],amount=1,price_inr=190,lead_min=0))
    provenance=dict(sources=[pbf_source,csv_source],bbox=[cx-RADIUS,cy-RADIUS,cx+RADIUS,cy+RADIUS],nodes=len(nodes),
                    directed_edges=sum(map(len,graph.values())),speed_kmh=speed,dispatch_min=dispatch,snap_limit_m=500,
                    coordinates="Sourced pincode.csv office reference points",operations="Simulated, seeded, one product and one period",
                    distance="Directed Dijkstra on clipped OSM roads, millimetre edge weights rounded to metres per route",
                    time="Derived + simulated: dispatch minutes plus distance at modeled speed, rounded up",
                    cost="Simulated INR 40 + ceil(0.009 × route metres)",attribution="© OpenStreetMap contributors, ODbL 1.0")
    output=dict(id=key,name=name,schema_version=1,seed=seed,horizon_min=1440,warehouses=warehouses,orders=orders,
                lanes=lanes,packages=packages,provenance=provenance)
    # Persist the sourced directed extract separately so the app loads only the matrix.
    extract.parent.mkdir(parents=True,exist_ok=True)
    if not reuse:
        with gzip.open(extract.with_suffix(".tmp"),"wt",encoding="utf8",compresslevel=4) as f:
            json.dump(dict(nodes=nodes,edges=graph),f,separators=(",",":"))
        extract.with_suffix(".tmp").replace(extract)
    target.with_suffix(".tmp").write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding="utf8")
    target.with_suffix(".tmp").replace(target)
    print(f"{name}: {len(nodes)} road nodes, {sum(l['available'] for l in lanes)}/{len(lanes)} reachable pairs",flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source",type=Path)
    parser.add_argument("--city",choices=[c[0] for c in CITIES])
    parser.add_argument("--output",type=Path,default=ROOT/"data")
    parser.add_argument("--reuse-graphs",action="store_true")
    parser.add_argument("--speed-kmh",type=int,default=SPEED)
    parser.add_argument("--dispatch-min",type=int,default=DISPATCH)
    args=parser.parse_args()
    if args.speed_kmh<=0 or args.dispatch_min<0:
        parser.error("Speed must be positive and dispatch time nonnegative")
    csv_path=args.source/"pincode.csv"
    with csv_path.open(encoding="utf-8-sig",newline="") as f:
        rows=list(csv.DictReader(f))
    for idx,city in enumerate(CITIES):
        if not args.city or args.city==city[0]:
            generate(args.source,args.output,city,rows,manifest(csv_path),261112+idx,args.reuse_graphs,args.speed_kmh,args.dispatch_min)

