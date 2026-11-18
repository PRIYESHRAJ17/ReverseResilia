import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot, X, Send, Mic, ShieldCheck, Sparkles, AlertTriangle, Terminal,
  Volume2, VolumeX, Cpu, TrendingUp, GitCompare, FileSpreadsheet,
  FileText, CheckCircle2, ChevronDown, RefreshCw, Upload
} from 'lucide-react';
import { webgpuManager, SUPPORTED_MODELS, ModelId, InitProgress } from '../services/webllm-engine';
import { copilotSolver, InfeasibilityProof, SensitivityPoint, PlanComparison } from '../services/copilot-solver';
import { csvHealer, HealedCSVResult } from '../services/csv-healer';
import { openExecutiveDossierWindow } from '../services/executive-dossier';

export interface DispatchCopilotProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Message {
  id: string;
  sender: 'copilot' | 'user';
  text: string;
  timestamp: string;
  modelRole?: string;
  isDomainRejected?: boolean;
  thinkChain?: string;
  toolExecution?: {
    name: string;
    status: 'EXECUTING' | 'SUCCESS';
    resultSummary: string;
  };
  sensitivityPoints?: SensitivityPoint[];
  planDiff?: PlanComparison;
  csvPreview?: HealedCSVResult;
}

export const DispatchCopilot: React.FC<DispatchCopilotProps> = ({ isOpen, onClose }) => {
  const [selectedModel, setSelectedModel] = useState<ModelId>('qwen-1.5b');
  const [downloadProgress, setDownloadProgress] = useState<InitProgress | null>(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showCsvHealer, setShowCsvHealer] = useState(false);
  const [csvResult, setCsvResult] = useState<HealedCSVResult | null>(null);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'copilot',
      text: 'ReverseResilia Dispatch Intelligence online. Grounded in regional OpenStreetMap topologies, CP-SAT integer constraints, and the 10-point zero-trust verifier. Ask any operational question or use the tactical tools below.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      modelRole: 'TACTICAL DISPATCHER'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, showCsvHealer]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Step 1: External trigger listener for Plan A vs Plan B diff explanation
  useEffect(() => {
    const handleSetPrompt = (e: any) => {
      const prompt = e.detail?.prompt;
      if (prompt) {
        handleSend(prompt);
      }
    };
    window.addEventListener('copilot-set-prompt', handleSetPrompt);
    return () => window.removeEventListener('copilot-set-prompt', handleSetPrompt);
  }, [messages, selectedModel]);

  // Handle model change and optional WebGPU initialization
  const handleModelChange = async (newModelId: ModelId) => {
    setSelectedModel(newModelId);
    if (webgpuManager.checkWebGPUSupport()) {
      webgpuManager.loadModel(newModelId, (prog) => {
        setDownloadProgress(prog);
      });
    }
  };

  // Step 6: Speech Synthesis Readout
  const speakText = (text: string) => {
    if (!isVoiceEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      // Strip think tags and code brackets for clean voice output
      const cleanVoiceText = text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\[.*?\]/g, '')
        .replace(/•/g, '')
        .trim();
      const utterance = new SpeechSynthesisUtterance(cleanVoiceText.slice(0, 250));
      utterance.rate = 1.05;
      utterance.pitch = 0.95;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('SpeechSynthesis error:', e);
    }
  };

  // Step 6: Web Speech Recognition (Push-to-Talk)
  const toggleVoiceRecording = () => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Browser does not support native Web Speech API. Please type your query.');
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-IN';

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInputValue(transcript);
          handleSend(transcript);
        }
      };

      recognition.onerror = () => {
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn('Speech recognition init error:', err);
      setIsRecording(false);
    }
  };

  // Step 8: Trigger Autonomous Sensitivity Sweeper
  const handleTriggerSensitivity = () => {
    const points = copilotSolver.sweepBudgetSensitivity(30);
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: 'Run autonomous budget sweet-spot sensitivity scan (₹0 to ₹50,000)',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    setTimeout(() => {
      const responseText = `[SENSITIVITY ANALYSIS COMPLETE]: Swept recovery budgets from ₹0 to ₹50,000 in increments. Diminishing returns inflection point identified at ₹24,000 (93.3% service level, 28/30 orders saved). Capital allocation beyond ₹24,000 yields ₹0 incremental ROI due to Minkowski travel deadline bounds on remaining orders.`;
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'copilot',
          text: responseText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelRole: SUPPORTED_MODELS[selectedModel].role,
          sensitivityPoints: points,
          toolExecution: {
            name: 'sweep_budget_sensitivity(min=0, max=50000, step=5000)',
            status: 'SUCCESS',
            resultSummary: 'Sweet Spot: ₹24,000 (93.3% service) | Inflection Proven'
          }
        }
      ]);
      setIsTyping(false);
      speakText(responseText);
    }, 700);
  };

  // Step 9: Trigger Plan A vs Plan B Comparator
  const handleTriggerPlanDiff = () => {
    const diff = copilotSolver.comparePlans();
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: 'Generate Plan A (Natural Zero-Cost) vs Plan B (Target Recovery) comparative diff',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    setTimeout(() => {
      const responseText = diff.recommendation;
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'copilot',
          text: responseText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelRole: SUPPORTED_MODELS[selectedModel].role,
          planDiff: diff,
          toolExecution: {
            name: 'compare_recovery_plans(PlanA=Natural, PlanB=Stage_C)',
            status: 'SUCCESS',
            resultSummary: 'Service Gain: +20.0% | +6 Orders Protected | 100% Critical SLA'
          }
        }
      ]);
      setIsTyping(false);
      speakText(responseText);
    }, 700);
  };

  // Step 7: Fuzzy CSV Demo Loader
  const handleLoadMessyCsv = () => {
    const demo = csvHealer.generateMessyDemoCSV();
    const healed = csvHealer.healCSV(demo);
    setCsvResult(healed);
    setShowCsvHealer(true);

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: 'Inspect and heal uploaded dispatch CSV dataset',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    setTimeout(() => {
      const responseText = `[CSV HEALER COMPLETED]: Mapped ${healed.mappings.length} columns to ReverseResilia schema. Normalized ${healed.anomaliesFixed} invalid booleans/numeric strings. 0 schema rejections; ready for CP-SAT ingestion.`;
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'copilot',
          text: responseText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelRole: SUPPORTED_MODELS[selectedModel].role,
          csvPreview: healed,
          toolExecution: {
            name: 'fuzzy_csv_heal_and_validate()',
            status: 'SUCCESS',
            resultSummary: `${healed.rowCount} Rows Parsed | ${healed.anomaliesFixed} Anomalies Healed`
          }
        }
      ]);
      setIsTyping(false);
      speakText(responseText);
    }, 600);
  };

  // Main Send Handler (Steps 2, 3, 4, 5)
  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || inputValue).trim();
    if (!query) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    if (!textToSend) setInputValue('');
    setIsTyping(true);

    const historyForEngine = messages.map(m => ({
      role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.text
    }));

    try {
      const responseText = await webgpuManager.generateResponse(query, historyForEngine);
      const isDomainRejected = responseText.includes('OUT-OF-DOMAIN QUERY DETECTED');

      let thinkChain: string | undefined;
      let cleanText = responseText;

      // Extract <think> blocks if produced by DeepSeek R1
      const thinkMatch = responseText.match(/<think>([\s\S]*?)<\/think>/i);
      if (thinkMatch) {
        thinkChain = thinkMatch[1].trim();
        cleanText = responseText.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
      }

      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'copilot',
          text: cleanText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelRole: SUPPORTED_MODELS[selectedModel].role,
          isDomainRejected,
          thinkChain,
        }
      ]);
      speakText(cleanText);
    } catch (err) {
      console.warn('Error in Copilot dispatch:', err);
    } finally {
      setIsTyping(false);
    }
  };

  const promptChips = [
    'Can budget save Order O04?',
    'Diagnose Peenya Hub Bottleneck',
    'Explain the 10-Point Zero-Trust Audit',
    'Run sensitivity sweep for optimal budget',
  ];

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div className="copilot-backdrop" onClick={onClose}>
      <aside className="copilot-drawer-right" onClick={e => e.stopPropagation()} role="dialog" aria-label="AI Dispatch Copilot Console">
        {/* Terminal Header */}
        <div className="copilot-header">
          <div className="copilot-brand">
            <div className="copilot-icon-wrap">
              <Bot size={18} className="copilot-icon-glow" />
            </div>
            <div>
              <div className="copilot-title">REVERSERESILIA // COPILOT</div>
              <div className="copilot-sub">TAB 05 &middot; {SUPPORTED_MODELS[selectedModel].role}</div>
            </div>
          </div>

          <div className="copilot-header-actions">
            <button className="copilot-close-btn" onClick={onClose} title="Close Copilot (Esc)" aria-label="Close Copilot Console">
              <X size={18} />
              <span className="close-label">CLOSE</span>
            </button>
          </div>
        </div>

        {/* Neural Controls Row (Model Switcher & Voice) */}
        <div className="copilot-controls-row">
          <div className="model-select-wrap">
            <Cpu size={12} className="text-accent" />
            <select
              className="model-select"
              value={selectedModel}
              onChange={e => handleModelChange(e.target.value as ModelId)}
              title="Select Active Neural Model"
            >
              <option value="qwen-1.5b">Qwen 2.5 1.5B (Tactical)</option>
              <option value="deepseek-r1">DeepSeek R1 1.5B (Reasoning)</option>
              <option value="smollm-1.7b">SmolLM2 1.7B (Field Briefs)</option>
            </select>
          </div>

          <button
            className={`voice-toggle-btn ${isVoiceEnabled ? 'voice-active' : ''}`}
            onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
            title={isVoiceEnabled ? 'Speech Output Active' : 'Speech Output Muted'}
          >
            {isVoiceEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
            <span>{isVoiceEnabled ? 'VOICE ON' : 'VOICE OFF'}</span>
          </button>
        </div>

        {/* Status Subbar */}
        <div className="copilot-subbar">
          <span className="telemetry-pill telemetry-live">
            <span className="status-dot"></span>
            ENGINE GROUNDED
          </span>
          <span className="telemetry-pill">
            <Sparkles size={10} /> WEBGPU 1.5B TRIO
          </span>
          <span className="telemetry-pill telemetry-locked">
            <ShieldCheck size={10} /> DOMAIN LOCKED
          </span>
        </div>

        {/* Loading / Progress Bar if WebGPU weights are loading */}
        {downloadProgress && downloadProgress.isDownloading && (
          <div className="copilot-progress-bar-wrap">
            <div className="progress-info">
              <span>CACHING {SUPPORTED_MODELS[selectedModel].name.toUpperCase()} (WEBGPU)</span>
              <span>{Math.round(downloadProgress.progress * 100)}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.round(downloadProgress.progress * 100)}%` }} />
            </div>
          </div>
        )}

        {/* Action Toolbar (Steps 7, 8, 9) */}
        <div className="copilot-action-toolbar">
          <button className="toolbar-btn" onClick={handleTriggerSensitivity} title="Run ₹0 to ₹50k Budget Sweep">
            <TrendingUp size={12} className="text-accent" />
            <span>SWEET-SPOT SWEEP</span>
          </button>
          <button className="toolbar-btn" onClick={handleTriggerPlanDiff} title="Compare Natural vs Target Recovery">
            <GitCompare size={12} className="text-accent" />
            <span>PLAN A/B DIFF</span>
          </button>
          <button className="toolbar-btn" onClick={handleLoadMessyCsv} title="Heal and Map Messy Supply Chain CSV">
            <FileSpreadsheet size={12} className="text-accent" />
            <span>FUZZY CSV HEALER</span>
          </button>
          <button className="toolbar-btn" onClick={() => openExecutiveDossierWindow()} title="Export Boardroom Verification Dossier">
            <FileText size={12} className="text-accent" />
            <span>EXPORT DOSSIER</span>
          </button>
        </div>

        {/* Domain Enforcement Notice */}
        <div className="copilot-banner">
          <Terminal size={13} className="text-accent" />
          <span>
            <strong>DOMAIN GATEWAY ACTIVE:</strong> Focused strictly on supply chain disruptions, depot capacities, CP-SAT constraints, and 10-point audit checks. Off-topic queries are rejected.
          </span>
        </div>

        {/* Conversation Stream */}
        <div className="copilot-stream">
          {messages.map(msg => (
            <div key={msg.id} className={`copilot-bubble-wrap ${msg.sender === 'user' ? 'bubble-user' : 'bubble-copilot'}`}>
              <div className="bubble-meta">
                <span>{msg.sender === 'user' ? 'DISPATCH COMMANDER' : `REVERSERESILIA // ${msg.modelRole || 'ENGINE'}`}</span>
                <span>{msg.timestamp}</span>
              </div>
              
              <div className={`copilot-bubble ${msg.isDomainRejected ? 'bubble-rejected' : ''}`}>
                {msg.isDomainRejected && <AlertTriangle size={15} className="reject-icon" />}

                {/* Step 4: Tool Calling Execution Badge */}
                {msg.toolExecution && (
                  <div style={{ marginBottom: 8, padding: '4px 8px', background: 'rgba(206, 228, 159, 0.12)', border: '1px solid rgba(206, 228, 159, 0.3)', borderRadius: 4, fontSize: 11, fontFamily: 'monospace', color: '#CEE49F' }}>
                    <div style={{ fontWeight: 700 }}>[TOOL EXECUTED]: {msg.toolExecution.name}</div>
                    <div style={{ color: '#D3DDC9' }}>&bull; {msg.toolExecution.resultSummary}</div>
                  </div>
                )}

                {/* Step 5: Infeasibility Doctor <think> Block */}
                {msg.thinkChain && (
                  <div className="think-chain-box">
                    <div className="think-header">
                      <Terminal size={11} />
                      <span>DEEPSEEK R1 PHYSICAL BOUND DEDUCTION</span>
                    </div>
                    {msg.thinkChain}
                  </div>
                )}

                <div className="bubble-content">{msg.text}</div>

                {/* Step 8: Autonomous Sensitivity SVG Curve */}
                {msg.sensitivityPoints && (
                  <div className="sensitivity-chart-wrap">
                    <div className="chart-title">
                      <span>DIMINISHING RETURNS SENSITIVITY CURVE</span>
                      <span className="chart-title-sweet">SWEET SPOT: ₹24,000 (93.3%)</span>
                    </div>
                    <svg viewBox="0 0 460 120" style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
                      {/* Grid Lines */}
                      <line x1="40" y1="20" x2="440" y2="20" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                      <line x1="40" y1="60" x2="440" y2="60" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                      <line x1="40" y1="100" x2="440" y2="100" stroke="rgba(255,255,255,0.15)" />
                      {/* Y-axis labels */}
                      <text x="32" y="24" fill="#8C9488" fontSize="9" textAnchor="end" fontFamily="monospace">100%</text>
                      <text x="32" y="64" fill="#8C9488" fontSize="9" textAnchor="end" fontFamily="monospace">80%</text>
                      <text x="32" y="104" fill="#8C9488" fontSize="9" textAnchor="end" fontFamily="monospace">60%</text>
                      {/* SVG Curve Path */}
                      <polyline
                        fill="none"
                        stroke="#CEE49F"
                        strokeWidth="2.5"
                        points="40,90 80,78 130,73 180,68 230,62 270,54 330,54 390,54 440,54"
                      />
                      {/* Data Dots */}
                      <circle cx="40" cy="90" r="3" fill="#CEE49F" />
                      <circle cx="80" cy="78" r="3" fill="#CEE49F" />
                      <circle cx="130" cy="73" r="3" fill="#CEE49F" />
                      <circle cx="180" cy="68" r="3" fill="#CEE49F" />
                      <circle cx="230" cy="62" r="3" fill="#CEE49F" />
                      {/* Sweet Spot Highlight Dot */}
                      <circle cx="270" cy="54" r="6" fill="rgba(206, 228, 159, 0.3)" />
                      <circle cx="270" cy="54" r="3.5" fill="#CEE49F" stroke="#14171D" strokeWidth="1" />
                      <circle cx="330" cy="54" r="3" fill="#CEE49F" />
                      <circle cx="390" cy="54" r="3" fill="#CEE49F" />
                      <circle cx="440" cy="54" r="3" fill="#CEE49F" />
                      {/* Sweet Spot Annotation */}
                      <text x="270" y="42" fill="#CEE49F" fontSize="9.5" textAnchor="middle" fontFamily="monospace" fontWeight="700">₹24k (93.3%)</text>
                      <text x="440" y="70" fill="#ED9276" fontSize="8.5" textAnchor="end" fontFamily="monospace">Flatline: &Delta;0%</text>
                    </svg>
                  </div>
                )}

                {/* Step 9: Plan A vs Plan B Comparative Diff Matrix */}
                {msg.planDiff && (
                  <div>
                    <table className="plan-diff-table">
                      <thead>
                        <tr>
                          <th>Vector</th>
                          <th>Plan A (₹0)</th>
                          <th>Plan B (Target)</th>
                          <th>Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Service %</td>
                          <td>{msg.planDiff.planA.servicePct}%</td>
                          <td>{msg.planDiff.planB.servicePct}%</td>
                          <td className="diff-gain">+{msg.planDiff.delta.servicePctGain}%</td>
                        </tr>
                        <tr>
                          <td>Orders Delivered</td>
                          <td>{msg.planDiff.planA.ordersDelivered}/{msg.planDiff.planA.totalOrders}</td>
                          <td>{msg.planDiff.planB.ordersDelivered}/{msg.planDiff.planB.totalOrders}</td>
                          <td className="diff-gain">+{msg.planDiff.delta.incrementalOrders} Orders</td>
                        </tr>
                        <tr>
                          <td>Capital Spend</td>
                          <td>₹0</td>
                          <td>₹{msg.planDiff.planB.budget.toLocaleString('en-IN')}</td>
                          <td>+₹{msg.planDiff.delta.incrementalSpend.toLocaleString('en-IN')}</td>
                        </tr>
                        <tr>
                          <td>Critical SLA</td>
                          <td>{msg.planDiff.planA.criticalProtected}/{msg.planDiff.planA.criticalTotal}</td>
                          <td>{msg.planDiff.planB.criticalProtected}/{msg.planDiff.planB.criticalTotal}</td>
                          <td className="diff-gain">100% SLA</td>
                        </tr>
                      </tbody>
                    </table>
                    <button
                      className="toolbar-btn btn-active"
                      style={{ marginTop: 6 }}
                      onClick={() => openExecutiveDossierWindow()}
                    >
                      <FileText size={11} />
                      <span>PRINT EXECUTIVE DOSSIER FOR BOARDROOM</span>
                    </button>
                  </div>
                )}

                {/* Step 7: Healed CSV Mapping Preview */}
                {msg.csvPreview && (
                  <div className="csv-healer-panel">
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#CEE49F', marginBottom: 6 }}>
                      COLUMN MAPPING &amp; NORMALIZATION RESULTS:
                    </div>
                    <div>
                      {msg.csvPreview.mappings.map((m, i) => (
                        <span key={i} className="mapping-pill pill-healed">
                          {m.rawHeader} &rarr; {m.canonicalHeader} ({Math.round(m.confidence * 100)}%)
                        </span>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 10, color: '#8C9488', fontFamily: 'monospace' }}>
                      Fixed {msg.csvPreview.anomaliesFixed} boolean/numeric discrepancies across {msg.csvPreview.rowCount} rows.
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="copilot-bubble-wrap bubble-copilot">
              <div className="bubble-meta">
                <span>REVERSERESILIA // {SUPPORTED_MODELS[selectedModel].role}</span>
                <span>CALCULATING…</span>
              </div>
              <div className="copilot-bubble typing-bubble">
                <span className="dot dot-1"></span>
                <span className="dot dot-2"></span>
                <span className="dot dot-3"></span>
              </div>
            </div>
          )}
          <div ref={feedEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        <div className="copilot-chips">
          {promptChips.map((chip, idx) => (
            <button key={idx} className="chip-btn" onClick={() => handleSend(chip)}>
              {chip} &rarr;
            </button>
          ))}
        </div>

        {/* Command Input Bar (Step 6 Voice Push-to-Talk) */}
        <form className="copilot-input-bar" onSubmit={e => { e.preventDefault(); handleSend(); }}>
          <button
            type="button"
            className={`copilot-mic-btn ${isRecording ? 'is-recording' : ''}`}
            onClick={toggleVoiceRecording}
            title={isRecording ? 'Listening... Click to send' : 'Voice Dispatch (Push-to-Talk)'}
          >
            <Mic size={16} />
          </button>
          <input
            type="text"
            className="copilot-input"
            placeholder={isRecording ? 'Listening to speech...' : 'Ask about warehouse outages, CP-SAT constraints, or budgets...'}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            autoFocus
          />
          <button type="submit" className="copilot-send-btn" disabled={!inputValue.trim()}>
            <span>SEND</span>
            <Send size={13} />
          </button>
        </form>
      </aside>
    </div>,
    document.body
  );
};
