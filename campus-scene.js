// =====================================================================
//  campus-scene.js: the Campus map (Auburn, from map.osm via campus-data.js)
//  True scale: 1 marching step = 20 pixels, same as the drill pad.
//  The flight starts between the Lowder and Horton-Hargrave Business Buildings (or on the
//  drill field; see Settings) and may march
//  anywhere except into buildings.
//
//  Three cameras:
//    main    - the campus and the flight (zoomable, follows the flight)
//    minimap - small overview of the whole campus, top-right
//    ui      - buttons, metronome, text (never zoomed)
// =====================================================================

const CAMPUS_COLORS = {
  ground: 0x7c9a63, grass: 0x6fa055, drillfield: 0x5f9e45, stadium: 0x9a9a92,
  construction: 0xb3a27e, parking: 0x7a7f86,
  road: 0x55595f, footway: 0xd9d0b8, building: 0xa5643f, buildingEdge: 0x5e3622,
};
// Kenney "Roguelike Modern City" tiles (CC0, www.kenney.nl), from kenney-tiles.js.
// Each entry: [column, row, width, height] on the sheet, in tiles (16 x 16 pixels each).
const CAMPUS_TILES = {
  grass: [0, 24, 2, 1], pavement: [2, 24, 2, 1], dirt: [4, 24, 2, 1], asphalt: [11, 19, 1, 1],
  roofs: [[0, 0, 4, 4], [24, 0, 4, 4], [8, 0, 4, 4], [16, 0, 4, 4]],   // red, tan, gray, light gray
  trees: [[31, 13, 1, 1], [32, 13, 1, 1], [33, 13, 1, 1], [34, 13, 1, 1], [35, 13, 1, 1], [36, 13, 1, 1]],
  cars: [[[31, 18, 2, 2], [33, 18, 2, 2]], [[31, 22, 2, 2], [33, 22, 2, 2]], [[31, 26, 2, 2], [33, 26, 2, 2]]],
  bench: [17, 15, 2, 1],
};

class CampusScene extends Phaser.Scene {
  constructor() { super('Campus'); }

  create() {
    const W = CAMPUS.width, H = CAMPUS.height;
    this.worldLayer = this.add.layer();     // campus + flight (main camera and minimap)

    const flat = this.drawCampus();   // flat colors (minimap)
    const tiled = this.drawTiles();   // Kenney tiles (main view)
    this.drawLabels();
    this.buildings = CAMPUS.buildings.map(b => ({ name: b.n || 'a building', pts: b.p, box: boxOf(b.p) }));
    this.buildFeatures();

    // Live mission chosen on the menu (scenarios.js, mode 'Live'), or free march
    const M = CAMPUS.pxPerMeter;
    const def = SCENARIOS[currentScenario] && SCENARIOS[currentScenario].mode === 'Live' ? SCENARIOS[currentScenario] : null;
    this.mission = def;
    activeScene = this;
    this.difficulty = LIVE_DIFFICULTY[settings.liveDifficulty] || LIVE_DIFFICULTY.standard;
    const start = def ? { x: def.start.x * M, y: def.start.y * M, dir: def.start.dir } : campusStart();

    // The flight: rules in flight-logic.js, drawing in flight-view.js (people go in the world layer)
    this.flight = new FlightLogic({
      bounds: { x0: 15, y0: 15, x1: W - 15, y1: H - 15 },
      start,
      startDir: start.dir,
      areaName: 'campus map',
      obstacleAt: (x, y) => this.buildingAt(x, y) || this.npcAt(x, y),
      sidewalkEdge: (x, y, h) => this.sidewalkEdge(x, y, h),
      stairsAt: (x, y) => this.stairsAt(x, y),
      intersections: this.intersections,
      onIntersection: (event, ix) => {              // say clearly when the road guard procedure is needed
        if (!ix.roadGuards || this.flight.roadGuards) return;
        if (event === 'approaching') toast('⚠ Road guard intersection ahead: ' + ix.name + '. Halt at the white HALT line, COVER, then Road Guards, OUT.', 'warn');
      },
      onFeedback: showFeedback,
      onStatus: showStatus,
      cadence: settings.cadence,
      elements: settings.elements,
      elementSize: settings.elementSize,
      cdrSide: settings.cdrSide,
      timingOffset: { voice: settings.timingOffsetVoice || 0, typed: settings.timingOffsetTyped || 0 },   // calibration
      gradePrep: settings.gradePrep !== 'off',
      disorder: DISORDER_LEVELS[settings.disorder],
    });
    this.flightView = new FlightView(this, this.flight, this.worldLayer);
    setActiveFlight(this.flight);
    this.drawRoadGuardZones();
    this.addNpcFlights(def ? this.difficulty.npcFlights : (settings.npcFlights || 0));
    this.addPeople(def ? this.difficulty.people : 1);
    this.events.once('shutdown', () => {
      setActiveFlight(null); activeCamera = null; activeRun = null; activeScene = null;
      this.scale.off('resize', this.placeMinimap, this);
      $('minimapFrame').classList.add('hidden');
    });

    // ---------- Cameras ----------
    const main = this.cameras.main;
    main.setBackgroundColor(CAMPUS_COLORS.ground);
    setHud({ mode: 'Live · <b>' + (def ? esc(def.title) : 'Auburn campus') + '</b> <span style="color:var(--muted);font-weight:400">(' +
                   (def ? this.difficulty.label : 'free march') + ' · true scale · N ↑)</span>',
             attribution: 'Map data © OpenStreetMap contributors · Tiles: Kenney.nl' });   // map license (required)
    if (def) {
      this.run = startRun(def, this.flight);
      this.run.courtesy = this.courtesy || null;
      this.drawMission(def);
      showBriefing(def, this.difficulty);
    }
    this.metronome = new FootMetronome(this.flight, settings.cadence);

    // Minimap (top-right, under the buttons): a second camera showing the whole campus
    this.minimap = this.cameras.add(0, 0, 10, 10).setBackgroundColor(CAMPUS_COLORS.ground);
    this.placeMinimap();
    this.scale.on('resize', this.placeMinimap, this);

    // Things only the minimap shows: a big red dot for the flight and the main view's outline
    this.marker = this.add.circle(0, 0, 320, 0xff3b3b);
    this.viewBox = this.add.graphics();
    main.ignore([this.marker, this.viewBox]);

    // Main view shows the tiles, the minimap keeps the simple flat colors
    if (tiled.length) { main.ignore(flat); this.minimap.ignore(tiled); }
    this.minimap.ignore(this.labels);

    this.camera = new CameraController(this, {
      worldW: W, worldH: H, zoom: LINK.zoom || 1.2, minZoom: 0.12, maxZoom: 2.5, target: () => this.flightCenter(),
    });
    setActiveCamera(this.camera);
    if (LINK.at) {                                   // ?at=x,y (meters): look at a spot (screenshots)
      this.camera.follow = false;
      this.camera.center = { x: LINK.at[0] * CAMPUS.pxPerMeter, y: LINK.at[1] * CAMPUS.pxPerMeter };
      this.camera.update(1, true); this.camera.onChange(this.camera);
      LINK.at = null;
    }

    giveLinkCommands(this, this.flight);   // commands/fast-forward from the page address
    this.updateMinimap();
  }

  // Computer-controlled flights (npc-commander.js) marching the sidewalks with real drill commands
  addNpcFlights(count) {
    this.npcs = [];
    if (!count) return;
    const W = CAMPUS.width, H = CAMPUS.height;
    this.npcNet = PathNetwork.fromCampus(this);
    if (!this.npcNet.liveEdges.length) return;
    const all = () => [this.flight, ...this.npcs.map(n => n.flight)];
    const used = [flightCenter(this.flight)];
    const names = ['B Flight', 'C Flight', 'D Flight', 'E Flight'];
    let seed = LINK.seed;                               // ?seed=N: repeatable starting spots (screenshots)
    const rand = seed ? () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; } : Math.random;
    for (let i = 0; i < count; i++) {
      const f = new FlightLogic({ bounds: { x0: 15, y0: 15, x1: W - 15, y1: H - 15 }, start: { x: 0, y: 0 }, areaName: 'campus map',
        obstacleAt: (x, y) => this.buildingAt(x, y), stairsAt: (x, y) => this.stairsAt(x, y),
        cadence: settings.cadence, elements: 3, elementSize: 4, disorder: 0 });
      f.npcName = names[i];
      const pl = NpcCommander.place(f, this.npcNet, rand, used);
      if (!pl) break;
      used.push(flightCenter(f));
      const npc = new NpcCommander(f, this.npcNet, { name: names[i], others: all, rand });
      npc.start(pl);
      npc.view = new FlightView(this, f, this.worldLayer, { guidonColor: NPC_GUIDON_COLORS[i], label: names[i] });
      npc.dot = this.add.circle(0, 0, 240, NPC_GUIDON_COLORS[i]);   // minimap marker
      this.cameras.main.ignore(npc.dot);
      this.npcs.push(npc);
    }
  }

  // Campus people (civilians, POC, cadre) and the courtesy checks (courtesy.js)
  addPeople(scale) {
    if (settings.campusPeople === 'off') return;
    let seed = LINK.seed ? LINK.seed + 99 : null;
    const rand = seed ? () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; } : Math.random;
    this.walkNet = walkwayNetwork(this);
    this.people = new PeopleSim(this.walkNet, { rand, scale: scale || 1 });
    this.peopleView = new PeopleView(this, this.people, this.worldLayer);
    this.courtesy = new CourtesyMonitor(this.flight, {
      onResult: r => {
        const msg = { correct: '✔ Courtesy: ' + r.who, missed: '✘ Missed greeting: ' + r.who + ' ("' + r.expected + '")',
                      'wrong-words': '✘ ' + r.who + ': ' + r.detail, 'no-salute': '✘ No salute for ' + r.who }[r.outcome];
        toast(msg, r.outcome === 'correct' ? 'good' : 'bad');
      },
    });
    activeCourtesy = this.courtesy;
    this.events.once('shutdown', () => { activeCourtesy = null; });
  }

  // ROAD GUARD intersections (only where the detachment uses them: the concourse through the Village):
  // a hatched yellow zone with "ROAD GUARDS", and a white HALT line across every walkway leading in,
  // where the flight should halt before commanding Road Guards, OUT.
  drawRoadGuardZones() {
    const M = CAMPUS.pxPerMeter, g = this.add.graphics().setDepth(7);
    this.worldLayer.add(g);
    const walks = CAMPUS.roads.filter(r => ['footway', 'path', 'pedestrian', 'cycleway'].includes(r.k));
    const nearWalk = (x, y) => {
      let best = null;
      walks.forEach(r => { for (let i = 0; i + 3 < r.p.length; i += 2) {
        const d = distanceToLine(x, y, [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]]);
        if (d < r.w / 2 && (!best || r.w > best.w)) best = r;
      } });
      return best;
    };
    this.intersections.filter(ix => ix.roadGuards).forEach(ix => {
      // hatched zone
      g.fillStyle(0xffd166, 0.18).fillCircle(ix.x, ix.y, ix.r);
      g.lineStyle(10, 0xffd166, 0.95).strokeCircle(ix.x, ix.y, ix.r);
      g.lineStyle(6, 0x111111, 0.5);
      for (let d = -ix.r + 20; d < ix.r; d += 40) {      // diagonal hatching, kept inside the circle
        const h = Math.sqrt(Math.max(0, ix.r * ix.r - d * d)), cx = ix.x + d * Math.SQRT1_2, cy = ix.y - d * Math.SQRT1_2;
        g.lineBetween(cx - h * Math.SQRT1_2, cy - h * Math.SQRT1_2, cx + h * Math.SQRT1_2, cy + h * Math.SQRT1_2);
      }
      const label = this.add.text(ix.x, ix.y, 'ROAD GUARDS', { fontFamily: 'Inter, sans-serif', fontStyle: '800', fontSize: '34px',
        color: '#ffd166', stroke: '#10161e', strokeThickness: 7 }).setOrigin(0.5).setDepth(8);
      this.worldLayer.add(label);
      // HALT lines on every walkway arm, a few meters before the zone
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, ux = Math.sin(a), uy = -Math.cos(a), dist = ix.r + 5 * M;
        const x = ix.x + ux * dist, y = ix.y + uy * dist, walk = nearWalk(x, y);
        if (!walk) continue;
        const half = walk.w / 2 - 6;
        g.lineStyle(14, 0xffffff, 0.95).lineBetween(x - uy * half, y + ux * half, x + uy * half, y - ux * half);
        const t = this.add.text(x + ux * 30, y + uy * 30, 'HALT', { fontFamily: 'Inter, sans-serif', fontStyle: '800', fontSize: '24px',
          color: '#ffffff', stroke: '#10161e', strokeThickness: 6 }).setOrigin(0.5).setDepth(8);
        this.worldLayer.add(t);
      }
    });
  }

  // Live mission: the planned route (dashed, if the difficulty shows it) and the checkpoints
  drawMission(def) {
    const M = CAMPUS.pxPerMeter, g = this.add.graphics().setDepth(8);
    this.worldLayer.add(g);
    if (def.route && this.difficulty.routeLine) {
      g.lineStyle(10, 0x4fa3ff, 0.55);
      for (let i = 0; i + 1 < def.route.length; i++) {
        const [x1, y1] = def.route[i], [x2, y2] = def.route[i + 1], len = Math.hypot(x2 - x1, y2 - y1) * M;
        for (let d = 0; d < len; d += 60) {
          const t0 = d / len, t1 = Math.min(1, (d + 34) / len);
          g.lineBetween((x1 + (x2 - x1) * t0) * M, (y1 + (y2 - y1) * t0) * M, (x1 + (x2 - x1) * t1) * M, (y1 + (y2 - y1) * t1) * M);
        }
      }
    }
    if (def.area) {
      g.lineStyle(8, 0xffd166, 0.7).strokeRect(def.area.x0 * M, def.area.y0 * M, (def.area.x1 - def.area.x0) * M, (def.area.y1 - def.area.y0) * M);
    }
    this.checkpointMarks = def.objectives.filter(o => o.type === 'checkpoint').map((o, i) => {
      const ring = this.add.circle(o.x * M, o.y * M, o.r * M).setStrokeStyle(8, 0xffd166, 0.9).setFillStyle(0xffd166, 0.08).setDepth(8);
      const num = this.add.text(o.x * M, o.y * M, String(i + 1), { fontFamily: 'Inter, sans-serif', fontStyle: '800', fontSize: '60px',
        color: '#ffd166', stroke: '#10161e', strokeThickness: 8 }).setOrigin(0.5).setDepth(8);
      this.worldLayer.add(ring); this.worldLayer.add(num);
      return { o, ring, num };
    });
  }

  // Move the computer-controlled flights and people (also used by the page-address fast-forward)
  stepOthers(dt) {
    (this.npcs || []).forEach(n => { n.update(dt); n.flight.update(dt); });
    if (this.people) {
      this.people.update(dt, [this.flight, ...(this.npcs || []).map(n => n.flight)]);
      this.courtesy.update(dt, this.people.people);
    }
  }

  // Someone from another flight at (x, y)? (the player's flight stops instead of walking into them)
  npcAt(x, y) {
    for (const n of this.npcs || []) {
      if (n.flight.everyone().some(p => Math.abs(p.x - x) < 14 && Math.abs(p.y - y) < 14)) return n.name;
    }
    return null;
  }

  // Minimap size/position follow the window size; the HTML frame (#minimapFrame) is drawn around it
  placeMinimap() {
    const W = CAMPUS.width, H = CAMPUS.height;
    const mmW = Math.round(Math.max(160, Math.min(260, this.scale.width * 0.18))), mmH = Math.round(mmW * H / W);
    const mmX = this.scale.width - mmW - 14, mmY = 70;
    this.minimap.setViewport(mmX, mmY, mmW, mmH).setZoom(mmW / W);
    this.minimap.centerOn(W / 2, H / 2);
    const f = $('minimapFrame');
    Object.assign(f.style, { left: (mmX - 2) + 'px', top: (mmY - 2) + 'px', width: mmW + 'px', height: mmH + 'px' });
    f.classList.remove('hidden');
  }

  // ---------- Drawing the campus ----------
  // Flat colors: always drawn, shown on the minimap (and on the main view if the tiles fail to load)
  drawCampus() {
    const g = this.add.graphics();
    this.worldLayer.add(g);

    // Grass, stadium, parking lots...
    CAMPUS.areas.forEach(a => {
      g.fillStyle(CAMPUS_COLORS[a.k] || CAMPUS_COLORS.grass, 1);
      g.fillPoints(poly(a.p), true);
      if (a.k === 'drillfield') { g.lineStyle(12, 0xf2f2f2, 0.9); g.strokePoints(poly(a.p), true); }
    });

    // Streets first, then sidewalks/paths on top
    drawRoadShapes(g, r => !isPath(r), CAMPUS_COLORS.road);
    drawRoadShapes(g, isPath, CAMPUS_COLORS.footway);

    // Buildings
    CAMPUS.buildings.forEach(b => {
      g.fillStyle(CAMPUS_COLORS.building, 1);
      g.fillPoints(poly(b.p), true);
      g.lineStyle(8, CAMPUS_COLORS.buildingEdge, 1);
      g.strokePoints(poly(b.p), true);
    });
    return g;
  }

  // Kenney "Roguelike Modern City" tiles (main view only).
  // The textured campus is PAINTED ONCE, when the map opens, into a few big pictures
  // ("chunks"), together with the trees, cars and benches. While playing, the game only
  // shows those finished pictures, which is fast and works in every Chrome drawing mode.
  // One pixel of the art covers ART_PX map units (4 units = about 5 inches).
  // Returns the chunk images (empty if the tile sheet hasn't loaded: flat colors are used).
  drawTiles() {
    if (!(KENNEY_TILES.complete && KENNEY_TILES.naturalWidth > 0)) return [];
    const T = CAMPUS_TILES, M = CAMPUS.pxPerMeter;
    const areas = CAMPUS.areas.map(a => ({ ...a, box: boxOf(a.p) }));
    const roads = CAMPUS.roads.map(r => ({ ...r, box: boxOf(r.p) }));
    const buildings = CAMPUS.buildings.map((b, i) => ({ ...b, i, box: boxOf(b.p), shadow: (b.h || 9) * 0.55 * M }));
    const centerLined = r => ['tertiary', 'tertiary_link', 'unclassified', 'residential'].includes(r.k);

    return PAINT.chunks(this, this.worldLayer, CAMPUS.width, CAMPUS.height, 'campus', (ctx, x0, y0, x1, y1) => {
      const touches = (box, pad) => PAINT.touches(box, x0, y0, x1, y1, pad);

      // Ground: lawn everywhere, then stadium, construction, parking lots, drill field
      ctx.fillStyle = PAINT.pattern(ctx, T.grass);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      areas.forEach(a => {
        if (!touches(a.box, 0)) return;
        const tile = { stadium: T.pavement, construction: T.dirt, parking: T.asphalt }[a.k];
        PAINT.tracePoly(ctx, a.p);
        if (tile) { ctx.fillStyle = PAINT.pattern(ctx, tile); ctx.fill(); }
        if (a.k === 'drillfield') {
          ctx.fillStyle = 'rgba(20, 60, 10, 0.15)'; ctx.fill();               // slightly darker grass
          ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(242, 242, 242, 0.9)'; ctx.stroke();
        }
      });

      // Streets (asphalt), then sidewalks and paths (pavement) on top
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      [[r => !isPath(r), T.asphalt], [isPath, T.pavement]].forEach(([filter, tile]) => {
        ctx.strokeStyle = PAINT.pattern(ctx, tile);
        roads.filter(filter).forEach(r => {
          if (!touches(r.box, r.w)) return;
          ctx.lineWidth = r.w;
          PAINT.traceLine(ctx, r.p);
          ctx.stroke();
        });
      });
      // Road markings: dashed yellow center line on streets
      ctx.save();
      ctx.setLineDash([3 * M, 3 * M]); ctx.lineCap = 'butt';
      ctx.lineWidth = 0.15 * M; ctx.strokeStyle = 'rgba(240, 196, 64, 0.85)';
      roads.filter(centerLined).forEach(r => { if (touches(r.box, r.w)) { PAINT.traceLine(ctx, r.p); ctx.stroke(); } });
      ctx.restore();

      // Building shadows (longer for taller buildings), then a soft dark rim at the walls
      buildings.forEach(b => { if (touches(b.box, b.shadow + 10)) PAINT.buildingShadow(ctx, b.p, b.shadow); });
      buildings.forEach(b => { if (touches(b.box, 40)) PAINT.baseShade(ctx, b.p, 1.5 * M); });

      // Buildings: roofs (four colors spread around), dark walls, a light edge where the sun hits
      buildings.forEach(b => {
        if (!touches(b.box, 10)) return;
        PAINT.tracePoly(ctx, b.p);
        ctx.fillStyle = PAINT.pattern(ctx, T.roofs[b.i % T.roofs.length]);
        ctx.fill();
        ctx.lineWidth = 10; ctx.strokeStyle = '#5e3622'; ctx.stroke();
        ctx.save(); ctx.translate(-4, -4); PAINT.tracePoly(ctx, b.p);
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255, 240, 210, 0.35)'; ctx.stroke(); ctx.restore();
      });

      // Crosswalks, stairs, bike racks, fences, walls, bollards, traffic lights
      drawCampusFeatures(ctx, x0, y0, x1, y1, (box, a0, b0, a1, b1, pad) => PAINT.touches(box, a0, b0, a1, b1, pad));

      // Decorations. Trees are solid (the flight can't march through the trunk); cars and
      // benches are looks only. Positions come from campus-data.js.
      CAMPUS.decor.forEach(d => {
        if (d.x < x0 - 200 || d.x > x1 + 200 || d.y < y0 - 200 || d.y > y1 + 200) return;
        if (d.k === 'tree') {
          const size = 150 + (d.v % 3) * 25;             // about 4.5 to 6 m across
          ctx.fillStyle = 'rgba(10, 20, 30, 0.28)';      // soft shadow to the south-east
          ctx.beginPath();
          ctx.ellipse(d.x + size * 0.28, d.y + size * 0.38, size * 0.42, size * 0.24, 0.5, 0, Math.PI * 2);
          ctx.fill();
          PAINT.sprite(ctx, T.trees[d.v], d.x, d.y, size, size);
        } else if (d.k === 'car') {
          ctx.fillStyle = 'rgba(10, 20, 30, 0.25)';
          ctx.fillRect(d.x - 45, d.y - 60, 110, 140);
          PAINT.sprite(ctx, T.cars[d.v][d.f ? 1 : 0], d.x, d.y, 150, 150);   // front or back view
        } else if (d.k === 'bench') {
          PAINT.sprite(ctx, T.bench, d.x, d.y, 64, 32, d.a);
        }
      });
    });
  }

  // Building and drill field names (both views)
  drawLabels() {
    this.labels = CAMPUS.labels.map(l => {
      const t = this.add.text(l.x, l.y, l.t, {
        fontSize: '60px', fontFamily: 'Inter, sans-serif', fontStyle: '800', color: '#ffffff',
        stroke: '#10161e', strokeThickness: 10, align: 'center', wordWrap: { width: 1400 },
      }).setOrigin(0.5).setShadow(6, 8, 'rgba(0,0,0,0.45)', 6, true, true);
      this.worldLayer.add(t);
      return t;
    });
  }

  // GUIDE RIGHT (troop walk): how far (units, + = to the right) the guide at (x, y) must slide so
  // it is just inside the RIGHT edge of the sidewalk it is on, marching in direction h.
  // null if it isn't on a sidewalk that runs (roughly) the way the flight is marching.
  sidewalkEdge(x, y, h) {
    const f = DIRS[h], r = DIRS[turnDir(h, 1)];
    let best = null;
    CAMPUS.roads.forEach(road => {
      if (!isPath(road)) return;
      const p = road.p, half = road.w / 2;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1], len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const ux = dx / len, uy = dy / len;
        if (Math.abs(ux * f.x + uy * f.y) < 0.9) continue;          // must run the way we're marching
        const t = Math.max(0, Math.min(len, (x - p[i]) * ux + (y - p[i + 1]) * uy));
        const cx = p[i] + ux * t, cy = p[i + 1] + uy * t;
        const dist = Math.hypot(x - cx, y - cy);
        if (dist > half + 15) continue;                              // not on this sidewalk
        if (!best || dist < best.dist) best = { dist, off: (x - cx) * r.x + (y - cy) * r.y, half };
      }
    });
    if (!best) return null;
    const margin = 10;                                               // keep the guide's shoulder inside the edge
    return (best.half - margin) - best.off;
  }

  // Things the flight can't march through (besides buildings), stairs, and intersections,
  // from the map data (campus-data.js) and the hand-traced features (maps/campus-features.js).
  buildFeatures() {
    const M = CAMPUS.pxPerMeter;
    const lineBox = (flat, pad) => { const b = boxOf(flat); return { x0: b.x0 - pad, x1: b.x1 + pad, y0: b.y0 - pad, y1: b.y1 + pad }; };
    // Solid things: trees (trunk), bike racks, fences, walls
    this.solids = [];
    CAMPUS.decor.filter(d => d.k === 'tree').forEach(d => {
      const r = 0.4 * M;
      this.solids.push({ name: 'a tree', circle: { x: d.x, y: d.y, r }, box: { x0: d.x - r, x1: d.x + r, y0: d.y - r, y1: d.y + r } });
    });
    CAMPUS.barriers.forEach(b => {
      if (b.p) this.solids.push({ name: 'a bike rack', poly: b.p, box: boxOf(b.p) });
      else if (b.line) this.solids.push({ name: 'a ' + b.k, line: b.line, half: 0.3 * M, box: lineBox(b.line, 0.3 * M) });
      else this.solids.push({ name: 'a bike rack', circle: { x: b.x, y: b.y, r: b.r }, box: { x0: b.x - b.r, x1: b.x + b.r, y0: b.y - b.r, y1: b.y + b.r } });
    });
    // Stairs (must be taken at route step)
    this.stairs = CAMPUS.stairs.map(st => ({ name: st.n, line: st.line, w: st.w, treads: st.treads }))
      .concat(CAMPUS_FEATURES.stairs.map(st => ({ name: st.name, line: st.line.flat().map(v => v * M), w: st.width * M, treads: st.treads })));
    this.stairs.forEach(st => { st.box = lineBox(st.line, st.w / 2); });
    // Intersections (road guards, later)
    this.intersections = CAMPUS_FEATURES.intersections.map(i => ({ name: i.name, x: i.x * M, y: i.y * M, r: i.radius * M,
                                                                  roadGuards: i.roadGuards !== false }));
  }

  // Name of the building (or tree, bike rack, fence, wall) at (x, y), or null
  buildingAt(x, y) {
    for (const b of this.buildings) {
      if (x < b.box.x0 || x > b.box.x1 || y < b.box.y0 || y > b.box.y1) continue;
      if (pointInPolygon(x, y, b.pts)) return b.name;
    }
    for (const o of this.solids || []) {
      if (x < o.box.x0 || x > o.box.x1 || y < o.box.y0 || y > o.box.y1) continue;
      if (o.circle && Math.hypot(x - o.circle.x, y - o.circle.y) < o.circle.r) return o.name;
      if (o.poly && pointInPolygon(x, y, o.poly)) return o.name;
      if (o.line && distanceToLine(x, y, o.line) < o.half) return o.name;
    }
    return null;
  }

  // Name of the stairs at (x, y), or null
  stairsAt(x, y) {
    for (const st of this.stairs) {
      if (x < st.box.x0 || x > st.box.x1 || y < st.box.y0 || y > st.box.y1) continue;
      if (distanceToLine(x, y, st.line) <= st.w / 2) return st.name;
    }
    return null;
  }

  flightCenter() {
    const m = this.flight.marchers();
    return { x: m.reduce((s, p) => s + p.x, 0) / m.length, y: m.reduce((s, p) => s + p.y, 0) / m.length };
  }

  // Minimap: red dot on the flight, white box around what the main view shows
  updateMinimap() {
    const c = this.flightCenter();
    this.marker.setPosition(c.x, c.y);
    const v = this.cameras.main.worldView;
    this.viewBox.clear().lineStyle(150, 0xffffff, 1).strokeRect(v.x, v.y, v.width, v.height);
  }

  update(time, deltaMs) {
    const dt = deltaMs / 1000;
    this.flight.update(dt);
    this.flightView.sync(dt);
    this.stepOthers(dt);
    if (this.people) {
      const prompts = !this.mission || this.difficulty.prompts;
      this.peopleView.sync(this.flight.commander, prompts ? new Set([...this.courtesy.open.keys()]) : null);
      if (!this.run) updateCourtesyHud(this.courtesy);
    }
    if (this.run) {
      this.run.update(dt);
      (this.checkpointMarks || []).forEach(m => {     // done = green, next = gold, later = faint (hidden on Hard)
        const next = this.run.nextCheckpoint(), isNext = next && next.o === m.o;
        const color = m.o.done ? 0x6be38a : 0xffd166;
        m.ring.setStrokeStyle(8, color, m.o.done || isNext ? 0.95 : 0.35);
        m.num.setColor(m.o.done ? '#6be38a' : '#ffd166').setAlpha(m.o.done || isNext ? 1 : 0.4);
        const show = m.o.done || isNext || this.difficulty.routeLine;
        m.ring.setVisible(show); m.num.setVisible(show);
      });
      updateRunHud();
    }
    (this.npcs || []).forEach(n => {
      n.view.sync(dt);
      const c = flightCenter(n.flight); n.dot.setPosition(c.x, c.y);
    });
    this.metronome.update(dt);
    this.camera.update(dt);
    this.updateMinimap();
  }
}

// Where the flight starts: the page address (?start=...) if it names a real start spot,
// otherwise the Settings choice
function campusStart() {
  return CAMPUS.starts[LINK.start] || CAMPUS.starts[settings.campusStart] || CAMPUS.starts.lowder;
}

// ---------- Drawing helpers ----------
// Flat list (x1, y1, x2, y2, ...) -> list of points
function poly(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
  return pts;
}

function isPath(r) { return ['footway', 'path', 'steps', 'cycleway', 'pedestrian'].includes(r.k); }

// Streets or paths as thick lines, with round joints (circles)
function drawRoadShapes(g, filter, color) {
  CAMPUS.roads.filter(filter).forEach(r => {
    const pts = poly(r.p);
    g.lineStyle(r.w, color, 1);
    g.strokePoints(pts, false);
    g.fillStyle(color, 1);
    pts.forEach(p => g.fillCircle(p.x, p.y, r.w / 2));
  });
}

// ---------- Campus features (painted into the map chunks, in map units) ----------
function drawCampusFeatures(ctx, x0, y0, x1, y1, touches) {
  const M = CAMPUS.pxPerMeter;
  const near = (flat, pad) => touches(boxOf(flat), x0, y0, x1, y1, pad);
  // Walk along a line, calling fn(x, y, ux, uy) every `gap` units (ux, uy = direction of the line)
  const along = (flat, gap, fn) => {
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const ax = flat[i], ay = flat[i + 1], dx = flat[i + 2] - ax, dy = flat[i + 3] - ay, L = Math.hypot(dx, dy);
      if (L < 1) continue;
      for (let t = gap / 2; t < L; t += gap) fn(ax + dx * t / L, ay + dy * t / L, dx / L, dy / L);
    }
  };
  const offsetLine = (flat, off) => {   // the same line moved sideways by `off`
    const out = [];
    for (let i = 0; i < flat.length; i += 2) {
      const j = Math.min(i, flat.length - 4), dx = flat[j + 2] - flat[j], dy = flat[j + 3] - flat[j + 1], L = Math.hypot(dx, dy) || 1;
      out.push(flat[i] - dy / L * off, flat[i + 1] + dx / L * off);
    }
    return out;
  };
  const stroke = (flat, width, color) => {
    ctx.beginPath(); ctx.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
  };

  // Crosswalks ("ladder" markings): white bars across the walkway, parallel to the traffic,
  // every meter, between two edge lines along the sides
  CAMPUS.roads.filter(r => r.x).forEach(r => {
    if (!near(r.p, r.w)) return;
    const half = 1.5 * M;
    ctx.lineCap = 'butt';
    along(r.p, 1.0 * M, (x, y, ux, uy) => {
      ctx.beginPath(); ctx.moveTo(x - uy * half, y + ux * half); ctx.lineTo(x + uy * half, y - ux * half);
      ctx.lineWidth = 0.5 * M; ctx.strokeStyle = 'rgba(245, 245, 245, 0.92)'; ctx.stroke();
    });
    stroke(offsetLine(r.p, -half), 0.15 * M, 'rgba(245, 245, 245, 0.92)');
    stroke(offsetLine(r.p, half), 0.15 * M, 'rgba(245, 245, 245, 0.92)');
    ctx.lineCap = 'round';
  });

  // Stairs: concrete with a dark line at every step (about 35 cm deep)
  const allStairs = CAMPUS.stairs.map(st => ({ line: st.line, w: st.w, treads: st.treads }))
    .concat(CAMPUS_FEATURES.stairs.map(st => ({ line: st.line.flat().map(v => v * M), w: st.width * M, treads: st.treads })));
  allStairs.forEach(st => {
    if (!near(st.line, st.w)) return;
    ctx.lineCap = 'butt';
    stroke(st.line, st.w, '#cfc7b4');
    const tread = 0.35 * M;
    if (st.treads === 'across') {           // you walk along the line: steps cross it
      along(st.line, tread, (x, y, ux, uy) => {
        ctx.beginPath(); ctx.moveTo(x - uy * st.w / 2, y + ux * st.w / 2); ctx.lineTo(x + uy * st.w / 2, y - ux * st.w / 2);
        ctx.lineWidth = 3; ctx.strokeStyle = '#8a8273'; ctx.stroke();
      });
    } else {                                 // you walk across the line: steps follow it (curved stairs)
      for (let off = -st.w / 2 + tread / 2; off < st.w / 2; off += tread) stroke(offsetLine(st.line, off), 3, '#8a8273');
    }
    stroke(offsetLine(st.line, -st.w / 2), 4, '#6f6758');
    stroke(offsetLine(st.line, st.w / 2), 4, '#6f6758');
    ctx.lineCap = 'round';
  });

  // Bike racks: dark stands with a few bikes
  const bike = (x, y, a) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.strokeStyle = '#1d2a3a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(-0.5 * M, 0, 0.32 * M, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0.5 * M, 0, 0.32 * M, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-0.5 * M, 0); ctx.lineTo(0, -0.1 * M); ctx.lineTo(0.5 * M, 0); ctx.stroke();
    ctx.restore();
  };
  CAMPUS.barriers.forEach(b => {
    if (b.p) {
      if (!near(b.p, 0)) return;
      tracePolygon(ctx, b.p); ctx.fillStyle = 'rgba(70, 76, 84, 0.55)'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#3a3f45'; ctx.stroke();
      const bb = boxOf(b.p);
      for (let x = bb.x0 + 0.8 * M; x < bb.x1 - 0.5 * M; x += 1.2 * M) bike(x, (bb.y0 + bb.y1) / 2, Math.PI / 2);
    } else if (b.line) {
      if (!near(b.line, 20)) return;
      if (b.k === 'wall') { stroke(b.line, 0.45 * M, '#9c8f7d'); stroke(b.line, 0.15 * M, '#7d715f'); }
      else {
        stroke(b.line, 0.12 * M, '#7f8a8f');                 // fence rail with posts
        along(b.line, 2.5 * M, (x, y) => { ctx.fillStyle = '#5c666b'; ctx.fillRect(x - 5, y - 5, 10, 10); });
      }
    } else {
      if (b.x < x0 - 100 || b.x > x1 + 100 || b.y < y0 - 100 || b.y > y1 + 100) return;
      ctx.fillStyle = 'rgba(70, 76, 84, 0.55)'; ctx.fillRect(b.x - b.r, b.y - b.r * 0.6, b.r * 2, b.r * 1.2);
      bike(b.x - 0.6 * M, b.y, Math.PI / 2); bike(b.x + 0.6 * M, b.y, Math.PI / 2);
    }
  });

  // Bollards: short posts (people walk between them)
  CAMPUS.bollards.forEach(b => {
    if (!near(b.line, 20)) return;
    along(b.line, 1.5 * M, (x, y) => { ctx.fillStyle = '#3b3b3b'; ctx.beginPath(); ctx.arc(x, y, 0.13 * M, 0, Math.PI * 2); ctx.fill(); });
  });

  // Traffic lights
  CAMPUS.signals.forEach(sg => {
    if (sg.x < x0 - 100 || sg.x > x1 + 100 || sg.y < y0 - 100 || sg.y > y1 + 100) return;
    ctx.fillStyle = '#222'; ctx.fillRect(sg.x - 0.4 * M, sg.y - 0.2 * M, 0.8 * M, 0.4 * M);
    ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(sg.x - 0.2 * M, sg.y, 0.12 * M, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2ecc71'; ctx.beginPath(); ctx.arc(sg.x + 0.2 * M, sg.y, 0.12 * M, 0, Math.PI * 2); ctx.fill();
  });
}

function tracePolygon(ctx, flat) {
  ctx.beginPath(); ctx.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
  ctx.closePath();
}

// ---------- Small geometry helpers ----------
function boxOf(flat) {
  const xs = flat.filter((_, i) => i % 2 === 0), ys = flat.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

// Shortest distance from (x, y) to a line made of points (flat list: x1, y1, x2, y2, ...)
function distanceToLine(x, y, flat) {
  let best = Infinity;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const ax = flat[i], ay = flat[i + 1], dx = flat[i + 2] - ax, dy = flat[i + 3] - ay;
    const L = dx * dx + dy * dy;
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

// Is (x, y) inside the polygon? (flat list: x1, y1, x2, y2, ...)
function pointInPolygon(x, y, flat) {
  let inside = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const xi = flat[i], yi = flat[i + 1], xj = flat[j], yj = flat[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
