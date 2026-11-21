import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Layers, Cpu, BookOpen, Zap, Bot } from 'lucide-react';
import { MagnificationDock, type DockItemData } from './components/MagnificationDock';
import { DispatchCopilot } from './components/DispatchCopilot';
import { initGlobalCursor } from './cursor';
import '../css/dock.css';

// Prewarm cloud solver silently on page load
function prewarmCloudEngine() {
  try {
    const engineUrl = getEngineUrl();
    if (engineUrl && engineUrl.startsWith('https://')) {
      fetch(`${engineUrl}/api/health`, { mode: 'no-cors', cache: 'no-cache' }).catch(() => {});
    }
  } catch (_) {}
}

// Initialize global cursor and prewarm engine across every page
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initGlobalCursor();
      prewarmCloudEngine();
    });
  } else {
    initGlobalCursor();
    prewarmCloudEngine();
  }
}

export function getEngineUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:8000';
  const custom = (window as any).__REVERSERESILIA_ENGINE_URL__ || localStorage.getItem('REVERSERESILIA_ENGINE_URL');
  if (custom && typeof custom === 'string' && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }
  const envUrl = (import.meta as any).env?.VITE_ENGINE_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() && envUrl !== 'http://localhost:8000') {
    return envUrl.trim().replace(/\/+$/, '');
  }
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return 'https://reverseresilia-engine.onrender.com';
  }
  return 'http://localhost:8000';
}

function bindDrawerEvents() {
  const drawer = document.getElementById('engine-dock-drawer');
  const backdrop = document.getElementById('engine-backdrop');
  if (drawer) {
    const closeBtn = drawer.querySelector('#btn-close-engine');
    if (closeBtn && !(closeBtn as any).__hasCloseListener) {
      closeBtn.addEventListener('click', closeLiveSolverSuite);
      (closeBtn as any).__hasCloseListener = true;
    }
    const copilotBtn = drawer.querySelector('#btn-open-copilot-suite');
    if (copilotBtn && !(copilotBtn as any).__hasCopilotListener) {
      copilotBtn.addEventListener('click', () => {
        const iframe = document.getElementById('engine-iframe') as HTMLIFrameElement;
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage('open-copilot-popup', '*');
        }
      });
      (copilotBtn as any).__hasCopilotListener = true;
    }
    const editUrlBtn = drawer.querySelector('#btn-edit-engine-url');
    if (editUrlBtn && !(editUrlBtn as any).__hasEditListener) {
      editUrlBtn.addEventListener('click', () => {
        const current = getEngineUrl();
        const entered = window.prompt('ReverseResilia Engine Backend URL (Render/Railway/Local):', current);
        if (entered !== null && entered.trim() !== '') {
          localStorage.setItem('REVERSERESILIA_ENGINE_URL', entered.trim());
          const iframe = document.getElementById('engine-iframe') as HTMLIFrameElement;
          if (iframe) {
            iframe.src = `${entered.trim().replace(/\/+$/, '')}/?_rr_v=2.0`;
          }
          const label = drawer.querySelector('#engine-url-label');
          if (label) label.textContent = entered.trim().replace(/^https?:\/\//, '');
        }
      });
      (editUrlBtn as any).__hasEditListener = true;
    }
  }
  if (backdrop && !(backdrop as any).__hasCloseListener) {
    backdrop.addEventListener('click', closeLiveSolverSuite);
    (backdrop as any).__hasCloseListener = true;
  }
}

function openLiveSolverSuite(initialTab?: 'copilot') {
  let drawer = document.getElementById('engine-dock-drawer');
  let backdrop = document.getElementById('engine-backdrop');

  if (!drawer) {
    backdrop = document.createElement('div');
    backdrop.className = 'engine-backdrop';
    backdrop.id = 'engine-backdrop';
    document.body.appendChild(backdrop);

    const engineUrl = getEngineUrl();
    const displayUrl = engineUrl.replace(/^https?:\/\//, '');
    drawer = document.createElement('aside');
    drawer.className = 'engine-dock-drawer';
    drawer.id = 'engine-dock-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = `
      <div class="engine-dock-header">
        <div class="engine-status-badge">
          <span class="engine-live-dot"></span>
          <span class="mono">LIVE SOLVER SUITE // REAL-TIME CP-SAT OPTIMIZATION</span>
          <button class="pill pill--sm" id="btn-edit-engine-url" style="margin-left: 12px; font-size: 10px; opacity: 0.85; padding: 2px 8px;" title="Click to view or edit target Solver Engine URL">Target: <span id="engine-url-label">${displayUrl}</span> ✎</button>
        </div>
        <div class="engine-header-actions">
          <button class="pill pill--sm" id="btn-open-copilot-suite" style="color: #cee49f; border-color: rgba(206,228,159,0.5); background: rgba(206,228,159,0.14); margin-right: 8px; cursor: pointer; font-weight: 700;" title="Open AI Dispatch Copilot">🤖 AI Dispatch Copilot</button>
          <button class="pill pill--sm" id="btn-close-engine" title="Close and return to showcase">[✕ Close / Return to Showcase]</button>
        </div>
      </div>
      <div class="engine-dock-body" style="position: relative;">
        <div class="engine-iframe-wrap">
          <iframe src="${engineUrl}/?_rr_v=2.0" title="ReverseResilia Optimization Engines" class="engine-iframe" id="engine-iframe"></iframe>
        </div>
        <div id="engine-wake-banner" style="display: none; position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(15,16,13,0.95); border: 1px solid #cee49f; color: #cee49f; padding: 8px 18px; border-radius: 9999px; font-size: 11px; z-index: 60; box-shadow: 0 4px 24px rgba(0,0,0,0.8); pointer-events: auto; font-family: monospace;">
          <span>⚡ Connecting to cloud solver (Render free tier wakes up in ~15-20s)...</span>
          <a href="${engineUrl}/" target="_blank" rel="noopener noreferrer" style="color: #fff; margin-left: 10px; text-decoration: underline; font-weight: 700;">Open Direct Link &nearr;</a>
        </div>
      </div>
    `;
    document.body.appendChild(drawer);
  }

  const engineUrl = getEngineUrl();
  const iframe = drawer.querySelector('#engine-iframe') as HTMLIFrameElement;
  if (iframe) {
    const targetSrc = `${engineUrl}/?_rr_v=2.0`;
    const cur = iframe.getAttribute('src') || '';
    if (!cur || (cur.includes('localhost:8000') && engineUrl !== 'http://localhost:8000')) {
      iframe.src = targetSrc;
    }
    
    const wakeBanner = drawer.querySelector('#engine-wake-banner') as HTMLElement;
    if (wakeBanner) {
      wakeBanner.style.display = 'none';
      let loaded = false;
      iframe.onload = () => {
        loaded = true;
        wakeBanner.style.display = 'none';
      };
      setTimeout(() => {
        if (!loaded) wakeBanner.style.display = 'flex';
      }, 3500);
    }
  }
  const label = drawer.querySelector('#engine-url-label');
  if (label) label.textContent = engineUrl.replace(/^https?:\/\//, '');

  bindDrawerEvents();

  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  if (backdrop) backdrop.classList.add('is-open');
  document.documentElement.classList.add('is-drawer-open');
  document.body.classList.add('is-drawer-open');
  (window as any).__isDrawerOpen = true;

  // Fully hide parent cursor when solver suite drawer is open to prevent double cursors
  const cursorEl = document.querySelector('[data-cursor]') as HTMLElement;
  if (cursorEl) {
    cursorEl.style.opacity = '0';
    cursorEl.style.display = 'none';
  }

  if (initialTab === 'copilot') {
    setTimeout(() => {
      const iframe = document.getElementById('engine-iframe') as HTMLIFrameElement;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage('go-copilot', '*');
      }
    }, 250);
  }

  window.dispatchEvent(new CustomEvent('resilia-drawer-state', { detail: { isOpen: true } }));
}

function closeLiveSolverSuite() {
  const drawer = document.getElementById('engine-dock-drawer');
  const backdrop = document.getElementById('engine-backdrop');
  if (drawer) {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
  }
  if (backdrop) backdrop.classList.remove('is-open');
  document.documentElement.classList.remove('is-drawer-open');
  document.body.classList.remove('is-drawer-open');
  (window as any).__isDrawerOpen = false;

  const cursorEl = document.querySelector('[data-cursor]') as HTMLElement;
  if (cursorEl) {
    cursorEl.style.display = '';
  }

  window.dispatchEvent(new CustomEvent('resilia-drawer-state', { detail: { isOpen: false } }));
}

if (typeof window !== 'undefined') {
  bindDrawerEvents();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLiveSolverSuite();
  });
  window.addEventListener('message', (e) => {
    if (e.data === 'close-engine-drawer') closeLiveSolverSuite();
    if (e.data === 'open-copilot') openLiveSolverSuite('copilot');
    if (e.data === 'open-engine') openLiveSolverSuite();
  });
  window.addEventListener('open-solver-suite', () => openLiveSolverSuite());
  
  // Smoothly intercept any static link or button pointing to localhost:8000
  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement)?.closest('a[href*="localhost:8000"], [data-open-engine]');
    if (target) {
      e.preventDefault();
      openLiveSolverSuite();
    }
  });
}

function TopNavDock() {
  const currentPath = typeof window !== 'undefined'
    ? window.location.pathname.replace(/\/$/, '') || '/'
    : '/';

  const isRegionalGrids = currentPath === '/regional-grids' || currentPath === '/residences' || currentPath.startsWith('/residences') || currentPath.startsWith('/regional-grids');
  const isRecoveryEngine = currentPath === '/recovery-engine' || currentPath === '/about';
  const isDisruptionResearch = currentPath === '/disruption-research' || currentPath === '/journal';

  const items: DockItemData[] = useMemo(() => [
    {
      icon: <Layers size={18} strokeWidth={2.1} />,
      label: '01 // REGIONAL GRIDS',
      href: '/regional-grids',
      isActive: isRegionalGrids,
    },
    {
      icon: <Cpu size={18} strokeWidth={2.1} />,
      label: '02 // RECOVERY ENGINE',
      href: '/recovery-engine',
      isActive: isRecoveryEngine,
    },
    {
      icon: <BookOpen size={18} strokeWidth={2.1} />,
      label: '03 // DISRUPTION RESEARCH',
      href: '/disruption-research',
      isActive: isDisruptionResearch,
    },
    {
      icon: <Zap size={18} strokeWidth={2.1} />,
      label: '04 // LIVE SOLVER SUITE',
      onClick: () => {
        openLiveSolverSuite();
      },
    },
  ], [isRegionalGrids, isRecoveryEngine, isDisruptionResearch]);

  return (
    <MagnificationDock
      items={items}
      panelHeight={48}
      baseItemSize={38}
      magnification={54}
      distance={160}
      dockHeight={68}
      spring={{ mass: 0.1, stiffness: 180, damping: 14 }}
      tooltipPlacement="bottom"
    />
  );
}

const mountEl = document.getElementById('dock-root');
if (mountEl) {
  const root = ReactDOM.createRoot(mountEl);
  root.render(<TopNavDock />);
}
