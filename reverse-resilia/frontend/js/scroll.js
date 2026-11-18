const lerp = (a, b, t) => (1 - t) * a + t * b;

export class SlideScroll {
  constructor(params, count) {
    this.params = params || {};
    this.count = count;
    this.target = 0;
    this.current = 0;
    this.enabled = true;
    
    // Wheel state
    this.wheelDelta = 0;
    this.lastWheelTime = 0;
    this.wheelResetTimer = null;
    
    // Drag / Touch state
    this.touchY = null;
    this.dragStartY = null;
    this.isDragging = false;

    // Listeners
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    
    window.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: true });
    window.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: true });
    window.addEventListener('touchend', () => this.onTouchEnd());

    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
  }

  get step() {
    return (window.innerHeight * this.count) / Math.max(1, this.count - 1);
  }

  next() {
    if (!this.enabled) return;
    this.target = Math.round(this.target) + 1;
  }

  prev() {
    if (!this.enabled) return;
    this.target = Math.round(this.target) - 1;
  }

  jump(index) {
    this.touchY = null;
    this.dragStartY = null;
    this.isDragging = false;
    this.wheelDelta = 0;
    this.target = this.current = index;
  }

  goTo(index) {
    if (!this.enabled) return;
    this.target = index;
  }

  onWheel(e) {
    if (!this.enabled) return;
    // Don't intercept scroll inside modals or drawers
    if (e.target && e.target.closest && e.target.closest('.engine-modal, .c-drawer, [data-work], .work-page, aside')) {
      return;
    }

    e.preventDefault();
    const now = performance.now();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 30; // Firefox line mode
    if (e.deltaMode === 2) dy *= window.innerHeight; // Page mode

    this.wheelDelta += dy;

    // Threshold of 35px accumulated delta, with 260ms cooldown for crisp, natural slide transitions
    const threshold = 35;
    if (Math.abs(this.wheelDelta) >= threshold && now - this.lastWheelTime > 260) {
      if (this.wheelDelta > 0) {
        this.next();
      } else {
        this.prev();
      }
      this.wheelDelta = 0;
      this.lastWheelTime = now;
    }

    clearTimeout(this.wheelResetTimer);
    this.wheelResetTimer = setTimeout(() => {
      this.wheelDelta = 0;
    }, 180);
  }

  onKeyDown(e) {
    if (!this.enabled) return;
    // Ignore keydown if focused on inputs
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) {
      e.preventDefault();
      this.next();
    } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) {
      e.preventDefault();
      this.prev();
    } else if (e.key === 'Home') {
      e.preventDefault();
      this.jump(0);
    }
  }

  onMouseDown(e) {
    if (!this.enabled || e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('a, button, input, select, nav, [data-ui], .engine-modal')) return;
    this.dragStartY = e.clientY;
    this.isDragging = true;
  }

  onMouseMove(e) {
    if (!this.enabled || !this.isDragging || this.dragStartY === null) return;
    const dy = e.clientY - this.dragStartY;
    if (Math.abs(dy) > 50) {
      if (dy < 0) {
        this.next();
      } else {
        this.prev();
      }
      this.dragStartY = null;
      this.isDragging = false;
    }
  }

  onMouseUp() {
    this.isDragging = false;
    this.dragStartY = null;
  }

  onTouchStart(e) {
    if (!this.enabled) return;
    this.touchY = e.touches[0].clientY;
  }

  onTouchMove(e) {
    if (!this.enabled || this.touchY === null) return;
    const dy = e.touches[0].clientY - this.touchY;
    if (Math.abs(dy) > 40) {
      if (dy < 0) {
        this.next();
      } else {
        this.prev();
      }
      this.touchY = null;
    }
  }

  onTouchEnd() {
    this.touchY = null;
  }

  update() {
    const lerpFactor = this.params.lerp || 0.09;
    this.current = lerp(this.current, this.target, lerpFactor);
    if (Math.abs(this.target - this.current) < 1e-4) {
      this.current = this.target;
    }
  }

  get position() {
    return this.current;
  }
}
