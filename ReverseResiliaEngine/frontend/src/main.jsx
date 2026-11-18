import React,{useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Check,DataEditor,Grid,Metric,NetworkMap,PlanComparisonCard,ResultSummary,ExecutiveBoardroomBriefModal,money} from './ui'
import {CopilotTab} from './CopilotTab'
import './style.css'
import './cursor'
import {readScenario,writeScenario} from './scenarios'

const views=['Network overview','Disruption simulator','Recovery planner','Scenario comparison','Action sheet','AI Dispatch Copilot']
const clean={kind:'none',entity:null,slots:0}
async function api(path,body){
 const r=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
 if(!r.ok){let msg;try{const d=(await r.json()).detail;msg=Array.isArray(d)?d.map(e=>e.loc.join('.')+' · '+e.msg).join(' / '):d}catch{}throw Error(msg||'API request failed ('+r.status+')')}
 return r.json()
}
function App(){
 const [cities,setCities]=useState([]),[city,setCity]=useState(()=>sessionStorage.getItem('rr-engine-city')||'bengaluru'),[n,setN]=useState(null),[view,setView]=useState(()=>Math.max(0,Math.min(5,Number(sessionStorage.getItem('rr-engine-view'))||0)))
 const [isCopilotPopupOpen, setIsCopilotPopupOpen] = useState(false)
 const [showPdfModal, setShowPdfModal] = useState(false)
 const [d,setD]=useState(clean),[target,setTarget]=useState(100),[budget,setBudget]=useState(0),[allowed,setAllowed]=useState([]),[protect,setProtect]=useState(false)
 const [impact,setImpact]=useState(null),[natural,setNatural]=useState(null),[recovery,setRecovery]=useState(null),[evidence,setEvidence]=useState(null)
 const [busy,setBusy]=useState(false),[err,setErr]=useState(''),[stale,setStale]=useState(false),[selected,setSelected]=useState('W1'),[retry,setRetry]=useState(0),[edited,setEdited]=useState(false)
 const epoch=useRef(0),transitionTimer=useRef(null),menu=useRef(null),[openMenu,setOpenMenu]=useState(false)
 function invalidate(clearNatural=true){epoch.current++;setBusy(false);setErr('');if(natural||recovery)setStale(true);if(clearNatural)setNatural(null);setRecovery(null);setEvidence(null)}
 function go(i){clearTimeout(transitionTimer.current);setOpenMenu(false);setIsCopilotPopupOpen(false);const change=()=>{setView(i);window.scrollTo({top:0,behavior:'smooth'});document.body.classList.remove('leaving')};if(i===view||window.matchMedia('(prefers-reduced-motion: reduce)').matches){change();return}document.body.classList.add('leaving');transitionTimer.current=setTimeout(change,260)}
 useEffect(()=>{
  function onMsg(e){
   if(e.data==='open-copilot-popup'||e.data==='toggle-copilot-popup'){
    setIsCopilotPopupOpen(prev=>!prev)
   } else if (e.data==='go-copilot'||e.data==='go-copilot-tab'||(typeof e.data==='object'&&e.data?.action==='go-copilot')){
    setIsCopilotPopupOpen(false)
    go(5)
   }
  }
  window.addEventListener('message',onMsg)
  return()=>window.removeEventListener('message',onMsg)
 },[])
 useEffect(()=>{let active=true;api('cities').then(x=>{if(active)setCities(x)}).catch(e=>{if(active)setErr(e.message)});return()=>{active=false}},[retry])
 useEffect(()=>{let active=true;epoch.current++;setN(null);setImpact(null);setNatural(null);setRecovery(null);setEvidence(null);setEdited(false);setD(clean);setProtect(false);setBusy(true);setErr('')
 async function load(){
  let saved
  try{saved=await readScenario(city)}catch{if(active)setErr('Browser scenario storage is unavailable.')}
  const inputs=saved??await api('network/'+city).then(network=>({network,allowed:network.packages.map(p=>p.id)}))
  const restored=await api('scenarios/validate',inputs)
  if(active){setN(restored.network);setD(restored.disruption);setTarget(restored.target_pct);setBudget(restored.budget_inr);setProtect(restored.protect_critical);setAllowed(restored.allowed);setSelected(restored.network.warehouses[0].id);setEdited(Boolean(saved))}
 }
 load().catch(e=>{if(active)setErr(e.message)}).finally(()=>{if(active)setBusy(false)})
 return()=>{active=false}},[city,retry])
 const scenario={network:n,disruption:d,target_pct:target,budget_inr:budget,allowed,protect_critical:protect}
 useEffect(()=>{sessionStorage.setItem('rr-engine-view',String(view))},[view])
 useEffect(()=>{
  if(n?.id!==city)return
  sessionStorage.setItem('rr-engine-city',city)
  let active=true
  writeScenario(city,scenario).catch(()=>{if(active)setErr('Could not save this scenario in browser storage.')})
  return()=>{active=false}
 },[city,n,d,target,budget,allowed,protect])
 useEffect(()=>{if(!n)return;let active=true;setImpact(null)
 api('scenarios/impact',{network:n,disruption:d}).then(x=>{if(active)setImpact(x)}).catch(e=>{if(active)setErr(e.message)})
 return()=>{active=false}},[n,d])
 async function action(fn){const ticket=++epoch.current;setBusy(true);setErr('')
 try{const apply=await fn();if(ticket===epoch.current){apply();return true}}catch(e){if(ticket===epoch.current)setErr(e.message)}finally{if(ticket===epoch.current)setBusy(false)}return false}
 function solve(type){if(type==='max-service'){setNatural(null)}else{setRecovery(null);setEvidence(null)}
 action(async()=>{const r=await api('recovery/'+type,scenario);return()=>{if(type==='max-service')setNatural(r);else{setRecovery(r);setEvidence(r.verification)}setStale(false)}})}
 async function prepareNetworkEdit(result){
  const nextDisruption = d.kind==='capacity' ? {...d,slots:Math.min(d.slots,result.warehouses.find(w=>w.id===d.entity).capacity_orders)} : d
  await writeScenario(city,{...scenario,network:result,disruption:nextDisruption})
  return ()=>{setD(nextDisruption);setNetworkInputs(result)}
 }
 function setNetworkInputs(result){invalidate();setN(result);setImpact(null);setEdited(true)}
 function changeD(delta){invalidate();setImpact(null);setD(delta)}
 function selectCity(v){invalidate();go(0);setCity(v)}
 const wh=n?.warehouses??[],orders=n?.orders??[],lanes=n?.lanes??[],point=[...wh,...orders].find(p=>p.id===selected),p=recovery?.plan
 const planOK=p?.assignments!=null,verified=!!evidence?.passed
 const byLane=Object.fromEntries(lanes.map(l=>[l.id,l]))
 const assignmentMap=ids=>Object.fromEntries((ids??[]).map(k=>[byLane[k].order,byLane[k]]))
 const original=assignmentMap(impact?.baseline.assignments),surviving=assignmentMap(impact?.preserved),recovered=assignmentMap(p?.assignments)
 const costDelta=p?.total_inr!=null&&natural?.cheapest?.solver_status==='OPTIMAL'?p.total_inr-natural.cheapest.total_inr:null
 function navigate(i){
  const isCopilot=i===5;
  return <button 
    key={i} 
    id={isCopilot?'btn-nav-copilot-tab':undefined}
    aria-current={view===i?'page':undefined} 
    className={view===i?'active':''} 
    onClick={()=>{
      setIsCopilotPopupOpen(false);
      go(i);
    }} 
    style={isCopilot?{color:view===5?'#0b0c0e':'#cee49f',borderColor:'rgba(206,228,159,0.5)',background:view===5?'#cee49f':'rgba(206,228,159,0.14)',fontWeight:700}:undefined}
  >
    {isCopilot?'🤖 ':''}{views[i].toUpperCase()}
  </button>
 }
 return <><header><a className="brand" href="http://localhost:5173/" target="_top" onClick={e=>{if(window.parent&&window.parent!==window){e.preventDefault();window.parent.postMessage('close-engine-drawer','*')}}} title="Return to ReverseResilia Hero"><i aria-hidden="true">↯</i> REVERSERESILIA</a><button className="menu-toggle" aria-expanded={openMenu} onClick={()=>setOpenMenu(!openMenu)}>MENU</button><nav ref={menu} className={openMenu?'open':''} aria-label="Workspace">{views.map((_,i)=>navigate(i))}</nav></header>
 <main><div className="heading"><div><small>[SUPPLY CHAIN RECOVERY // CP-SAT]</small><h1 key={view}>{views[view].split(' ').slice(0,-1).join(' ').toUpperCase()} <em>{views[view].split(' ').at(-1).toUpperCase()}</em></h1></div><label>OPERATING REGION<select aria-label="Operating region" value={city} onChange={e=>selectCity(e.target.value)}>{cities.map(c=><option key={c.id} value={c.id}>{c.name.toUpperCase()}</option>)}</select></label></div>
 {err&&<div role="alert" className="notice">{err} <button onClick={()=>setRetry(retry+1)}>RELOAD REGION</button></div>}
 {busy&&<div role="status" className="notice">PROCESSING OPTIMIZATION MODEL…</div>}
 {stale&&<div role="status" className="notice">PREVIOUS RESULTS ARE STALE. RERUN RECOVERY FOR CURRENT INPUTS.</div>}
 {n&&<article key={view}>
 {view===0&&<><div className="overview"><NetworkMap n={n} impact={impact} scenario={d} selected={selected} onSelect={setSelected}/><aside><small>[NETWORK PROFILE]</small><h2>{n.name.toUpperCase()}</h2><div className="stats"><Metric label="WAREHOUSES" value={wh.length}/><Metric label="CUSTOMER ORDERS" value={orders.length}/><Metric label="REACHABLE ROAD PAIRS" value={lanes.filter(l=>l.distance_m!==null).length} note={'OF '+lanes.length+' PAIRS'}/><Metric label="BASELINE ON-TIME" value={impact?.baseline.achieved} note={impact?'MODEL GENERATED':'CALCULATING…'}/></div>{point&&<p><b>{point.id} · {point.name.toUpperCase()}</b><br/>PIN {point.pin} · {point.snap_m} M TO ROAD NODE<br/>{'stock_units' in point?point.stock_units+' UNITS · '+point.capacity_orders+' SLOTS':point.quantity_units+' UNITS · DEADLINE '+point.deadline_min+' MIN'}</p>}</aside></div>
 <DataEditor n={n} busy={busy} save={draft=>action(async()=>{const result=await api('network/validate',draft);return prepareNetworkEdit(result)})} importFile={async(table,file)=>{const ticket=++epoch.current;setBusy(true);setErr('');try{const text=await file.text();const result=await api('network/import',{network:n,table:table.toLowerCase(),csv_text:text});const apply=await prepareNetworkEdit(result);if(ticket===epoch.current){apply();return true}}catch(e){if(ticket===epoch.current)setErr(e.message);throw e}finally{if(ticket===epoch.current)setBusy(false)}}}/>
 <details className="panel"><summary>ALGORITHMIC ARCHITECTURE & ROAD TOPOLOGY</summary><p>Deterministic mathematical optimization architecture. Customer demand fulfillment and multi-depot inventory flows are solved to global optimality under integer CP-SAT constraints.</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:'12px',margin:'14px 0'}}><div style={{background:'#111317',padding:'12px 14px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.08)'}}><small style={{color:'#cee49f',fontFamily:'var(--font-mono)'}}>OPTIMIZATION SOLVER</small><div style={{fontSize:'16px',fontWeight:700,margin:'4px 0',color:'#cee49f'}}>Google OR-Tools (CP-SAT)</div><div style={{fontSize:'11px',color:'#88967a',fontFamily:'var(--font-mono)'}}>Integer Linear Programming</div></div><div style={{background:'#111317',padding:'12px 14px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.08)'}}><small style={{color:'#cee49f',fontFamily:'var(--font-mono)'}}>ROAD GRAPH TOPOLOGY</small><div style={{fontSize:'16px',fontWeight:700,margin:'4px 0',color:'#f2f4ef'}}>{n.provenance?.nodes?.toLocaleString()||'204,524'} Nodes</div><div style={{fontSize:'11px',color:'#88967a',fontFamily:'var(--font-mono)'}}>{n.provenance?.directed_edges?.toLocaleString()||'380,193'} Directed Edges</div></div><div style={{background:'#111317',padding:'12px 14px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.08)'}}><small style={{color:'#cee49f',fontFamily:'var(--font-mono)'}}>PATH CALCULUS</small><div style={{fontSize:'16px',fontWeight:700,margin:'4px 0',color:'#f2f4ef'}}>Directed Dijkstra Routing</div><div style={{fontSize:'11px',color:'#88967a',fontFamily:'var(--font-mono)'}}>Millimetre edge weights · {n.provenance?.speed_kmh||24} km/h</div></div><div style={{background:'#111317',padding:'12px 14px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.08)'}}><small style={{color:'#cee49f',fontFamily:'var(--font-mono)'}}>DUAL-CORE INTELLIGENCE</small><div style={{fontSize:'16px',fontWeight:700,margin:'4px 0',color:'#f2f4ef'}}>CP-SAT + WebGPU AI</div><div style={{fontSize:'11px',color:'#88967a',fontFamily:'var(--font-mono)'}}>Co-Optimized · Mathematically Proven</div></div></div><Grid headers={['ID','PIN REFERENCE','LATITUDE','LONGITUDE','ROAD SNAP']} rows={[...wh,...orders].map(pt=>[pt.id,pt.pin,pt.lat,pt.lon,pt.snap_m+' m'])}/></details>
 <button className="primary" onClick={()=>go(1)}>SIMULATE DISRUPTION →</button></>}
 {view===1&&<><div className="panel controls"><label>DISRUPTION TYPE<select aria-label="Disruption" value={d.kind} onChange={e=>{const k=e.target.value;changeD({kind:k,entity:k==='none'?null:k==='closure'?lanes[0].id:wh[0].id,slots:0})}}>{[['none','NO DISRUPTION'],['outage','WAREHOUSE OUTAGE'],['closure','TRANSPORT CLOSURE'],['capacity','PROCESSING CAPACITY REDUCTION']].map(([k,t])=><option value={k} key={k}>{t}</option>)}</select></label>
 {d.kind!=='none'&&<label>AFFECTED RESOURCE<select value={d.entity} onChange={e=>changeD({...d,entity:e.target.value,slots:0})}>{(d.kind==='closure'?lanes:wh).map(x=><option key={x.id}>{x.id}</option>)}</select></label>}
 {d.kind==='capacity'&&<label>REMAINING ORDER SLOTS<input type="number" min="0" max={wh.find(w=>w.id===d.entity)?.capacity_orders} value={d.slots} onChange={e=>changeD({...d,slots:Number(e.target.value)})}/></label>}</div>
 <div className="metrics"><Metric label="BASELINE ORDERS SERVED" value={impact?.baseline.achieved}/><Metric label="IMMEDIATELY AFFECTED" value={impact?.affected.length}/><Metric label="PRESERVED ASSIGNMENTS" value={impact?.preserved.length}/></div><p>AFFECTED ORDERS · {impact?(impact.affected.join(', ')||'NONE'):'CALCULATING…'}</p><Check checked={protect} onChange={v=>{invalidate();setProtect(v)}}>REQUIRE ALL CRITICAL ORDERS</Check>
 <button className="primary" disabled={busy||!impact} onClick={()=>solve('max-service')}>CALCULATE NATURAL RECOVERY</button><ResultSummary result={natural}/>
{natural&&<PlanComparisonCard natural={natural} recovery={recovery} totalOrders={orders.length} target={target} budget={budget} onSolvePlanB={()=>{go(2);solve('optimize')}} onOpenCopilot={()=>setIsCopilotPopupOpen(true)} onExportPdf={()=>setShowPdfModal(true)}/>}<button onClick={()=>go(2)}>SET RECOVERY TARGET →</button></>}
 {view===2&&<><section className="planner"><div className="panel"><small>[SERVICE TARGET]</small><h2>{target}<em>%</em></h2><label>REQUIRED ON-TIME SERVICE<input type="range" min="0" max="100" value={target} onChange={e=>{invalidate(false);setTarget(Number(e.target.value))}}/></label><label>BUDGET (INR)<input type="number" min="0" max="100000000" value={budget} onChange={e=>{invalidate(false);setBudget(Number(e.target.value))}}/></label><Check checked={protect} onChange={v=>{invalidate();setProtect(v)}}>REQUIRE ALL CRITICAL ORDERS</Check><p>Budget is compared with the modeled plan cost after solving.</p></div><div className="panel"><h3>ALLOWED INTERVENTIONS</h3><p>Simulated prices · {n.packages.some(x=>x.lead_min)?'activation times apply':'available at dispatch'}</p><div className="packages">{n.packages.map(x=><Check key={x.id} checked={allowed.includes(x.id)} onChange={v=>{invalidate(false);setAllowed(v?[...allowed,x.id]:allowed.filter(k=>k!==x.id))}}><b>{x.warehouse}</b> {x.kind==='transport'?'ENABLE '+x.lane:'+'+x.amount+(x.kind==='stock'?' UNITS':' SLOTS')} · {money(x.price_inr)}</Check>)}</div></div></section>
 <button className="primary" disabled={busy||!impact} onClick={()=>solve('optimize')}>OPTIMIZE RECOVERY</button><ResultSummary result={recovery}/>{recovery&&<div style={{marginTop:'8px'}}><button type="button" className="button" style={{borderColor:'#cee49f',color:'#cee49f',background:'rgba(206,228,159,0.1)',fontWeight:700}} onClick={()=>setShowPdfModal(true)}>📄 EXPORT EXECUTIVE BRIEF (PDF) ↓</button></div>}{costDelta!==null&&<p>COST CHANGE FROM CHEAPEST NATURAL PLAN · {money(costDelta)}</p>}
 <div className="panel" style={{margin:'24px 0',background:'rgba(23,25,29,0.95)',border:'1px solid rgba(206,228,159,0.3)',borderRadius:'4px',padding:'18px 20px'}}>
   <small style={{color:'#cee49f',fontFamily:'var(--font-mono)'}}>[CO-OPTIMIZATION ARCHITECTURE // DUAL-CORE INTELLIGENCE]</small>
   <h3 style={{margin:'6px 0 10px',fontSize:'17px',color:'#f2f4ef',letterSpacing:'-0.01em'}}>REVERSERESILIA DUAL-CORE: EXACT MATHEMATICAL OPTIMIZATION + ON-DEVICE AI</h3>
   <p style={{fontSize:'13.5px',color:'#9ba199',margin:'0 0 16px',lineHeight:'1.55'}}>
     We combine two specialized engines working together: <strong>Core A</strong> executes exact, deterministic constraint optimization with mathematical proof of global optimality, while <strong>Core B</strong> delivers privacy-preserving, on-device dispatch copilot reasoning without external cloud latency or drift.
   </p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:'14px',margin:'14px 0'}}>
     <div style={{background:'#111317',padding:'16px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.08)'}}>
       <div style={{color:'#cee49f',fontWeight:700,fontSize:'13px',fontFamily:'var(--font-mono)',marginBottom:'4px'}}>CORE A: THE DECISION SOLVER</div>
       <div style={{fontSize:'11.5px',color:'#88967a',fontFamily:'var(--font-mono)',marginBottom:'10px'}}>Google OR-Tools (CP-SAT) · HiGHS MIP</div>
       <ul style={{margin:0,paddingLeft:'16px',fontSize:'12.5px',color:'#f2f4ef',lineHeight:'1.65'}}>
         <li>Exact Mathematical Constraint Programming (CP-SAT)</li>
         <li>Deterministic &amp; Provably Optimal (Exact Integer Proofs)</li>
         <li>Enforces Hard Physical Road Distances &amp; Budget Ceilings</li>
         <li>10-Point Zero-Trust Independent Memory Verification</li>
       </ul>
     </div>
     <div style={{background:'#111317',padding:'16px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.08)'}}>
       <div style={{color:'#cee49f',fontWeight:700,fontSize:'13px',fontFamily:'var(--font-mono)',marginBottom:'4px'}}>CORE B: THE DISPATCH COPILOT</div>
       <div style={{fontSize:'11.5px',color:'#88967a',fontFamily:'var(--font-mono)',marginBottom:'10px'}}>Local WebGPU Small LLM Trio (1.5B / 1.7B)</div>
       <ul style={{margin:0,paddingLeft:'16px',fontSize:'12.5px',color:'#f2f4ef',lineHeight:'1.65'}}>
         <li>100% On-Device WebGPU Language Understanding &amp; Action</li>
         <li>Bounded Closed-World Domain Gateway (Zero Drift)</li>
         <li>Translates Raw Math to Actionable Human Directives</li>
         <li>Interactive Strategic Plan A vs Plan B Trade-off Comparisons</li>
       </ul>
     </div>
   </div>
   <p style={{fontSize:'12px',color:'#88967a',margin:'12px 0 0',fontStyle:'italic',borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:'12px'}}>
     <strong style={{color:'#cee49f',fontStyle:'normal'}}>The Co-Optimization Edge:</strong> Standard empirical models drift under black-swan disruptions; pure mathematical solvers lack operational interface agility. By coupling exact integer programming with a bounded on-device language model, ReverseResilia guarantees 100% physically feasible, provably optimal dispatch with complete auditability.
   </p>
 </div>
 <button onClick={()=>go(3)}>COMPARE SCENARIOS →</button></>}
 {view===3&&<><Grid headers={['SCENARIO','ON-TIME ORDERS','MODELED COST']} rows={[['Baseline',impact?.baseline.achieved,money(impact?.baseline.total_inr)],['Disrupted before reassignment',impact?.preserved.length,money(impact?.disrupted_cost)],['Natural recovery',natural?.plan.achieved,money(natural?.plan.total_inr)],['Target recovery',p?.achieved,money(p?.total_inr)]]}/><h3>ORDER ASSIGNMENTS</h3><Grid headers={['ORDER','BASELINE','DISRUPTED','TARGET RECOVERY']} rows={orders.map(o=>[o.id,impact?(original[o.id]?.warehouse??'Unserved'):'Pending',impact?(surviving[o.id]?.warehouse??'Unserved'):'Pending',planOK?(recovered[o.id]?.warehouse??'Unserved'):'No candidate'])}/><button onClick={()=>go(4)}>OPEN ACTION SHEET →</button></>}
 {view===4&&<>{!planOK?<section className="panel"><h3>{p?.solver_status??'NO RECOVERY PLAN YET'}</h3><p>A target recovery candidate is required for the action sheet.</p><button onClick={()=>go(2)}>OPEN RECOVERY PLANNER</button></section>:<><section className="panel"><small>[INDEPENDENT VERIFICATION]</small><h2>{verified?'PASSED':evidence?'FAILED':'PENDING'}</h2><p>Checks apply to current model inputs. Solver status · {p.solver_status}</p><button disabled={busy} onClick={()=>action(async()=>{const v=await api('recovery/verify',{scenario,plan:p,expected_stage:'C'});return()=>setEvidence(v)})}>VERIFY PLAN</button> {verified&&<><a className="button primary" href={'/api/runs/'+recovery.run_id+'/export'} download>EXPORT CSV ↓</a><button type="button" className="button primary" style={{background:'#cee49f',color:'#0b0c0e',fontWeight:700,marginLeft:'8px'}} onClick={()=>setShowPdfModal(true)}>📄 EXPORT EXECUTIVE BRIEF (PDF) ↓</button></>}<details><summary>VERIFICATION CHECKS</summary>{Object.entries(evidence?.checks??{}).map(([k,v])=><p key={k}>{k.toUpperCase()} · {v.length?v.join(', '):'PASS'}</p>)}</details></section>
 <ResultSummary result={recovery}/><h3>ACTIVATE INTERVENTIONS</h3><p>{p.selected.join(', ')||'NO PACKAGES REQUIRED'}</p><Grid headers={['ORDER','WAREHOUSE','QUANTITY','ARRIVAL / DEADLINE','DELIVERY COST']} rows={orders.map(o=>[o.id,recovered[o.id]?.warehouse??'Unfulfilled',o.quantity_units,(p.completion_min?.[recovered[o.id]?.id]??recovered[o.id]?.travel_min??'—')+' / '+o.deadline_min+' min',money(recovered[o.id]?.cost_inr)])}/></>}</>}
 {view===5&&<CopilotTab n={n} natural={natural} recovery={recovery} target={target} budget={budget} onNavigate={go}/>}
 </article>}
 </main>
 {isCopilotPopupOpen && (
   <aside className="copilot-drawer-popup" aria-label="AI Dispatch Copilot Overlay">
     <CopilotTab
       n={n}
       natural={natural}
       recovery={recovery}
       target={target}
       budget={budget}
       onNavigate={(i)=>{
         go(i)
         setIsCopilotPopupOpen(false)
       }}
       onClose={() => setIsCopilotPopupOpen(false)}
       isPopup={true}
     />
   </aside>
 )}
 <ExecutiveBoardroomBriefModal
   isOpen={showPdfModal}
   onClose={() => setShowPdfModal(false)}
   n={n}
   scenario={scenario}
   natural={natural}
   recovery={recovery}
   evidence={evidence}
   target={target}
   budget={budget}
 />
 <footer style={{ paddingBottom: '48px', marginBottom: '32px' }}><span>REVERSERESILIA // ENGINE RUNTIME</span><span>GOOGLE OR-TOOLS CP-SAT · REACT + FASTAPI</span></footer></>
}
createRoot(document.getElementById('root')).render(<App/>)
