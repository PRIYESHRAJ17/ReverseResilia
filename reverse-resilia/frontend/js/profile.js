import { startClock } from './clock.js';
import { cloneDefaults } from './config.js';
import { o6 } from './ease.js';
import { splitLines } from './lines.js';
import { knockoutPills } from './knockout.js';
import { isMobile } from './mobile.js';
import { Portrait } from './portrait.js';
import { playOnClicks, SwitchSound } from './sound.js';
import { dragScroll } from './drag-scroll.js';
import { SmoothScroll } from './smooth-scroll.js';
import { HoverStack } from './stack.js';

const { gsap } = window;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const REVEAL = { from: 102, duration: 1.4, ease: o6, step: 0.1, start: 0.85, firstScreen: 0 };
const PHOTO_START = 0.8;
const PARALLAX = 0.13;

const isBack = (() => {
  try {
    return performance.getEntriesByType('navigation')[0].type === 'back_forward';
  } catch {
    return false;
  }
})();

document.querySelectorAll('[data-stub]').forEach((el) => el.addEventListener('click', (e) => e.preventDefault()));
try { knockoutPills([...document.querySelectorAll('.menu .pill')]); } catch (e) {}
try { startClock(document.querySelector('[data-clock]')); } catch (e) {}
try { playOnClicks(new SwitchSound(cloneDefaults().sound)); } catch (e) {}

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const page = document.querySelector('[data-page]');
const progressEl = document.querySelector('[data-progress]');
const mobile = isMobile();
const parallaxEls = mobile ? [] : (page ? [...page.querySelectorAll('[data-parallax]')] : []);
if (mobile && page) {
  page.querySelectorAll('.p-big br, .p-44 br').forEach((br) => br.replaceWith(' '));
  const [first, second] = page.querySelectorAll('.p-big');
  if (first && second) {
    first.append(' ', ...second.childNodes);
    second.remove();
  }
}

function buildGroups() {
  if (!page) return [];
  const groups = new Map();
  page.querySelectorAll('[data-group]').forEach((el) => {
    const name = el.dataset.group;
    if (!groups.has(name)) groups.set(name, { name, els: [], steps: [], shown: false });
    const group = groups.get(name);
    const base = Number(el.dataset.step) || 0;
    group.els.push(el);
    splitLines(el).forEach((inner, i) => {
      (group.steps[base + i] ||= []).push(inner);
    });
  });
  return [...groups.values()];
}

const masks = (group) => group.steps.flat().map((inner) => inner.parentElement);

function hideGroup(group) {
  try {
    gsap.set(group.steps.flat(), { yPercent: REVEAL.from });
    gsap.set(masks(group), { visibility: 'hidden' });
  } catch (e) {}
}

function splitAtWindow(group) {
  const steps = group.steps;
  let n = 0;
  while (n < steps.length && (!steps[n] || steps[n].some((inner) => inner.parentElement.getBoundingClientRect().top < window.innerHeight))) n++;
  const now = n > 0 ? { ...group, steps: steps.slice(0, n) } : null;
  const rest = n < steps.length ? { ...group, steps: steps.slice(n), trigger: steps[n][0].parentElement } : null;
  return { now, rest };
}

function showGroup(group, instant = false, delay = 0) {
  if (!group) return;
  group.shown = true;
  const base = (group.firstScreen ? REVEAL.firstScreen : 0) + delay;
  group.steps.forEach((inners, k) => {
    if (!inners) return;
    const show = () => gsap.set(inners.map((inner) => inner.parentElement), { visibility: '' });
    const done = () => inners.forEach((inner) => inner.parentElement.classList.add('is-in'));
    if (instant) {
      show();
      gsap.set(inners, { yPercent: 0 });
      done();
      return;
    }
    gsap.to(inners, {
      yPercent: 0,
      duration: REVEAL.duration,
      ease: REVEAL.ease,
      delay: base + k * REVEAL.step,
      onStart: show,
      onComplete: done,
    });
  });
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function boot() {
  if (!page) return;
  let images = [];
  try {
    images = (await Promise.all([loadImage('/media/profile/portrait.jpg'), loadImage('/media/profile/portrait-hover.jpg')])).filter(Boolean);
  } catch (e) {}
  try { await document.fonts.ready; } catch (e) {}

  const groups = buildGroups();
  groups.forEach(hideGroup);
  const names = groups.find((g) => g.name === 'names');
  const heroParts = groups.filter((g) => g.name.startsWith('hero'));
  const others = groups.filter((g) => g !== names && !heroParts.includes(g));
  others.forEach((g) => {
    if (g.els[0]) {
      g.firstScreen = g.els[0].getBoundingClientRect().top < window.innerHeight * REVEAL.start;
    }
  });
  const opening = [];
  const heroRest = [];
  heroParts.forEach((g) => {
    const { now, rest } = splitAtWindow(g);
    if (now) opening.push(now);
    if (rest) heroRest.push(rest);
  });
  const below = [...heroRest, ...others];
  const heroDelay = mobile ? 0 : (names && names.steps ? names.steps.length * REVEAL.step : 0);
  page.classList.add('is-ready');

  let stack = { scroll: () => {} };
  try {
    stack = new HoverStack(document.querySelector('[data-stack-layer]'), page);
  } catch (e) {
    console.warn('HoverStack init:', e);
  }

  const photoSlot = document.querySelector('[data-photo]');
  let portrait = { show: () => {}, resize: () => {}, update: () => {} };
  try {
    const glCanvas = document.querySelector('[data-gl]');
    if (glCanvas && photoSlot && images.length) {
      portrait = new Portrait(glCanvas, photoSlot, images);
    }
  } catch (e) {
    console.warn('Portrait init:', e);
  }

  let photoShown = isBack;
  if (isBack && portrait.show) portrait.show(true);

  const scroll = { current: window.scrollY, max: 0 };
  const parallax = { zero: 0, y: null };
  function drawParallax(s) {
    const y = Math.round(-(s - parallax.zero) * PARALLAX * 100) / 100;
    if (y === parallax.y) return;
    parallax.y = y;
    parallaxEls.forEach((el) => (el.style.transform = `translate3d(0, ${y}px, 0)`));
  }
  function measure() {
    document.body.style.height = `${page.offsetHeight}px`;
    scroll.max = Math.max(0, page.offsetHeight - window.innerHeight);
    if (parallaxEls.length) {
      const top = Math.min(...parallaxEls.map((el) => el.offsetTop));
      const bottom = Math.max(...parallaxEls.map((el) => el.offsetTop + el.offsetHeight));
      parallax.zero = (top + bottom) / 2 - window.innerHeight / 2;
      parallax.y = null;
      drawParallax(scroll.current);
    }
    page.style.transform = `translate3d(0, ${-scroll.current}px, 0)`;
    if (stack.scroll) stack.scroll(scroll.current);
    if (portrait.resize) portrait.resize(scroll.current);
  }
  measure();
  window.addEventListener('resize', measure);
  const smooth = new SmoothScroll({ duration: 0.32, wheelMultiplier: 1.0 });
  dragScroll(smooth);

  let shownProgress = null;
  let lastScroll = -1;
  let isProfilePaused = false;
  let profileRaf = null;

  const shouldPauseProfile = () => {
    return (
      (typeof window !== 'undefined' && (!!window.__isDrawerOpen || document.documentElement.classList.contains('is-drawer-open'))) ||
      document.hidden
    );
  };

  window.addEventListener('resilia-drawer-state', (e) => {
    if (!e.detail?.isOpen && isProfilePaused) {
      isProfilePaused = false;
      if (!profileRaf) profileRaf = requestAnimationFrame(frame);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isProfilePaused && !shouldPauseProfile()) {
      isProfilePaused = false;
      if (!profileRaf) profileRaf = requestAnimationFrame(frame);
    }
  });

  function frame(now) {
    if (shouldPauseProfile()) {
      isProfilePaused = true;
      profileRaf = null;
      return;
    }

    smooth.raf(now);
    scroll.current = smooth.animatedScroll;
    const s = scroll.current;
    const scrollChanged = Math.abs(s - lastScroll) > 0.05;

    if (scrollChanged) {
      lastScroll = s;
      page.style.transform = `translate3d(0, ${-s}px, 0)`;
      if (stack.scroll) stack.scroll(s);
      drawParallax(s);

      const value = Math.round(scroll.max > 0 ? clamp(s / scroll.max, 0, 1) * 100 : 0);
      if (value !== shownProgress) {
        shownProgress = value;
        if (progressEl) progressEl.textContent = String(value).padStart(3, '0');
      }

      const limit = window.innerHeight * REVEAL.start;
      below.forEach((g) => {
        if (!g.shown && (g.trigger || g.els[0]).getBoundingClientRect().top < limit) showGroup(g);
      });
      if (!photoShown && photoSlot && photoSlot.getBoundingClientRect().top < window.innerHeight * PHOTO_START) {
        photoShown = true;
        if (portrait.show) portrait.show();
      }
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (portrait.update && (!reduceMotion || scrollChanged)) {
      portrait.update(now, s);
    }
    profileRaf = requestAnimationFrame(frame);
  }
  profileRaf = requestAnimationFrame(frame);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    if (window.pageTransition && window.pageTransition.enter) {
      window.pageTransition.enter();
    } else {
      document.documentElement.classList.remove('veil-in', 'veil-on');
      const v = document.querySelector('[data-veil]');
      if (v) v.style.opacity = '0';
    }
  } catch (e) {
    document.documentElement.classList.remove('veil-in', 'veil-on');
  }

  if (isBack) {
    heroParts.forEach((g) => showGroup(g, true));
    if (names) showGroup(names, true);
  } else {
    if (names) showGroup(names);
    opening.forEach((g) => showGroup(g, false, heroDelay));
  }
}

boot().catch((err) => {
  console.error('Boot error:', err);
  document.documentElement.classList.remove('veil-in', 'veil-on');
  const p = document.querySelector('[data-page]');
  if (p) {
    p.classList.add('is-ready');
    p.style.visibility = 'visible';
    p.querySelectorAll('*').forEach((el) => {
      el.style.visibility = 'visible';
    });
  }
});
