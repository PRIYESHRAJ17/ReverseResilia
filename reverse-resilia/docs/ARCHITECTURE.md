# ReverseResilia — System Architecture & Mathematical Formulation

**Project:** ReverseResilia — Goal-Driven Supply Chain Recovery  
**Team:** Runtime Rebels (ReverseResilia, Open Innovation Track)  
**Authors:** Runtime Rebels P M  

---

## 1. High-Level Architecture

ReverseResilia is designed as a provable, mathematically sound decision-support engine for regional supply-chain recovery during disruptions (warehouse shutdowns, severed road corridors, labor/capacity shocks).

```
+---------------------------------------------------------------------------------+
|                                USER INTERFACE                                   |
|  (Modular React + Vite & Standalone 100% Offline SVG Dashboard at localhost)    |
+----------------------------------------+----------------------------------------+
                                         | REST API (JSON)
                                         v
+---------------------------------------------------------------------------------+
|                             FASTAPI BACKEND SERVICE                             |
|  - Data Contracts & Strict Pydantic V2 Validation                               |
|  - Impact Analysis Engine (Pre-Recovery Disruption Assessment)                  |
|  - Scenario State Comparer (Baseline vs Disrupted vs Recovered)                 |
|  - Action Sheet & CSV Exporter                                                  |
+-------------------+-------------------------------------+-----------------------+
                    |                                     |
                    v                                     v
+-----------------------------------+   +-----------------------------------------+
|     MATHEMATICAL OPTIMIZATION     |   |          INDEPENDENT VERIFIER           |
|  - Stage A: Max Natural Recovery  |   |  - Zero Trust in Solver Totals          |
|  - Stage B: Cheapest Natural Plan |   |  - Recalculates from Raw Inputs:        |
|  - Stage C: Target-Based Recovery |   |    * Assignment Uniqueness              |
|  - Discrete Priced Interventions  |   |    * Facility Active Status             |
|  - Dual Solvers:                  |   |    * Open Route & Lane Status           |
|    * HiGHS MIP (scipy.optimize)   |   |    * Delivery Timing vs Deadlines       |
|    * Google OR-Tools CP-SAT       |   |    * Priority Order Compliance          |
|  - Honest Infeasibility Analysis  |   |    * Intervention Catalog Conformance   |
+-------------------+---------------+   |    * Inventory & Processing Limits      |
                    |                   |    * Cost Totals Recalculation          |
                    |                   +-----------------------------------------+
                    v                                     ^
+---------------------------------------------------------+-----------------------+
|                             DATA LAYER & PROVENANCE                             |
|  - 5 Regional Networks (Bengaluru, Mumbai, Delhi NCR, Chennai, Guwahati)       |
|  - Real Geographic Coordinates (pincode.csv GPS Directory)                      |
|  - Derived Road Distance Matrices (Great Circle + 1.32 Circuity Factor)         |
|  - Simulated Operational Attributes (Explicitly Provenance-Tagged)              |
+---------------------------------------------------------------------------------+
```

---

## 2. Mathematical Formulation

Let:
- $\mathcal{I} = \{1, \dots, N\}$ be the set of customer orders.
- $\mathcal{J} = \{1, \dots, M\}$ be the set of regional warehouses.
- $\mathcal{K} = \{1, \dots, K\}$ be the catalog of available emergency interventions.
- $d_i \in \mathbb{Z}^+$ be the demand units of order $i$ (indivisible).
- $D_i \in \mathbb{Z}^+$ be the delivery cutoff deadline in minutes for order $i$.
- $S_j \in \mathbb{Z}^+$ be the surviving effective stock of warehouse $j$.
- $C_j \in \mathbb{Z}^+$ be the surviving effective processing capacity of warehouse $j$.
- $T_{j,i}$ be the transit time (minutes) from warehouse $j$ to order $i$.
- $c_{j,i}$ be the transport cost + warehouse handling cost for serving order $i$ from warehouse $j$.
- $p_k \in \mathbb{R}^+$ be the discrete activation price of intervention $k$.
- $\delta_{s,k} \ge 0$ be the stock increment provided by intervention $k$.
- $\delta_{c,k} \ge 0$ be the processing capacity increment provided by intervention $k$.

### Decision Variables

$$
x_{i,j} \in \{0, 1\} \quad \forall i \in \mathcal{I}, j \in \mathcal{J}
$$
$x_{i,j} = 1$ if order $i$ is assigned to warehouse $j$, 0 otherwise.

$$
y_k \in \{0, 1\} \quad \forall k \in \mathcal{K}
$$
$y_k = 1$ if intervention package $k$ is activated, 0 otherwise.

---

### Constraints

#### 1. Indivisible Assignment Uniqueness
$$
\sum_{j \in \mathcal{J}} x_{i,j} \le 1 \quad \forall i \in \mathcal{I}
$$

#### 2. Feasibility Filtering (Operational Status & Deadlines)
If warehouse $j$ is inactive, or route $(j, i)$ is closed, or transit time $T_{j,i} > D_i$:
$$
x_{i,j} = 0
$$

#### 3. Warehouse Inventory Balance
$$
\sum_{i \in \mathcal{I}} d_i \cdot x_{i,j} \le S_j + \sum_{k \in \mathcal{K}: \text{target}(k)=j} \delta_{s,k} \cdot y_k \quad \forall j \in \mathcal{J}
$$

#### 4. Warehouse Processing Capacity
$$
\sum_{i \in \mathcal{I}} x_{i,j} \le C_j + \sum_{k \in \mathcal{K}: \text{target}(k)=j} \delta_{c,k} \cdot y_k \quad \forall j \in \mathcal{J}
$$

#### 5. Priority Protection (HARD Policy)
For critical priority orders $\mathcal{I}_{\text{crit}} \subseteq \mathcal{I}$:
$$
\sum_{j \in \mathcal{J}} x_{i,j} = 1 \quad \forall i \in \mathcal{I}_{\text{crit}}
$$
*(If physical constraints prevent fulfilling any critical order, the solver proves INFEASIBLE and pinpoints the bottleneck).*

---

### Optimization Stages

#### Stage A: Maximum Natural Recovery
Evaluates surviving network capacity with zero emergency intervention expenditure ($y_k = 0 \ \forall k$):
$$
\max \sum_{i \in \mathcal{I}} \sum_{j \in \mathcal{J}} x_{i,j}
$$
Let the proven maximum on-time fulfilled count be $M^*$.
Natural Recovery Percentage = $100 \times \frac{M^*}{N}$.

#### Stage B: Cheapest Natural Recovery
Preserves the exact maximum service level $M^*$ while finding the minimal operational expenditure:
$$
\min \sum_{i \in \mathcal{I}} \sum_{j \in \mathcal{J}} c_{j,i} \cdot x_{i,j}
$$
Subject to:
$$
\sum_{i \in \mathcal{I}} \sum_{j \in \mathcal{J}} x_{i,j} \ge M^*, \quad y_k = 0 \ \forall k
$$

#### Stage C: Target-Based Recovery
User selects target service percentage $\tau \in [0, 100]$ (e.g., 90%, 95%, 100%).
Target order threshold: $T^* = \lceil \frac{\tau}{100} \cdot N \rceil$.
Permits optimizer to activate available priced interventions $y_k \in \{0, 1\}$:
$$
\min \sum_{i \in \mathcal{I}} \sum_{j \in \mathcal{J}} c_{j,i} \cdot x_{i,j} + \sum_{k \in \mathcal{K}} p_k \cdot y_k
$$
Subject to:
$$
\sum_{i \in \mathcal{I}} \sum_{j \in \mathcal{J}} x_{i,j} \ge T^*
$$

---

## 3. Honest Infeasibility Diagnostics

When target $T^*$ cannot be reached even with all permitted interventions activated:
1. **Total Network Stock Deficit:** $\sum S_j + \sum \delta_{s,k} < \text{Target Demand}$.
2. **Total Processing Capacity Deficit:** $\sum C_j + \sum \delta_{c,k} < T^*$.
3. **Geographic / Deadline Disconnect:** Reassignment transit time exceeds customer deadlines for too many customers.
4. **Zero Fabricated Costs:** Never report a fabricated cost for an impossible target.
