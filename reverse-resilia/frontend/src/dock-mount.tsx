import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Layers, Cpu, BookOpen, Zap, Bot } from 'lucide-react';
import { MagnificationDock, type DockItemData } from './components/MagnificationDock';
import { DispatchCopilot } from './components/DispatchCopilot';
import { initGlobalCursor } from './cursor';
import '../css/dock.css';

// Initialize global cursor across every page
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initGlobalCursor());
  } else {
    initGlobalCursor();
  }
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

    const engineUrl = (typeof window !== 'undefined' && (window as any).__REVERSERESILIA_ENGINE_URL__) || (import.meta as any).env?.VITE_ENGINE_URL || 'http://localhost:8000';
    drawer = document.createElement('aside');
    drawer.className = 'engine-dock-drawer';
    drawer.id = 'engine-dock-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = `
      <div class="engine-dock-header">
        <div class="engine-status-badge">
          <span class="engine-live-dot"></span>
          <span class="mono">LIVE SOLVER SUITE // REAL-TIME CP-SAT OPTIMIZATION</span>
        </div>
        <div class="engine-header-actions">
          <button class="pill pill--sm" id="btn-open-copilot-suite" style="color: #cee49f; border-color: rgba(206,228,159,0.5); background: rgba(206,228,159,0.14); margin-right: 8px; cursor: pointer; font-weight: 700;" title="Open AI Dispatch Copilot">🤖 AI Dispatch Copilot</button>
          <button class="pill pill--sm" id="btn-close-engine" title="Close and return to showcase">[✕ Close / Return to Showcase]</button>
        </div>
      </div>
      <div class="engine-dock-body">
        <div class="engine-iframe-wrap">
          <iframe src="${engineUrl}/?_rr_v=2.0" title="ReverseResilia Optimization Engines" class="engine-iframe" id="engine-iframe"></iframe>
        </div>
      </div>
    `;
    document.body.appendChild(drawer);
  }

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
