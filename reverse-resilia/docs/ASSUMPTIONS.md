# ReverseResilia — Operational Assumptions & Modeling Scope

**Project:** ReverseResilia — Goal-Driven Supply Chain Recovery  
**Team:** Runtime Rebels  

---

## 1. Scope & Modeling Boundary

ReverseResilia is an operational **decision-support platform** designed to provide provably optimal recovery reassignment plans during supply-chain disruptions.

It is **not** an automated real-time vehicle dispatch or ERP telemetry system.

---

## 2. Key Modeling Assumptions

### 1. Indivisible Customer Orders
- Each customer order is treated as an indivisible unit demand ($d_i \ge 1$).
- A single customer order must be served in full from exactly one fulfillment facility or remain unfulfilled.
- Split deliveries from multiple warehouses for a single order are excluded for the MVP to prevent partial delivery tracking complexity.

### 2. Single Delivery Planning Period
- Recovery plans are calculated for a discrete delivery horizon (e.g., standard intra-day delivery window of 90 to 180 minutes).
- Facility processing capacity represents maximum order handling throughput per shift/period.

### 3. Road Network Distance & Circuity Factor
- Real road network transit distances are calculated from Great Circle (Haversine) formulas augmented with a calibrated **1.32x urban circuity factor**, accurately reflecting Indian urban road topology.
- Intra-city dispatch transit speed is modeled at a conservative 32 km/h plus 15 minutes order prep and staging buffer.

### 4. Discrete Priced Interventions
- Emergency interventions are modeled as finite discrete packages with explicit fixed costs:
  - **Emergency Stock Bundles:** Expedited inter-depot stock replenishment transfers adding inventory units.
  - **Overtime Handling Shifts:** Emergency labor crews expanding warehouse order handling capacity.
  - **Express Transport Upgrades:** Expedited dedicated vehicle lanes reducing transit times.

### 5. Priority Orders
- Critical priority orders must be fulfilled on time under `HARD` policy.
- If physical constraints prevent fulfilling any critical order, the system reports INFEASIBLE and identifies the specific order.

### 6. Zero Paid Infrastructure & Offline Operation
- Works 100% offline without live internet, cloud solvers, or tile servers.
- Primary visual demo relies on local SVG/canvas vector maps and HTML tables.
