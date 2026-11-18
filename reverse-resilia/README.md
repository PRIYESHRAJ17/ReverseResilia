# ReverseResilia — Goal-Driven Supply Chain Recovery

> **Recover to a target. And prove it holds.**

**Team:** Runtime Rebels  
**Track:** Open Innovation Track, ReverseResilia Hackathon  
**Institution:** Dr. Ambedkar Institute of Technology, Bengaluru  

---

## 1. Executive Summary

When severe disruptions strike supply chains — facility fires, flash floods, transport corridor shutdowns, or labor strikes — operational planners face critical questions:
- *How many customer deliveries can still arrive on time?*
- *Can spare inventory and handling capacity at other warehouses absorb the shock?*
- *What is the maximum natural recovery achievable with zero emergency budget?*
- *If executive management requires 100% on-time service, what is the exact minimum modeled expenditure?*
- *Can the recovery plan be independently proven feasible rather than taken on trust?*

**ReverseResilia** is a decision-support and mathematical optimization platform built to answer these questions with mathematical rigor. Powered by Mixed-Integer Linear Programming (HiGHS MIP and Google OR-Tools CP-SAT) with an independent verification module, ReverseResilia determines provable optimal reassignments, calculates required emergency interventions, and rejects infeasible plans without fabricating numbers.

---

## 2. All 18 Implemented Features

| Feature ID | Feature Name | Status | Technical Implementation |
|:---|:---|:---:|:---|
| **Feature 1** | Five-City Selector | Completed | Select between Bengaluru, Mumbai, Delhi NCR, Chennai, and Guwahati networks. |
| **Feature 2** | Editable Supply-Chain Network | Completed | Inspect and edit warehouse stock, capacity, active status, customer demand, deadlines. |
| **Feature 3** | Data Import & Validation | Completed | Strict Pydantic V2 schema validation for coordinates, non-negative quantities, IDs. |
| **Feature 4** | Interactive Network Visualization | Completed | 100% offline local SVG vector visualization displaying facilities, customers, and routes. |
| **Feature 5** | Disruption Simulator | Completed | Inject warehouse failures, closed arterial lanes, and capacity reductions. |
| **Feature 6** | Immediate Impact Analysis | Completed | Compares baseline with disrupted state before recovery; isolates severed orders. |
| **Feature 7** | Natural Recovery Percentage | Completed | Maximizes on-time service using surviving facilities without emergency interventions. |
| **Feature 8** | Priority-Aware Allocation | Completed | `HARD` and `SOFT` priority policies protecting critical customer commitments. |
| **Feature 9** | Target and Budget Controls | Completed | Sliders for target service (0–100%), recovery budget ceiling in INR, and priority rules. |
| **Feature 10** | Cheapest Existing-Resource Plan | Completed | Stage B optimization minimizes operational cost holding maximum natural service level. |
| **Feature 11** | Minimum-Cost Target Recovery | Completed | Stage C optimization finds proven minimum expenditure to achieve chosen target. |
| **Feature 12** | Priced Recovery Actions | Completed | Discrete catalog of stock transfers, overtime labor shifts, and express routes. |
| **Feature 13** | Honest Infeasibility Reporting | Completed | Pinpoints exact limiting constraints when targets cannot physically be met; ₹0 fabricated cost. |
| **Feature 14** | Independent Verification | Completed | Independent checker recalculates all constraints from raw network inputs. |
| **Feature 15** | Solver Status Transparency | Completed | Exposes OPTIMAL, FEASIBLE, INFEASIBLE with solve execution time in milliseconds. |
| **Feature 16** | Scenario Comparison | Completed | Evaluates Baseline vs Disrupted (Pre-Recovery) vs Recovered (Optimized) audit table. |
| **Feature 17** | Recovery Action Sheet & CSV Export | Completed | Itemized source warehouse assignments, transit times, deadlines, and CSV export. |
| **Feature 18** | Responsive & Rerunnable Application | Completed | Input hashes prevent stale result reuse; live recalculations on every parameter edit. |

---

## 3. Technology Stack & Zero-Budget Architecture

- **Backend:** Python 3.11+, FastAPI, Pydantic V2, Uvicorn
- **Mathematical Optimization Engine:**
  - **HiGHS Mixed-Integer Programming (via `scipy.optimize.milp`):** Native, exact branch-and-bound optimization with proven optimality certificates.
  - **Google OR-Tools CP-SAT:** Constraint programming solver integration.
- **Independent Verifier:** Dedicated constraint and cost recomputation engine.
- **Frontend / UI:**
  - Standalone 100% offline SVG & CSS dashboard served at `http://localhost:8000/`.
  - Modular React + Vite frontend scaffold in `frontend/` ready for custom template injection.
- **Data Layer:** Real Indian PIN codes from `pincode.csv`, OpenStreetMap road zone extracts, and deterministic operational data.
- **Testing:** Comprehensive pytest suite (21 automated unit and integration tests).
- **Budget:** **₹0** — No paid APIs, no subscriptions, no commercial solver licenses, no internet required.

---

## 4. Setup and Quickstart

### Prerequisites
- Python 3.11+
- Node.js 20+ (optional for React Vite frontend)

### Installation
```bash
# Clone or navigate to the repository
cd reverse-resilia

# Install backend dependencies (all free, open-source wheels)
pip install -r requirements.txt
```

### Running the Application

#### Option A: Run the Backend & Standalone Offline Dashboard (Recommended)
```bash
cd reverse-resilia
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```
Open **`http://localhost:8000/`** in any web browser.  
- Switch cities, inject disruptions, run natural recovery, solve 100% target recovery, verify plans, and export action sheets immediately.
- Swagger API documentation is available at **`http://localhost:8000/docs`**.

#### Option B: Run the React + Vite Development Frontend
```bash
cd reverse-resilia/frontend
npm install
npm run dev
```
Open **`http://localhost:5173/`**.

---

## 5. Automated Testing

Run the test suite to execute the 21 automated tests:

```bash
cd reverse-resilia
python -m pytest tests -v
```

### Key Test Scenarios Covered
1. **Known-Answer Unit Test (10 orders):**
   - W1 failed (stock 4, cap 4); W2 active (stock 5, cap 4); W3 active (stock 5, cap 4).
   - Expected max natural recovery: **8 out of 10 orders = 80.0%**.
   - Permitted interventions: W2 cap +1 (₹300), W3 cap +1 (₹500).
   - Expected 100% target recovery: **10 out of 10 orders = 100.0%**, intervention cost = **₹800**.
   - Verified passed!
2. **Independent Verifier Rejections:**
   - Detects and rejects duplicate order assignments.
   - Rejects orders assigned to failed/inactive facilities.
   - Rejects inventory and processing capacity breaches.
   - Rejects deadline violations.
   - Rejects fabricated or tampered cost totals.
3. **Five-City Full Pipeline:**
   - Bengaluru, Mumbai, Delhi NCR, Chennai, Guwahati all load and solve correctly.
4. **API Integration:**
   - All 10 endpoints verified end-to-end.

---

## 6. Truth-in-Demo Checklist

- [x] All numbers displayed come from actual solver output, not hard-coded values.
- [x] Every percentage shows its numerator and denominator (e.g. `8/10 (80.0%)`).
- [x] Unfulfilled orders are explicitly tracked and visible in results.
- [x] Stock and capacity constraints are strictly enforced.
- [x] Solver status is transparent: OPTIMAL / FEASIBLE / INFEASIBLE.
- [x] Infeasible results report honest limiting constraints with ₹0 fabricated costs.
- [x] Changing a warehouse stock or capacity produces genuinely new calculations.
- [x] Independent verifier runs on every proposed plan and can reject corrupted plans.
- [x] Works 100% offline without live internet or map tile servers.
- [x] Recovery action sheet exports to CSV.

---

## 7. Open-Source Credits & Attribution

- **HiGHS Optimization:** Julian Hall and Ivet Galabova (MIT License).
- **SciPy & NumPy:** The SciPy & NumPy developer communities.
- **FastAPI & Pydantic:** Sebastián Ramírez and the Pydantic team.
- **OpenStreetMap Data:** OpenStreetMap contributors (ODbL).
- **Government of India PIN Directory:** Open data portal India (data.gov.in).
