import React, { useState, useEffect } from 'react';
import { apiClient } from './api/client';

export default function App() {
  const [cities, setCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState('bengaluru');
  const [network, setNetwork] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [activeDisruption, setActiveDisruption] = useState(null);
  const [impactResult, setImpactResult] = useState(null);
  const [activePlan, setActivePlan] = useState(null);
  const [verificationResult, setVerificationResult] = useState(null);
  const [comparisons, setComparisons] = useState([]);
  const [targetPct, setTargetPct] = useState(100);
  const [budgetInr, setBudgetInr] = useState(40000);
  const [priorityPolicy, setPriorityPolicy] = useState('HARD');
  const [selectedInterventions, setSelectedInterventions] = useState({});
  const [clockStr, setClockStr] = useState('');

  // Dual Clocks (IST and UTC)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const ist = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
      const utc = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
      setClockStr(`BENGALURU, IN_${ist} | UTC_${utc}`);
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    apiClient.getCities().then(setCities).catch(console.error);
  }, []);

  useEffect(() => {
    if (selectedCity) {
      apiClient.getNetwork(selectedCity).then(data => {
        setNetwork(data);
        setActiveDisruption(data.disruptions[0] || null);
        setImpactResult(null);
        setActivePlan(null);
        setVerificationResult(null);
        setComparisons([]);
        const initialInts = {};
        data.available_interventions.forEach(i => { initialInts[i.id] = true; });
        setSelectedInterventions(initialInts);
      }).catch(console.error);
    }
  }, [selectedCity]);

  const handleStockChange = (whId, val) => {
    setNetwork(prev => {
      if (!prev) return prev;
      const copy = { ...prev, warehouses: prev.warehouses.map(w => w.id === whId ? { ...w, stock_units: parseInt(val) || 0 } : w) };
      return copy;
    });
  };

  const handleCapChange = (whId, val) => {
    setNetwork(prev => {
      if (!prev) return prev;
      const copy = { ...prev, warehouses: prev.warehouses.map(w => w.id === whId ? { ...w, capacity_orders: parseInt(val) || 0 } : w) };
      return copy;
    });
  };

  const handleToggleWhActive = (whId) => {
    setNetwork(prev => {
      if (!prev) return prev;
      const copy = { ...prev, warehouses: prev.warehouses.map(w => w.id === whId ? { ...w, is_active: !w.is_active } : w) };
      return copy;
    });
  };

  const handleRunImpact = async () => {
    if (!network || !activeDisruption) return;
    try {
      const res = await apiClient.calculateImpact(network, activeDisruption);
      setImpactResult(res);
    } catch (err) {
      alert("Impact error: " + err.message);
    }
  };

  const handleSolveNatural = async () => {
    if (!network) return;
    try {
      const plan = await apiClient.calculateMaxNaturalRecovery(network, activeDisruption, priorityPolicy);
      setActivePlan(plan);
      setActiveTab('recovery');
    } catch (err) {
      alert("Solver error: " + err.message);
    }
  };

  const handleSolveTarget = async () => {
    if (!network) return;
    const allowed = Object.entries(selectedInterventions).filter(([_, v]) => v).map(([k]) => k);
    try {
      const plan = await apiClient.optimizeRecovery({
        network,
        disruption: activeDisruption,
        targetServicePercentage: targetPct,
        budgetInr: budgetInr,
        allowedInterventionIds: allowed,
        priorityPolicy: priorityPolicy,
      });
      setActivePlan(plan);

      // Trigger scenario comparisons
      const comps = await apiClient.compareScenarios(network, activeDisruption || { id: "NONE", name: "None", failed_warehouse_ids: [], closed_route_ids: [], capacity_reductions: {} }, plan);
      setComparisons(comps);
    } catch (err) {
      alert("Optimization error: " + err.message);
    }
  };

  const handleVerify = async () => {
    if (!network || !activePlan) return;
    try {
      const res = await apiClient.verifyRecoveryPlan(network, activePlan, activeDisruption, priorityPolicy);
      setVerificationResult(res);
      setActiveTab('verified');
    } catch (err) {
      alert("Verification error: " + err.message);
    }
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', color: 'var(--green)' }}>
      {/* Editorial Header */}
      <header style={{ borderBottom: '1px solid var(--green-12)', paddingBottom: '20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(22px, 2.5vw, 34px)', fontWeight: 700, letterSpacing: '-0.02em', textTransform: 'uppercase', margin: 0 }}>
            ReverseResilia // Goal-Driven Recovery
          </h1>
          <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
            [RUNTIME REBELS — DR. AIT, BENGALURU]
          </p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div className="mono" style={{ fontSize: '11px', padding: '6px 12px', border: '1px solid var(--green-12)', background: 'rgba(206, 228, 159, 0.04)' }}>
            {clockStr}
          </div>
          <span className="mono" style={{ fontSize: '10px', padding: '4px 8px', border: '1px solid var(--green)', background: 'rgba(206, 228, 159, 0.15)' }}>
            [100% OFFLINE // SOURCED GEOGRAPHY]
          </span>
        </div>

        {/* 5 City Pills */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', width: '100%', marginTop: '8px' }}>
          {cities.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setSelectedCity(c.id)}
              className="mono"
              style={{
                background: selectedCity === c.id ? 'var(--green)' : 'transparent',
                color: selectedCity === c.id ? 'var(--black)' : 'var(--text-muted)',
                border: '1px solid ' + (selectedCity === c.id ? 'var(--green)' : 'var(--green-12)'),
                padding: '6px 14px',
                cursor: 'pointer',
                fontWeight: selectedCity === c.id ? 700 : 500,
                fontSize: '11px',
                textTransform: 'uppercase'
              }}
            >
              [{String(i + 1).padStart(2, '0')}] {c.name}
            </button>
          ))}
        </div>
      </header>

      {/* View Switcher Tabs */}
      <nav style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--green-12)', paddingBottom: '12px', marginBottom: '24px', overflowX: 'auto' }}>
        {[
          { id: 'overview', label: '01 // Network Overview' },
          { id: 'disruption', label: '02 // Disruption Simulator' },
          { id: 'recovery', label: '03 // Recovery Planner' },
          { id: 'compare', label: '04 // Scenario Comparison' },
          { id: 'verified', label: '05 // Verified Action Sheet' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="mono"
            style={{
              background: activeTab === tab.id ? 'var(--green)' : 'transparent',
              color: activeTab === tab.id ? 'var(--black)' : 'var(--text-muted)',
              border: 'none',
              padding: '8px 16px',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: '12px',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* SCREEN 1: NETWORK OVERVIEW */}
      {activeTab === 'overview' && network && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '24px' }}>
              <div className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span>[SYSTEM DIRECTORY / SOURCED GEOGRAPHY]</span>
                <span>{network.city_id.toUpperCase()}</span>
              </div>
              <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 20px', textTransform: 'uppercase' }}>
                {network.city_name} Regional Network
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '16px 10px' }}>
                  <div style={{ fontSize: '30px', fontWeight: 700 }}>{String(network.warehouses.length).padStart(2, '0')}</div>
                  <div className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>WAREHOUSES</div>
                </div>
                <div style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '16px 10px' }}>
                  <div style={{ fontSize: '30px', fontWeight: 700 }}>{String(network.orders.length).padStart(2, '0')}</div>
                  <div className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>ORDERS</div>
                </div>
                <div style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '16px 10px' }}>
                  <div style={{ fontSize: '30px', fontWeight: 700 }}>{network.warehouses.reduce((a, w) => a + w.stock_units, 0)}</div>
                  <div className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>TOTAL STOCK</div>
                </div>
                <div style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '16px 10px' }}>
                  <div style={{ fontSize: '30px', fontWeight: 700 }}>{network.routes.length}</div>
                  <div className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>CORRIDORS</div>
                </div>
              </div>

              <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Facility coordinates are sourced from authentic Indian PIN codes. Distance matrices reflect realistic road networks with a 1.32x circuity factor.
              </p>
            </div>

            {/* Offline SVG Topological Vector Map */}
            <div style={{ background: '#090a08', border: '1px solid var(--green-12)', padding: '0', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--green-12)', display: 'flex', justifyContent: 'space-between' }}>
                <span className="mono" style={{ fontSize: '11px' }}>[OFFLINE TOPOLOGICAL VECTOR MAP]</span>
                <span className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>■ HUB | ● ORDER</span>
              </div>
              <svg viewBox="0 0 600 380" style={{ width: '100%', height: '340px' }}>
                {network.warehouses.map((w, idx) => {
                  const x = 80 + idx * 130;
                  const y = 80 + (idx % 2) * 80;
                  return (
                    <g key={w.id}>
                      <rect x={x - 9} y={y - 9} width="18" height="18" fill={w.is_active ? 'var(--green)' : 'var(--danger)'} stroke="#0b0b0b" strokeWidth="2" />
                      <text x={x + 14} y={y + 4} fill="var(--green)" fontSize="10" fontFamily="'PP Neue Montreal Mono', monospace">{w.id}</text>
                    </g>
                  );
                })}
                {network.orders.slice(0, 20).map((o, idx) => {
                  const x = 50 + (idx % 5) * 110;
                  const y = 220 + Math.floor(idx / 5) * 40;
                  return (
                    <circle key={o.id} cx={x} cy={y} r={o.is_critical ? 5 : 3.5} fill={o.is_critical ? '#fde047' : '#6ee7b7'} stroke="#0b0b0b" strokeWidth="1" />
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Editable Warehouses Table */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '24px' }}>
            <div className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              [FACILITY REGISTER / EDITABLE NODES]
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase' }}>
              Fulfillment Depots &amp; Throughput Limits
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--green-12)', textAlign: 'left' }}>
                    <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>HUB ID</th>
                    <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>NAME &amp; PIN</th>
                    <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>STOCK</th>
                    <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>CAPACITY</th>
                    <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>HANDLING</th>
                    <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>STATUS</th>
                    <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {network.warehouses.map(w => (
                    <tr key={w.id} style={{ borderBottom: '1px solid rgba(206, 228, 159, 0.06)' }}>
                      <td className="mono" style={{ padding: '12px 10px', fontWeight: 700 }}>{w.id}</td>
                      <td style={{ padding: '12px 10px' }}>{w.name} <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>[{w.pincode}]</span></td>
                      <td style={{ padding: '12px 10px' }}>
                        <input type="number" value={w.stock_units} onChange={e => handleStockChange(w.id, e.target.value)} style={{ width: '70px', background: 'rgba(206, 228, 159, 0.05)', border: '1px solid var(--green-12)', color: 'var(--green)', padding: '4px 6px', fontFamily: 'monospace' }} />
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        <input type="number" value={w.capacity_orders} onChange={e => handleCapChange(w.id, e.target.value)} style={{ width: '70px', background: 'rgba(206, 228, 159, 0.05)', border: '1px solid var(--green-12)', color: 'var(--green)', padding: '4px 6px', fontFamily: 'monospace' }} />
                      </td>
                      <td className="mono" style={{ padding: '12px 10px' }}>₹{w.handling_cost_per_order}</td>
                      <td style={{ padding: '12px 10px' }}>
                        <span className="mono" style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid ' + (w.is_active ? 'var(--green)' : 'var(--danger)'), color: w.is_active ? 'var(--green)' : 'var(--danger)' }}>
                          {w.is_active ? 'ACTIVE' : 'OUTAGE'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        <button onClick={() => handleToggleWhActive(w.id)} className="mono" style={{ background: 'transparent', border: '1px solid var(--green-12)', color: 'var(--green)', padding: '4px 10px', cursor: 'pointer', fontSize: '10px' }}>
                          {w.is_active ? 'TRIGGER OUTAGE' : 'RESTORE'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SCREEN 2: DISRUPTION SIMULATOR */}
      {activeTab === 'disruption' && network && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '24px' }}>
            <div className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>[FAULT INJECTION]</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase' }}>Shock Scenario Simulation</h2>

            <label className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>SELECT PRE-CONFIGURED SCENARIO:</label>
            <select
              value={activeDisruption ? activeDisruption.id : ''}
              onChange={e => {
                const found = network.disruptions.find(d => d.id === e.target.value);
                setActiveDisruption(found || null);
              }}
              style={{ width: '100%', background: 'rgba(206, 228, 159, 0.04)', border: '1px solid var(--green-12)', color: 'var(--green)', padding: '10px', fontFamily: 'monospace', marginBottom: '16px' }}
            >
              <option value="">[NONE] NORMAL OPERATION</option>
              {network.disruptions.map(d => (
                <option key={d.id} value={d.id}>{d.name.toUpperCase()}</option>
              ))}
            </select>

            <div className="mono" style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '12px', fontSize: '11px', marginBottom: '20px' }}>
              {activeDisruption ? activeDisruption.description : 'No active failure scenario selected.'}
            </div>

            <button onClick={handleRunImpact} style={{ width: '100%', background: 'var(--danger)', color: '#fff', border: 'none', padding: '12px', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              SIMULATE SHOCK &amp; EVALUATE IMMEDIATE LOSS
            </button>
          </div>

          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '24px' }}>
            <div className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>[IMPACT ANALYSIS (PRE-RECOVERY)]</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase' }}>Immediate Deliverability Loss</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '14px 10px' }}>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>{impactResult ? `${impactResult.immediate_service_percentage}%` : '--%'}</div>
                <div className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>IMMEDIATE SERVICE</div>
              </div>
              <div style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '14px 10px' }}>
                <div style={{ fontSize: '26px', fontWeight: 700, color: 'var(--danger)' }}>{impactResult ? impactResult.immediately_disrupted_orders.length : '--'}</div>
                <div className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>SEVERED ORDERS</div>
              </div>
              <div style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '14px 10px' }}>
                <div style={{ fontSize: '26px', fontWeight: 700, color: 'var(--warning)' }}>{impactResult ? `-${impactResult.service_loss_percentage}%` : '--%'}</div>
                <div className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>SERVICE DROP</div>
              </div>
            </div>

            {impactResult && (
              <div className="mono" style={{ fontSize: '11px', lineHeight: 1.8 }}>
                <div>FAILED HUBS: <span style={{ color: 'var(--danger)' }}>{impactResult.disrupted_warehouses.join(', ') || 'NONE'}</span></div>
                <div>CLOSED LANES: <span style={{ color: 'var(--danger)' }}>{impactResult.closed_routes.join(', ') || 'NONE'}</span></div>
                <div>AFFECTED CRITICAL ORDERS: <span style={{ color: 'var(--warning)' }}>{impactResult.affected_critical_orders.join(', ') || 'NONE'}</span></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SCREEN 3: RECOVERY PLANNER */}
      {activeTab === 'recovery' && network && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '24px' }}>
            <div className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>[STAGE C OPTIMIZER]</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase' }}>Goal-Driven Target &amp; Budget</h2>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>SERVICE TARGET:</label>
                <span className="mono" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--green)' }}>{targetPct}%</span>
              </div>
              <input type="range" min="50" max="100" step="5" value={targetPct} onChange={e => setTargetPct(parseFloat(e.target.value))} style={{ width: '100%', margin: '10px 0' }} />
            </div>

            <label className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>RECOVERY BUDGET CEILING (INR):</label>
            <input type="number" value={budgetInr} onChange={e => setBudgetInr(parseFloat(e.target.value) || 0)} style={{ width: '100%', background: 'rgba(206, 228, 159, 0.04)', border: '1px solid var(--green-12)', color: 'var(--green)', padding: '10px', fontFamily: 'monospace', marginBottom: '16px' }} />

            <label className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>PERMITTED INTERVENTIONS:</label>
            <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--green-12)', padding: '10px', marginBottom: '20px', fontSize: '11px', fontFamily: 'monospace' }}>
              {network.available_interventions.map(i => (
                <div key={i.id} style={{ marginBottom: '6px' }}>
                  <label style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!selectedInterventions[i.id]} onChange={e => setSelectedInterventions(prev => ({ ...prev, [i.id]: e.target.checked }))} />
                    {' '}<strong>{i.name}</strong> — ₹{i.cost_inr}
                  </label>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button onClick={handleSolveNatural} style={{ background: 'transparent', border: '1px solid var(--green-12)', color: 'var(--green)', padding: '12px', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', fontSize: '11px' }}>
                STAGE A &amp; B // NATURAL
              </button>
              <button onClick={handleSolveTarget} style={{ background: 'var(--green)', color: 'var(--black)', border: 'none', padding: '12px', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', fontSize: '11px' }}>
                STAGE C // TARGET MIN-COST
              </button>
            </div>
          </div>

          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '24px' }}>
            <div className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>[PROVABLE RECOVERY RESULT]</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase' }}>Mathematical Output</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '14px 10px' }}>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>{activePlan ? `${activePlan.achieved_service_percentage}%` : '--%'}</div>
                <div className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>SERVICE ACHIEVED</div>
              </div>
              <div style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '14px 10px' }}>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>₹{activePlan ? activePlan.total_recovery_cost : 0}</div>
                <div className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>TOTAL RECOVERY COST</div>
              </div>
              <div style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '14px 10px' }}>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>₹{activePlan ? activePlan.emergency_intervention_cost : 0}</div>
                <div className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>INTERVENTIONS COST</div>
              </div>
            </div>

            {activePlan && (
              <div className="mono" style={{ fontSize: '11px', lineHeight: 1.8, marginBottom: '20px' }}>
                <div>SOLVER STATUS: <strong style={{ color: activePlan.solver_status === 'OPTIMAL' ? 'var(--green)' : 'var(--danger)' }}>{activePlan.solver_status}</strong></div>
                <div>FRACTIONS DISPLAY: {activePlan.service_fraction_display}</div>
                <div>EXECUTION TIME: {activePlan.solve_time_ms} ms</div>
                <div>OPTIMALITY PROOF: {activePlan.is_optimal ? 'PROVEN OPTIMAL (HiGHS MIP)' : 'FEASIBLE'}</div>
                <div>SELECTED INTERVENTIONS: {activePlan.selected_interventions.map(i => i.name).join(', ') || 'NONE'}</div>
              </div>
            )}

            <button onClick={handleVerify} disabled={!activePlan} style={{ width: '100%', background: 'transparent', border: '1px solid var(--green)', color: 'var(--green)', padding: '12px', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', fontSize: '11px' }}>
              RUN INDEPENDENT VERIFIER &rarr;
            </button>
          </div>
        </div>
      )}

      {/* SCREEN 4: SCENARIO COMPARISON */}
      {activeTab === 'compare' && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '24px' }}>
          <div className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>[THREE-STATE AUDIT]</div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase' }}>Baseline vs Disrupted vs Recovered Reconciliation</h2>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--green-12)', textAlign: 'left' }}>
                <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>PARAMETER</th>
                <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>BASELINE</th>
                <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>DISRUPTED</th>
                <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>RECOVERED</th>
                <th className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>UNIT</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>Solve a recovery plan to populate the scenario comparison.</td></tr>
              ) : (
                comparisons.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(206, 228, 159, 0.06)' }}>
                    <td style={{ padding: '12px 10px', fontWeight: 700 }}>{c.metric}</td>
                    <td className="mono" style={{ padding: '12px 10px' }}>{c.baseline}</td>
                    <td className="mono" style={{ padding: '12px 10px', color: 'var(--danger)' }}>{c.disrupted}</td>
                    <td className="mono" style={{ padding: '12px 10px', color: 'var(--green)', fontWeight: 700 }}>{c.recovered}</td>
                    <td className="mono" style={{ padding: '12px 10px', color: 'var(--text-muted)' }}>{c.unit}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SCREEN 5: VERIFIED ACTION SHEET */}
      {activeTab === 'verified' && (
        <div>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '24px', marginBottom: '24px' }}>
            <div className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>[INDEPENDENT VERIFICATION]</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase' }}>Constraint Feasibility Audit (10 Checks)</h2>

            {verificationResult && (
              <div style={{ display: 'grid', gap: '8px' }}>
                {verificationResult.checks.map((c, idx) => (
                  <div key={idx} style={{ background: 'rgba(206, 228, 159, 0.03)', border: '1px solid var(--green-12)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div className="mono" style={{ fontWeight: 700, fontSize: '11px' }}>{c.check_name}</div>
                      <div className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{c.message}</div>
                    </div>
                    <span className="mono" style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid ' + (c.passed ? 'var(--green)' : 'var(--danger)'), color: c.passed ? 'var(--green)' : 'var(--danger)' }}>
                      {c.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, textTransform: 'uppercase' }}>Operational Recovery Action Sheet</h2>
              {activePlan && (
                <a href={apiClient.getExportUrl(activePlan.run_id)} className="auren-btn mono" style={{ textDecoration: 'none', display: 'inline-block', padding: '8px 14px', background: 'var(--green)', color: 'var(--black)', fontWeight: 700, fontSize: '11px' }}>
                  EXPORT ACTION SHEET (CSV) &darr;
                </a>
              )}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--green-12)', textAlign: 'left' }}>
                    <th className="mono" style={{ padding: '10px', color: 'var(--text-muted)' }}>ORDER ID</th>
                    <th className="mono" style={{ padding: '10px', color: 'var(--text-muted)' }}>ASSIGNED HUB</th>
                    <th className="mono" style={{ padding: '10px', color: 'var(--text-muted)' }}>ROUTE ID</th>
                    <th className="mono" style={{ padding: '10px', color: 'var(--text-muted)' }}>TRANSIT TIME</th>
                    <th className="mono" style={{ padding: '10px', color: 'var(--text-muted)' }}>DEADLINE</th>
                    <th className="mono" style={{ padding: '10px', color: 'var(--text-muted)' }}>ON-TIME</th>
                    <th className="mono" style={{ padding: '10px', color: 'var(--text-muted)' }}>TOTAL COST</th>
                  </tr>
                </thead>
                <tbody>
                  {!activePlan || activePlan.assignments.length === 0 ? (
                    <tr><td colSpan="7" style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>No recovery assignments available.</td></tr>
                  ) : (
                    activePlan.assignments.map(a => (
                      <tr key={a.order_id} style={{ borderBottom: '1px solid rgba(206, 228, 159, 0.06)' }}>
                        <td className="mono" style={{ padding: '10px', fontWeight: 700 }}>{a.order_id}</td>
                        <td className="mono" style={{ padding: '10px' }}>{a.warehouse_id}</td>
                        <td className="mono" style={{ padding: '10px', fontSize: '10px', color: 'var(--text-muted)' }}>{a.route_id}</td>
                        <td className="mono" style={{ padding: '10px' }}>{a.transit_time_minutes} min</td>
                        <td className="mono" style={{ padding: '10px' }}>{a.deadline_minutes} min</td>
                        <td style={{ padding: '10px' }}>
                          <span className="mono" style={{ fontSize: '10px', color: a.is_on_time ? 'var(--green)' : 'var(--danger)' }}>
                            {a.is_on_time ? 'YES' : 'NO'}
                          </span>
                        </td>
                        <td className="mono" style={{ padding: '10px', fontWeight: 700 }}>₹{a.total_cost}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
