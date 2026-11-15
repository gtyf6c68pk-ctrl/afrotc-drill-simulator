// =====================================================================
//  drill-pad-scene.js: the Drill Pad map (Practice mode)
//  Pad size, cadence, flight size, etc. come from the Settings screen.
//  Painted once in the pixel-art style: grass around an asphalt pad with a painted
//  boundary, faint lines every 5 steps and orange cones at the corners.
// =====================================================================

class DrillPadScene extends Phaser.Scene {
  constructor() { super('DrillPad'); }

  create() {
    const size = PAD_SIZES[settings.padSize];
    const padW = size.w * STEP_PX, padH = size.h * STEP_PX;
    const M = STEP_PX * 40;                                 // grass margin around the pad (fills the window)
    const W = padW + 2 * M, H = padH + 2 * M;
    this.cameras.main.setBackgroundColor('#2f4a2a');
    this.drawPad(W, H, M, padW, padH);

    // The flight: rules in flight-logic.js, drawing in flight-view.js. Starts in column near the bottom of the pad
    const edge = 15;
    const flightLength = (settings.elementSize - 1) * DISTANCE_PX;
    const leadY = M + Math.max(60, Math.min(padH * 0.6, padH - 40 - flightLength));
    this.flight = new FlightLogic({
      bounds: { x0: M + edge, y0: M + edge, x1: M + padW - edge, y1: M + padH - edge },
      start: { x: M + padW / 2, y: leadY },
      areaName: 'drill pad',
      onFeedback: showFeedback,
      onStatus: showStatus,
      cadence: settings.cadence,
      elements: settings.elements,
      elementSize: settings.elementSize,
      cdrSide: settings.cdrSide,
      disorder: DISORDER_LEVELS[settings.disorder],
    });
    this.flightView = new FlightView(this, this.flight);
    setActiveFlight(this.flight);
    this.events.once('shutdown', () => { setActiveFlight(null); activeCamera = null; activeRun = null; });

    // The scenario chosen on the menu (scenarios.js): Practice coach, objectives, results
    const def = SCENARIOS[currentScenario] || SCENARIOS.practice;
    setHud({ mode: esc(def.mode) + ' · <b>' + esc(def.title) + '</b>',
             attribution: 'Drill pad · each faint square = 5 steps · North is up · Tiles: Kenney.nl' });
    this.run = startRun(def, this.flight);
    this.metronome = new FootMetronome(this.flight, settings.cadence);

    // Smooth camera: start zoomed so the whole pad fits
    const fit = Math.min((this.scale.width - 120) / padW, (this.scale.height - 340) / padH);   // the pad fits
    this.camera = new CameraController(this, {
      worldW: W, worldH: H, zoom: LINK.zoom || Math.max(0.5, Math.min(2.2, fit)),
      minZoom: 0.3, maxZoom: 4, target: () => this.flightCenter(),
    });
    setActiveCamera(this.camera);

    giveLinkCommands(this, this.flight);   // commands/fast-forward from the page address
  }

  drawPad(W, H, M, padW, padH) {
    const tilesReady = KENNEY_TILES.complete && KENNEY_TILES.naturalWidth > 0;
    PAINT.chunks(this, null, W, H, 'pad', (ctx, x0, y0, x1, y1) => {
      ctx.fillStyle = tilesReady ? PAINT.pattern(ctx, CAMPUS_TILES.grass) : '#4f7a3a';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      // Soft shadow under the pad's edge, then the asphalt
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(M + 6, M + 8, padW, padH);
      ctx.fillStyle = tilesReady ? PAINT.pattern(ctx, CAMPUS_TILES.asphalt) : '#5b6168';
      ctx.fillRect(M, M, padW, padH);
      // Faint lines every 5 steps
      ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
      for (let x = M + STEP_PX * 5; x < M + padW; x += STEP_PX * 5) ctx.fillRect(x - 1, M, 2, padH);
      for (let y = M + STEP_PX * 5; y < M + padH; y += STEP_PX * 5) ctx.fillRect(M, y - 1, padW, 2);
      // Painted boundary (slightly worn: a few darker gaps)
      ctx.fillStyle = '#eef1f2';
      const t = 8;
      ctx.fillRect(M, M, padW, t); ctx.fillRect(M, M + padH - t, padW, t);
      ctx.fillRect(M, M, t, padH); ctx.fillRect(M + padW - t, M, t, padH);
      ctx.fillStyle = 'rgba(60, 64, 70, 0.5)';
      for (let x = M + 37; x < M + padW; x += 151) ctx.fillRect(x, M, 8, t);
      for (let y = M + 53; y < M + padH; y += 173) ctx.fillRect(M + padW - t, y, t, 8);
      // Orange cones at the corners (blocky, with a shadow to the south-east)
      [[M, M], [M + padW, M], [M, M + padH], [M + padW, M + padH]].forEach(([cx, cy]) => {
        ctx.fillStyle = 'rgba(10, 20, 30, 0.30)';
        ctx.beginPath(); ctx.ellipse(cx + 10, cy + 14, 16, 10, 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1d1d1d'; ctx.fillRect(cx - 16, cy - 16, 32, 32);   // base
        ctx.fillStyle = '#ff7a1a'; ctx.fillRect(cx - 12, cy - 12, 24, 24);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 8, cy - 8, 16, 16);     // reflective band
        ctx.fillStyle = '#ff9a40'; ctx.fillRect(cx - 4, cy - 4, 8, 8);       // tip
      });
    });
    // "N" marker painted on the grass above the pad
    this.add.text(M + padW / 2, M - 70, '▲ N', { fontFamily: 'Inter, sans-serif', fontStyle: 'bold', fontSize: '44px',
      color: '#ffffff' }).setOrigin(0.5).setAlpha(0.55);
  }

  flightCenter() {
    const m = this.flight.marchers();
    return { x: m.reduce((s, p) => s + p.x, 0) / m.length, y: m.reduce((s, p) => s + p.y, 0) / m.length };
  }

  update(time, deltaMs) {
    const dt = deltaMs / 1000;
    this.flight.update(dt);
    this.flightView.sync(dt);
    this.metronome.update(dt);
    this.camera.update(dt);
    this.run.update(dt);
    updateRunHud();
  }
}
