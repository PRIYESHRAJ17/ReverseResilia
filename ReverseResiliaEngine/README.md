# ReverseResilia

A local, five-region supply-chain recovery planner for Runtime Rebels. Simulate a disruption, measure its immediate impact, maximize service with the remaining resources, and price a target recovery plan. Every exported assignment comes from a stored, independently checked run.

## Run the prepared app

From this project directory in PowerShell, using the installed project environment and production frontend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open [the app](http://127.0.0.1:8000). The API, UI, fonts, city datasets, solver and map are local. The source PBFs are needed only when rebuilding the geography. Regional presets are read from `data/*.json`. Runs and their exact inputs persist in local SQLite. The dashboard saves scenario inputs by region in IndexedDB. Reloading restores the selected region, view and inputs. Each bundled region repeats its 24 delivery sites across five labeled demand cycles, giving 120 orders. User imports keep the warehouse resources supplied.

### Fresh setup

Use Python 3.12 and Node 22.12+ or 24. Internet access is required to install packages the first time.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

For frontend development, keep the API at port 8000 and run `npm run dev --prefix frontend`. Vite proxies API requests to the backend.

## Demonstrate a recovery

1. Open Bengaluru. Select a warehouse or order on the network to inspect its PIN reference and operating assumptions. Expand **Edit network inputs** to change individual records or import an ID-keyed CSV of operational edits.
2. Under **Disruption simulator**, choose a warehouse outage and W1. The original assignments stay fixed for the immediate impact calculation. A capacity reduction retains original orders in earliest-deadline order with order ID as a tie-break.
3. Calculate natural recovery. Stage A maximizes the number of complete on-time orders. Once that maximum is proved, Stage B fixes the count and minimizes delivery cost.
4. Open **Recovery planner**, choose a target and budget, and select the permitted packages. Stage C minimizes modeled delivery and activation costs subject to the target. A target of 100% can be infeasible. Changing the budget changes the comparison with plan cost. A proven minimum is necessary for an exact deficit.
5. Inspect baseline, disrupted and recovered assignments in **Scenario comparison**. Open **Action sheet**, check the independent findings and export the exact run as CSV. Plan-level totals repeat on each order row and should be counted once per run.
6. Reduce a warehouse's stock or an order's deadline and rerun. The UI discards outdated target results. The independently recomputed baseline reflects the edited network before disruption.

## Working with updated inputs

Use **Edit network inputs → Import CSV edits** to change records. For new orders at an existing delivery address, use the columns `id,site_order_id,quantity_units,deadline_min,critical`. Supply an existing order ID as the site and a distinct new ID for each order. For a new delivery location, use `id,name,pin,lat,lon,quantity_units,deadline_min,critical`. The importer snaps the coordinates to the city's bundled road graph and computes routes from each warehouse. A failed import leaves the network intact. In a packages CSV, use `id,lead_min` to change activation time.

Base handling slots are capped by stock units. The initial budget estimates delivery cost using the lowest available quote from an active stocked warehouse for each order. The budget field remains editable. The planner calculates a target plan and a separate maximum-service plan within the entered budget. The existing result details report the comparison. For the verified budget plan CSV, append `?plan=budget` to the run export URL. JSON responses include the assignments, verification and whether the maximum was proved.

For programmatic use, POST a network and `speed_kmh`, `dispatch_min`, `fee_inr`, `inr_per_km` to `/api/network/reprice` to recalculate route quotes from stored road distances. GET `/api/runs/{run_id}/scenario` for the scenario JSON. POST it to `/api/scenarios/validate` to validate and restore the inputs, or to the existing recovery endpoints to solve them.

## Geography and provenance

The preprocessing program uses the Python bindings for libosmium. It streams the supplied regional extracts, collects source nodes inside each city box, reads drivable ways, and constructs directed edges only between consecutive retained OSM nodes. It honors explicit one-way tags, reverse one-way, roundabouts, motorway default direction, and common private/motor-vehicle access restrictions. Each regional graph is cached as a compressed node and adjacency file in `data/roads/`. The city preset contains the reusable route matrix and sampled shortest-path geometry for the offline map. Geography is a bounded operating area. A Delhi NCR preset samples the Delhi core.

```powershell
.\.venv\Scripts\python.exe scripts/prepare_data.py "$env:USERPROFILE\Downloads"
.\.venv\Scripts\python.exe scripts/prepare_data.py "$env:USERPROFILE\Downloads" --city bengaluru --reuse-graphs --speed-kmh 24 --dispatch-min 12
```

The default run builds all five graphs. A cache rebuild verifies the PBF hash and bounding box against the previous manifest. Each preset records PBF and CSV file names, byte sizes, SHA-256 hashes, extract bounds in west/south/east/north order, seed, graph counts, speed, and dispatch assumptions. Files remain in Downloads. Source mapping:

| Extract | Region |
|---|---|
| southern-zone-261112.osm.pbf | Bengaluru and Chennai |
| western-zone-261112.osm.pbf | Mumbai |
| northern-zone-261112.osm.pbf | Delhi NCR |
| north-eastern-zone-261112.osm.pbf | Guwahati |
| pincode.csv | Postal-office reference coordinates for all five |

The CSV has 157,126 office records, 19,300 distinct PIN values, and 9,470 records failing numeric/range/zero-pair coordinate checks. Multiple offices can share a PIN. The generator checks state, district where applicable, bounding box, six-digit PIN and a road snap within 500 metres. It samples distinct PINs and snapped nodes with a fixed seed. The sourced coordinates represent postal references rather than surveyed facility addresses. The supplied CSV's original publisher/licence was not established from its contents.

| Fields | Provenance and units |
|---|---|
| PIN, office name, latitude, longitude | Sourced from the supplied postal CSV. |
| Road node and snap distance | Derived from the nearest retained OSM road node. |
| Road distance and shape | Directed shortest path using Dijkstra. Edge lengths use spherical distance rounded to millimetres. Route lengths are returned in metres. The map simplifies the path geometry after routing. |
| Facilities, customers, orders, stock, capacity, activation packages, deadlines | Seeded simulated operations, one SKU, indivisible orders and a 1,440-minute horizon. |
| Completion time | Simulated dispatch time plus ceiling of road distance divided by modeled speed. Unreachable routes have null measurements and remain unavailable. |
| Cost | Simulated INR 40 plus ceiling of INR 9 per route kilometre. Package charges are added once. Each option's delivery time and cost can be edited. |
| Service, assignments, budget and costs | Computed from the active scenario. Each saved run contains its source manifest, current edited inputs and SHA-256 input identity. |

Routing models ordinary drivable roads, directionality and static access. Turn restrictions, temporary traffic conditions, time-dependent restrictions, loading queues and vehicle tours are outside this distance model. The planner treats dispatch plus travel as independent per-order elapsed time. Multiple warehouse orders can use the same lane network simultaneously. A transport package can enable one existing, geographically reachable warehouse–order option and carries a separately priced operational activation. Bundled packages are available at dispatch. Imported packages may specify a nonnegative lead_min. Orders using added inventory, handling slots or a reopened lane must wait for activation and still meet the deadline. A warehouse outage prevents use of its stock and packages.

Road data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The regional road extracts and OSM-derived matrix geometry retain that attribution.

## Optimization and evidence

The same integer OR-Tools CP-SAT model serves every city. Each binary assignment consumes one slot and the order's entire stock quantity. Warehouse activity, availability, travel time, order deadline, horizon, allowed interventions, and optional hard protection of critical orders constrain eligibility. Target service uses the ceiling of percentage times order count. With priority protection disabled all orders have equal objective weight.

The solver uses one worker and an eight-second limit per stage. OPTIMAL proves the stage objective. FEASIBLE supplies a candidate and a bound. UNKNOWN supplies no actionable plan. INFEASIBLE means the stated constraints cannot be met. MODEL_INVALID reports a model error. The independent checker recalculates identity, authorized packages, duplicates, stock, slots, time, availability, critical service, target, delivered count, costs, and budget arithmetic. It checks feasibility; it cannot certify global optimality. Failed or absent verification disables CSV export.

The API is specified at [localhost/docs](http://127.0.0.1:8000/docs). The network endpoint supplies validated inputs. The impact endpoint computes the baseline and preserved assignments. Solver calls store run records transactionally. Exports reload the snapshot and repeat verification before serialization.

## UI reference

The interface uses the supplied PP Neue Montreal and FH Phemister fonts, lime-on-black palette, compact active navigation, heading entrance and the reference’s 0.4-second exit and one-second entry transitions. The five application views use forms, an offline SVG, and scrollable tables. Native vertical scrolling and keyboard-operable controls support long data views. The template's real-estate gallery, orbit, imagery and booking flow have no corresponding recovery operation. The application uses ordinary document scrolling in place of the full-screen 3D interaction modes.

## Verification commands

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm run build --prefix frontend
.\.venv\Scripts\python.exe scripts/check_browser.py --url http://127.0.0.1:8000
```

The browser test expects installed Chrome on Windows. Override the executable with `--browser`. It drives the production UI against the real backend, blocks external requests, saves 1440/768/390 px screenshots to `work/qa`, and exercises edits, an outage, the solver, export, stale results and API errors. Use `--reference` with a local server hosting the supplied template's dist directory for a reference capture.

## Acceptance results, 13 November 2026

The project suite passed 24 tests. The only warning was a Starlette deprecation notice for its httpx-based test client. Vite produced the production build. Chrome completed the local-only user journey after a clean server restart, including operational CSV import, solver calls, independent verification, 24 exported order rows, city switching, API failure feedback and desktop, tablet and mobile layouts.

The ten-order contract fixture returned 8/10 with existing capacity. With the two eligible handling packages it returned 10/10, INR 800 in activation fees and INR 100 in fixture delivery charges. All three stages proved optimal. Deliberately corrupted assignments, package selections, costs, deadlines, identity and stage failed independent verification.

The following historical results were calculated on the original 24-order city presets with W1 offline, all offered packages allowed, priority protection off, a 100% target, and an INR 50,000 budget. Every city had four warehouses and 24 orders. The numbers are reproducibility evidence; the application calculates its own results on every run.

| City | Routable pairs / 96 | Baseline served | Immediately affected | Maximum natural service | Cheapest natural cost (INR) | 100% target |
|---|---:|---:|---:|---:|---:|---|
| Bengaluru | 96 | 24 | 7 | 21 | 2,429 | OPTIMAL, INR 3,422, checker PASS |
| Mumbai | 96 | 24 | 6 | 21 | 2,022 | OPTIMAL, INR 2,910, checker PASS |
| Delhi NCR | 92 | 23 | 7 | 21 | 2,628 | INFEASIBLE |
| Chennai | 72 | 21 | 7 | 14 | 1,267 | INFEASIBLE |
| Guwahati | 96 | 24 | 3 | 21 | 2,320 | OPTIMAL, INR 3,057, checker PASS |

All five city integrations ran through the API tests. The detailed browser walkthrough exercised Bengaluru and switched to Guwahati. The five-view frontend adapts the visual reference to recovery operations; its gallery-specific motion has no application equivalent.

