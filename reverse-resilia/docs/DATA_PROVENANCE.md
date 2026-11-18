# ReverseResilia — Data Provenance & Real Geography Layer

**Project:** ReverseResilia — Goal-Driven Supply Chain Recovery  
**Team:** Runtime Rebels  

---

## 1. Provenance Classifications

Every data element in ReverseResilia is explicitly classified under three provenance tiers:

| Tier | Provenance Tag | Source / Methodology |
|------|----------------|----------------------|
| **Tier 1** | `sourced geography` | Real GPS coordinates, authentic Indian PIN codes, and official post office names extracted from `pincode.csv` and OpenStreetMap regional extracts (`*.osm.pbf`). |
| **Tier 2** | `derived from sourced geography` | Road transit distance (km) and delivery duration (minutes) derived via Haversine calculation with 1.32x urban circuity factor and calibrated urban transit speeds (32 km/h). |
| **Tier 3** | `simulated operations` | Calibrated inventory levels, processing capacities, order deadlines, unit demand, transport tariffs, and intervention package costs. |

---

## 2. Five Supported Regional Networks

The application provides 5 distinct regional networks covering major commercial centers across India:

1. **Bengaluru** (Karnataka — Southern Zone): 4 Warehouses, 30 Orders, 120 Routes.
2. **Mumbai** (Maharashtra — Western Zone): 4 Warehouses, 30 Orders, 120 Routes.
3. **Delhi NCR** (Delhi / Gurgaon / Noida — Northern Zone): 4 Warehouses, 30 Orders, 120 Routes.
4. **Chennai** (Tamil Nadu — Southern Zone): 4 Warehouses, 30 Orders, 120 Routes.
5. **Guwahati** (Assam — North-Eastern Zone): 4 Warehouses, 25 Orders, 100 Routes.

All 5 regions share the exact same optimization engine, data contract schema, and independent verification rules.
No city-specific optimization heuristics or hard-coded shortcuts exist.
