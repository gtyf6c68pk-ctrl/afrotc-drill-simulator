// =====================================================================
//  camera-controller.js: SHARED smooth camera for the maps.
//    this.camera = new CameraController(scene, { worldW, worldH, target: () => ({x, y}), zoom, minZoom, maxZoom });
//    this.camera.update(dt)   // every frame
//  - Mouse wheel / trackpad pinch: smooth zoom toward the pointer's area
//  - Click and drag on the map: look around (turns "follow" off)
//  - Follow: the camera glides after the flight (button or the F key turns it back on)
//  The HUD buttons call zoomBy() and toggleFollow(); onChange tells the HUD the zoom and follow state.
// =====================================================================

class CameraController {
  constructor(scene, opts) {
    this.scene = scene;
    this.cam = scene.cameras.main;
    this.opts = opts;
    this.minZoom = opts.minZoom || 0.15;
    this.maxZoom = opts.maxZoom || 3;
    this.targetZoom = this.clampZoom(opts.zoom || 1);
    this.cam.setZoom(this.targetZoom);
    this.follow = true;
    this.center = opts.target();
    this.onChange = opts.onChange || (() => {});

    const input = scene.input;
    input.on('wheel', (pointer, over, dx, dy) => {
      const pinch = pointer.event && pointer.event.ctrlKey;          // trackpad pinch arrives as ctrl + wheel
      this.setZoom(this.targetZoom * Math.exp(-dy * (pinch ? 0.01 : 0.0015)));
    });
    input.on('pointerdown', p => { this.drag = { x: p.x, y: p.y }; });
    input.on('pointerup', () => { this.drag = null; });
    input.on('pointermove', p => {
      if (!this.drag || !p.isDown) return;
      const z = this.cam.zoom;
      this.center.x -= (p.x - this.drag.x) / z;
      this.center.y -= (p.y - this.drag.y) / z;
      this.drag = { x: p.x, y: p.y };
      if (this.follow) { this.follow = false; this.onChange(this); }
    });
    if (input.keyboard) input.keyboard.on('keydown-F', e => { if (!isTyping(e)) this.toggleFollow(); });
    this.onChange(this);
    this.update(1, true);
  }

  clampZoom(z) { return Math.max(this.minZoom, Math.min(this.maxZoom, z)); }
  setZoom(z) { this.targetZoom = this.clampZoom(z); this.onChange(this); }
  zoomBy(factor) { this.setZoom(this.targetZoom * factor); }
  toggleFollow() { this.follow = !this.follow; this.onChange(this); }

  // Smoothly approach the target zoom and (when following) the flight; never show past the map
  update(dt, snap) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 8);
    const cam = this.cam;
    cam.setZoom(cam.zoom + (this.targetZoom - cam.zoom) * k);
    if (this.follow) {
      const t = this.opts.target();
      const kf = snap ? 1 : 1 - Math.exp(-dt * 4);
      this.center.x += (t.x - this.center.x) * kf;
      this.center.y += (t.y - this.center.y) * kf;
    }
    const halfW = cam.width / cam.zoom / 2, halfH = cam.height / cam.zoom / 2;
    const clamp = (v, half, size) => size <= half * 2 ? size / 2 : Math.max(half, Math.min(size - half, v));
    this.center.x = clamp(this.center.x, halfW, this.opts.worldW);
    this.center.y = clamp(this.center.y, halfH, this.opts.worldH);
    cam.centerOn(this.center.x, this.center.y);
  }
}

// True if a key press is meant for a text box (so map shortcuts don't fire while typing)
function isTyping(e) {
  const el = (e && e.target) || document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}
