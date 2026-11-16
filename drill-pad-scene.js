// =====================================================================
//  drill-pad-scene.js: the Drill Pad map (Practice and FDE modes)
//  Pad size, cadence, flight size, etc. come from the Settings screen, unless the scenario
//  (scenarios.js) sets its own pad: FDE = a lot with a 40 ft square of cones and a flight of 12.
//  Painted once in the pixel-art style: grass around an asphalt pad with a painted
//  boundary, faint lines every 5 steps and orange cones at the corners.
// =====================================================================

class DrillPadScene extends Phaser.Scene {
  constructor() { super('DrillPad'); }

  create() {
    // The scenario chosen on the menu (scenarios.js): Practice coach, FDE, objectives, results
    const def = SCENARIOS[currentScenario] || SCENARIOS.practice;
    const P = def.pad || null;
    const size = P ? { w: P.w, h: P.h } : PAD_SIZES[settings.padSize];
    const padW = size.w * STEP_PX, padH = size.h * STEP_PX;
    const M = STEP_PX * 40;                                 // grass margin around the pad (fills the window)
    const W = padW + 2 * M, H = padH + 2 * M;
    // Drill area marked by cones (FDE: 40 ft x 40 ft), in the middle of the pad
    let area = null;
    if (P && P.area) {
      const a = P.area * STEP_PX, ax = M + (padW - a) / 2, ay = M + (padH - a) / 2;
      area = { x0: ax, y0: ay, x1: ax + a, y1: ay + a };
    }
    this.area = area;
    this.pad = { x0: M, y0: M, x1: M + padW, y1: M + padH };
    this.cameras.main.setBackgroundColor('#2f4a2a');
    this.drawPad(W, H, M, padW, padH, area);

    // The flight: rules in flight-logic.js, drawing in flight-view.js. Starts in column near the bottom of the pad
    const edge = 15;
    const elementSize = P && P.elementSize ? P.elementSize : settings.elementSize;
    const flightLength = (elementSize - 1) * DISTANCE_PX;
    const leadY = M + Math.max(60, Math.min(padH * 0.6, padH - 40 - flightLength));
    const start = area && def.start ? { x: area.x0 + def.start.x * STEP_PX, y: area.y0 + def.start.y * STEP_PX }
                : def.tanks ? { x: M + padW / 2, y: M + padH / 2 + 4 * STEP_PX }       // Tanks: the middle of the arena
                : { x: M + padW / 2, y: leadY };
    this.flight = new FlightLogic({
      bounds: { x0: M + edge, y0: M + edge, x1: M + padW - edge, y1: M + padH - edge },
      start, startDir: def.start ? def.start.dir : 0,
      areaName: 'drill pad',
      onFeedback: showFeedback,
      onStatus: showStatus,
      cadence: settings.cadence,
      elements: P && P.elements ? P.elements : settings.elements,
      elementSize,
      cdrSide: settings.cdrSide,
      coverAfterHalt: !(def.rules && def.rules.coverAfterHalt === false),   // FDE: COVER only has to be given once
      timingOffset: { voice: settings.timingOffsetVoice || 0, typed: settings.timingOffsetTyped || 0 },   // calibration
      gradePrep: settings.gradePrep !== 'off',
      disorder: DISORDER_LEVELS[settings.disorder],
    });
    this.flightView = new FlightView(this, this.flight);
    if (def.calibrate) this.flight.giveCommand('Mark Time, HARCH');   // calibration: the flight marks time in place
    setActiveFlight(this.flight);
    activeScene = this;
    this.events.once('shutdown', () => { setActiveFlight(null); activeCamera = null; activeRun = null; activeScene = null; });

    setHud({ mode: esc(def.mode) + ' · <b>' + esc(def.title) + '</b>',
             attribution: (area ? 'Cones mark the ' + P.area * 2 + ' ft x ' + P.area * 2 + ' ft drill area' : 'Drill pad') +
                          ' · each faint square = 5 steps · North is up · Tiles: Kenney.nl' });
    this.run = startRun(def, this.flight);
    this.run.area = area;
    if (def.tanks) this.startTanks(def);

    // Planning period (evaluations): click the pad to place the flight, ↻ to turn it (Vol 1 p. 58:
    // "arrange the flight anywhere on the pad"). Only until the commander reports in.
    if (def.reportIn) {
      const planning = () => activeRun === this.run && !this.run.reportedIn && this.run.running;
      this.input.on('pointerup', p => {
        if (!planning() || Math.hypot(p.upX - p.downX, p.upY - p.downY) > 6) return;
        const w = this.cameras.main.getWorldPoint(p.x, p.y);
        this.placeFlight(w.x, w.y, this.flight.opts.startDir || 0);
      });
      setPlanningControls(() => { if (planning()) this.placeFlight(null, null, turnDir(this.flight.opts.startDir || 0, 1)); });
    }
    this.metronome = new FootMetronome(this.flight, settings.cadence);

    // Smooth camera: start zoomed so the whole pad fits
    const fitW = area ? (area.x1 - area.x0) * 1.6 : padW, fitH = area ? (area.y1 - area.y0) * 1.6 : padH;
    const fit = Math.min((this.scale.width - 120) / fitW, (this.scale.height - 340) / fitH);   // the pad (or cone square) fits
    this.camera = new CameraController(this, {
      worldW: W, worldH: H, zoom: LINK.zoom || Math.max(0.5, Math.min(2.2, fit)),
      minZoom: 0.3, maxZoom: 4, target: () => this.flightCenter(),
    });
    setActiveCamera(this.camera);

    giveLinkCommands(this, this.flight);   // commands/fast-forward from the page address
  }

  // Tanks (tanks.js): enemy flights hunting your flanks on the pad
  startTanks(def) {
    this.enemyViews = new Map();
    this.tanks = new TanksGame(def.tanks, this.flight, {
      arena: this.pad,
      onSpawn: e => this.enemyViews.set(e, new FlightView(this, e.flight, null, { guidonColor: e.color, label: e.name })),
      onRemove: e => {                              // eliminated: fade out
        const v = this.enemyViews.get(e);
        this.enemyViews.delete(e);
        if (v) this.time.delayedCall(700, () => v.destroy());
      },
      onEvent: ev => {
        if (ev.type === 'eliminated') toast('💥 ' + ev.name + ' flanked! +1', 'good');
        else if (ev.type === 'life-lost') toast('✘ ' + ev.reason + ' (' + ev.lives + ' ' + (ev.lives === 1 ? 'life' : 'lives') + ' left)', 'bad');
        else if (ev.type === 'wave' && ev.wave > 1) toast('Wave ' + ev.wave + ': faster enemies', '');
      },
    });
    this.run.extra = () => this.tanks.results();
  }

  stepOthers(dt) { if (this.tanks) this.tanks.update(dt); }

  // Move / turn the flight during the planning period (it is re-formed at the new spot)
  placeFlight(x, y, dir) {
    const o = this.flight.opts, b = o.bounds;
    if (x !== null) o.start = { x: Math.max(b.x0 + 60, Math.min(b.x1 - 60, x)), y: Math.max(b.y0 + 60, Math.min(b.y1 - 60, y)) };
    o.startDir = dir;
    this.flight.reset();
    this.camera.follow = true; this.camera.onChange(this.camera);
  }

  drawPad(W, H, M, padW, padH, area) {
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
      // Drill area: a thin chalk line between the cones
      if (area) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'; ctx.lineWidth = 4; ctx.setLineDash([24, 18]);
        ctx.strokeRect(area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0);
        ctx.setLineDash([]);
      }
      // Orange cones at the corners (blocky, with a shadow to the south-east)
      const corners = area ? [[area.x0, area.y0], [area.x1, area.y0], [area.x0, area.y1], [area.x1, area.y1]]
                           : [[M, M], [M + padW, M], [M, M + padH], [M + padW, M + padH]];
      corners.forEach(([cx, cy]) => {
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
    if (this.tanks) {
      this.tanks.update(dt);
      this.enemyViews.forEach(v => v.sync(dt));
      if (this.tanks.status !== 'playing' && this.run.running) this.run.end(this.tanks.status);
    }
    this.run.update(dt);
    updateRunHud();
  }
}
