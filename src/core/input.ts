// Keyboard + mouse input with pointer lock and per-frame edge detection.
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  sensitivity = 1;
  invertY = false;
  /** When false, gameplay ignores input (cinematics) but edges are still tracked. */
  enabled = true;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = this.key(e);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault();
      this.down.add(k);
      this.pressed.add(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = this.key(e);
      this.down.delete(k);
      this.released.add(k);
    });
    window.addEventListener('mousedown', (e) => {
      const k = 'Mouse' + e.button;
      this.down.add(k);
      this.pressed.add(k);
    });
    window.addEventListener('mouseup', (e) => {
      const k = 'Mouse' + e.button;
      this.down.delete(k);
      this.released.add(k);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
    window.addEventListener('blur', () => this.down.clear());
  }

  private key(e: KeyboardEvent) {
    return e.code || e.key;
  }

  requestLock() {
    try {
      (this.canvas as any).requestPointerLock?.({ unadjustedMovement: true })?.catch?.(() => this.canvas.requestPointerLock());
    } catch {
      /* ignore */
    }
  }

  isDown(k: string) {
    return this.enabled && this.down.has(k);
  }
  wasPressed(k: string) {
    return this.enabled && this.pressed.has(k);
  }
  wasReleased(k: string) {
    return this.enabled && this.released.has(k);
  }
  /** Raw (ignores `enabled`), e.g. for skipping cinematics. */
  rawPressed(k: string) {
    return this.pressed.has(k);
  }
  anyPressed() {
    return this.pressed.size > 0;
  }

  axis() {
    const x = (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0);
    const y = (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0) - (this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0);
    return { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
