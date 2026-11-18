// Custom Cursor Animation — Matching ReverseResilia Hero GSAP #36296 Specification

export function initCursor() {
  if (typeof window === 'undefined') return;

  if (window.__resiliaCursor) {
    return window.__resiliaCursor;
  }

  let el = document.querySelector('[data-cursor]');
  if (!el) {
    el = document.createElement('div');
    el.className = 'cursor-example';
    el.setAttribute('data-cursor', '');
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  } else if (!el.classList.contains('cursor-example')) {
    el.className = 'cursor-example';
    el.textContent = '';
  }

  let posX = window.innerWidth / 2;
  let posY = window.innerHeight / 2;
  let mouseX = posX;
  let mouseY = posY;
  let isMoving = false;
  let isHovering = false;
  let isEnabled = true;

  // Smooth lagging cursor loop (linear lag formula posX += (mouseX - posX) / 8)
  function render() {
    posX += (mouseX - posX) / 8;
    posY += (mouseY - posY) / 8;
    el.style.left = (posX - 12.5) + 'px';
    el.style.top = (posY - 12.5) + 'px';
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!isMoving) {
      isMoving = true;
      el.classList.add('is-visible');
    }
    const isInteractive = Boolean(
      e.target?.closest?.(
        'a, button, .button, [role="button"], select, input, textarea, summary, .point, label, .check, th, nav button, [tabindex="0"]'
      )
    );
    if (isInteractive !== isHovering) {
      isHovering = isInteractive;
      el.classList.toggle('is-hovering', isHovering);
    }
  });

  window.addEventListener('mousedown', () => {
    el.classList.add('is-clicking');
  });

  window.addEventListener('mouseup', () => {
    el.classList.remove('is-clicking');
  });

  document.documentElement.addEventListener('mouseleave', () => {
    el.classList.remove('is-visible');
  });

  document.documentElement.addEventListener('mouseenter', () => {
    if (isEnabled && isMoving) {
      el.classList.add('is-visible');
    }
  });

  const cursor = {
    el,
    setEnabled: (on) => {
      isEnabled = on;
      el.classList.toggle('is-visible', on);
    },
    setHover: (on) => {
      el.classList.toggle('is-hovering', on);
    },
  };

  window.__resiliaCursor = cursor;
  return cursor;
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initCursor());
  } else {
    initCursor();
  }
}
