// =====================================================================
//  npc-commander.js: COMPUTER-CONTROLLED FLIGHTS (logic only, no Phaser).
//
//  PathNetwork: where flights may march, as a graph of straight segments
//    PathNetwork.fromCampus(campusScene)  sidewalks that a flight can drill along (lined up within a
//                                         few degrees of the 8 marching directions, nothing solid on them)
//    PathNetwork.grid(bounds, spacing)    a grid of lanes on a drill pad
//    net.route(fromNode, facing, toNode)  shortest route a flight can actually march (no turn sharper than 90)
//
//  NpcCommander: an AI flight commander. It drives its own FlightLogic ONLY with valid drill commands,
//  each given on the correct heel strike: Forward, column movements at corners (timed so the flight
//  lands on the next sidewalk), inclines to stay centered, Counter March to turn around, Mark Time to
//  wait for traffic, Forward to go on. Flights in front (other NPCs or the player) are waited for.
//    const npc = new NpcCommander(flight, network, { name: 'B Flight', others: () => [otherFlight, ...] });
//    npc.update(dt)    // every frame, BEFORE flight.update(dt)
//  Phase 9 (Tanks) adds chase / evade targets through npc.goal.
// =====================================================================

// Turn delta from facing a to facing b in 45-degree units (-3..4; + = to the right)
function dirDelta(a, b) { return ((b - a + 12) % 8) - 4; }
// Nearest of the 8 marching directions for a vector
function dirOf(dx, dy) { return ((Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) % 8) + 8) % 8; }
const NPC_GUIDON_COLORS = [0x2f6fd6, 0xf2b705, 0x2bb673, 0x9b59b6, 0xe67e22, 0x1abc9c];

class PathNetwork {
  constructor() { this.nodes = []; this.edges = []; this.keyed = new Map(); }

  node(x, y) {
    const k = Math.round(x / 8) + ',' + Math.round(y / 8);   // points within ~8 units are the same node
    if (this.keyed.has(k)) return this.keyed.get(k);
    const id = this.nodes.length;
    this.nodes.push({ id, x, y, edges: [] });
    this.keyed.set(k, id);
    return id;
  }

  addSegment(x1, y1, x2, y2, w) {
    const a = this.node(x1, y1), b = this.node(x2, y2);
    if (a === b) return null;
    const A = this.nodes[a], B = this.nodes[b];
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const e = { id: this.edges.length, a, b, w, len };
    this.edges.push(e);
    A.edges.push(e); B.edges.push(e);
    return e;
  }

  other(e, n) { return e.a === n ? e.b : e.a; }
  dirFrom(e, n) { const A = this.nodes[n], B = this.nodes[this.other(e, n)]; return dirOf(B.x - A.x, B.y - A.y); }

  // Keep only the biggest connected piece (so every node can reach every other)
  keepLargestComponent() {
    const seen = new Array(this.nodes.length).fill(-1);
    let best = -1, bestSize = 0;
    for (let s = 0; s < this.nodes.length; s++) {
      if (seen[s] >= 0 || !this.nodes[s].edges.length) continue;
      const stack = [s]; seen[s] = s; let size = 0;
      while (stack.length) {
        const n = stack.pop(); size++;
        this.nodes[n].edges.forEach(e => { const o = this.other(e, n); if (seen[o] < 0) { seen[o] = s; stack.push(o); } });
      }
      if (size > bestSize) { bestSize = size; best = s; }
    }
    this.nodes.forEach(n => { n.alive = seen[n.id] === best; });
    // Trim dead-end spurs (e.g. a sidewalk that ends at a building door): repeatedly drop nodes with
    // only one live connection, so every remaining sidewalk leads somewhere
    let trimmed = true;
    while (trimmed) {
      trimmed = false;
      this.nodes.forEach(n => {
        if (!n.alive) return;
        if (n.edges.filter(e => this.nodes[this.other(e, n.id)].alive).length < 2) { n.alive = false; trimmed = true; }
      });
    }
    this.live = this.nodes.filter(n => n.alive);
    this.liveEdges = this.edges.filter(e => this.nodes[e.a].alive && this.nodes[e.b].alive);
    return this;
  }

  // Shortest marchable route from node `from`, arriving facing `facing`, to node `to`.
  // State = (node, facing, just turned onto a short piece); a flight can't turn more than 90 degrees
  // at a corner, and needs ~12 m between two corners (a column movement takes ~8 m to finish).
  // Returns a list of { from, to, edge } steps, or null.
  route(from, facing, to, avoidEdge) {
    if (from === null || from === undefined || to === null || to === undefined) return null;
    const MIN_LEG = this.minLeg || 390;
    const key = (n, d, j) => (n * 8 + d) * 2 + (j ? 1 : 0);
    const dist = new Map(), prev = new Map(), open = [];
    const T = this.nodes[to];
    const h = n => Math.hypot(this.nodes[n].x - T.x, this.nodes[n].y - T.y);
    dist.set(key(from, facing, false), 0);
    open.push({ n: from, d: facing, j: false, g: 0, f: h(from) });
    let found = null, guard = 0;
    while (open.length && guard++ < 200000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (cur.g > dist.get(key(cur.n, cur.d, cur.j))) continue;
      if (cur.n === to && cur.n !== from) { found = cur; break; }
      for (const e of this.nodes[cur.n].edges) {
        if (e === avoidEdge || !this.nodes[e.a].alive || !this.nodes[e.b].alive) continue;
        const o = this.other(e, cur.n), nd = this.dirFrom(e, cur.n);
        const turn = Math.abs(dirDelta(cur.d, nd));
        if (turn > 2) continue;                                  // no U-turns / 135-degree corners
        if (turn && cur.n !== from && !this.roomToTurn(cur.n)) continue;   // the files swing wide in a column movement
        if (turn && cur.j) continue;                              // two corners too close together
        const j = turn ? e.len < MIN_LEG : false;
        const g = cur.g + e.len + (turn ? 200 : 0);               // corners cost ~6 m (fewer turns = calmer drill)
        const k = key(o, nd, j);
        if (dist.has(k) && dist.get(k) <= g) continue;
        dist.set(k, g); prev.set(k, { n: cur.n, d: cur.d, j: cur.j, e });
        open.push({ n: o, d: nd, j, g, f: g + h(o) });
      }
    }
    if (!found) return null;
    const steps = [];
    let k = key(found.n, found.d, found.j), n = found.n;
    while (prev.has(k)) {
      const p = prev.get(k);
      steps.unshift({ from: p.n, to: n, edge: p.e });
      n = p.n; k = key(p.n, p.d, p.j);
    }
    return steps;
  }

  // Room for a Counter March around a spot (nothing solid within ~6 m)
  roomAt(x, y) {
    if (!this.blocked) return true;
    for (let r = 60; r <= 200; r += 70) {
      for (let a = 0; a < 16; a++) if (this.blocked(x + Math.cos(a * Math.PI / 8) * r, y + Math.sin(a * Math.PI / 8) * r)) return false;
    }
    return true;
  }

  // Is there room around node n for a column movement (nothing solid within ~5 m)?
  roomToTurn(n) {
    const N = this.nodes[n];
    if (N.room === undefined) {
      N.room = true;
      if (this.blocked) {
        for (let r = 60; r <= 170 && N.room; r += 55) {
          for (let a = 0; a < 16; a++) {
            if (this.blocked(N.x + Math.cos(a * Math.PI / 8) * r, N.y + Math.sin(a * Math.PI / 8) * r)) { N.room = false; break; }
          }
        }
      }
    }
    return N.room;
  }

  // Shortest distance from (x, y) to any live segment, and that segment's width
  nearest(x, y) {
    let best = Infinity, w = 0;
    for (const e of this.liveEdges || this.edges) {
      const A = this.nodes[e.a], B = this.nodes[e.b];
      const d = distanceToLine(x, y, [A.x, A.y, B.x, B.y]);
      if (d < best) { best = d; w = e.w; }
    }
    return { d: best, w };
  }

  // Campus: footways/paths a flight can drill along. A segment is kept when it runs within
  // `maxDeg` degrees of one of the 8 marching directions (or is very short), and a flight-wide
  // strip along it is clear of buildings, trees, bike racks, walls and stairs.
  static fromCampus(scene, opts) {
    const o = Object.assign({ maxDeg: 4, shortUnits: 130, halfWidth: 60, edgeMargin: 500 }, opts || {});
    const net = new PathNetwork();
    const isWalk = r => ['footway', 'path', 'pedestrian', 'cycleway'].includes(r.k);
    const blocked = (x, y) => scene.buildingAt(x, y) || (scene.stairsAt && scene.stairsAt(x, y));
    net.blocked = blocked;
    const inside = (x, y) => x > o.edgeMargin && y > o.edgeMargin && x < CAMPUS.width - o.edgeMargin && y < CAMPUS.height - o.edgeMargin;
    CAMPUS.roads.filter(isWalk).forEach(r => {
      const p = r.p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x1 = p[i], y1 = p[i + 1], x2 = p[i + 2], y2 = p[i + 3];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 1 || !inside(x1, y1) || !inside(x2, y2)) continue;   // not right at the map's edge
        const ang = Math.atan2(x2 - x1, -(y2 - y1)) * 180 / Math.PI;
        const off = Math.abs(ang - Math.round(ang / 45) * 45);
        if (off > o.maxDeg && len > o.shortUnits) continue;
        const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        let clear = true;
        for (let s = 0; s <= len && clear; s += 30) {
          for (const side of [-o.halfWidth, 0, o.halfWidth]) {
            if (blocked(x1 + ux * s - uy * side, y1 + uy * s + ux * side)) { clear = false; break; }
          }
        }
        if (clear) net.addSegment(x1, y1, x2, y2, r.w);
      }
    });
    return net.keepLargestComponent();
  }

  // Drill pad: lanes every `spacing` units inside `bounds` (straight, diagonal-free)
  static grid(bounds, spacing) {
    const net = new PathNetwork();
    net.minLeg = Math.min(390, spacing * 1.9);
    const xs = [], ys = [];
    for (let x = bounds.x0; x <= bounds.x1 + 0.1; x += spacing) xs.push(x);
    for (let y = bounds.y0; y <= bounds.y1 + 0.1; y += spacing) ys.push(y);
    ys.forEach(y => xs.forEach((x, i) => { if (i) net.addSegment(xs[i - 1], y, x, y, spacing); }));
    xs.forEach(x => ys.forEach((y, i) => { if (i) net.addSegment(x, ys[i - 1], x, y, spacing); }));
    return net.keepLargestComponent();
  }
}

// ---------- Turn calibration ----------
// Where each turn puts the flight's center line, measured once per flight size by marching a scratch
// flight: `lat` = sideways offset of the new center line from the flight's center when the command
// was given (measured across the NEW facing; + = to its right).
const NPC_TURNS = {
  'Column Right, HARCH': 2, 'Column Left, HARCH': -2, 'Column Half Right, HARCH': 1, 'Column Half Left, HARCH': -1,
  'Incline to the Right': 1, 'Incline to the Left': -1,   // (route step only: calibrated at route step)
};
const NPC_CALIBRATION = {};

function flightCenter(f) {
  const m = f.members();
  return { x: m.reduce((s, p) => s + p.x, 0) / m.length, y: m.reduce((s, p) => s + p.y, 0) / m.length };
}

function calibrateTurns(elements, elementSize) {
  const id = elements + 'x' + elementSize;
  if (NPC_CALIBRATION[id]) return NPC_CALIBRATION[id];
  const table = {};
  Object.keys(NPC_TURNS).forEach(text => {
    const f = new FlightLogic({ bounds: { x0: 0, y0: 0, x1: 99999, y1: 99999 }, start: { x: 50000, y: 50000 },
                                cadence: 120, elements, elementSize, disorder: 0 });
    const step = () => f.update(1 / 120);
    const strike = foot => {                       // run to the next heel strike of `foot`
      const prog = () => f.footInfo().progress;
      let last = Math.floor(prog()), guard = 0;
      while (guard++ < 2000) {
        step();
        const n = Math.floor(prog());
        if (n !== last) { last = n; if (foot === 'either' || (foot === 'left') === (n % 2 === 1)) return; }
      }
    };
    f.giveCommand('Forward, HARCH');
    while (f.realSteps() < 6) step();
    const cmd = COMMANDS_BY_KEY[cleanUpCommand(text)];
    if (cmd.routeStepOnly) { f.giveCommand('Route Step, HARCH'); const u = f.realSteps() + 3; while (f.realSteps() < u) step(); }
    if (cmd.foot && !f.routeStep) strike(cmd.foot);
    const c0 = flightCenter(f);
    f.giveCommand(text);
    let guard = 0;
    while ((f.pending || f.columnMovementInProgress()) && guard++ < 20000) step();
    if (f.halfStep) { strike('left'); f.giveCommand('Forward, HARCH'); }
    const until = f.realSteps() + 8;
    while (f.realSteps() < until) step();
    const c1 = flightCenter(f), nd = turnDir(0, NPC_TURNS[text] / 2), r = dirVec(turnDir(nd, 1));
    table[text] = (c1.x - c0.x) * r.x + (c1.y - c0.y) * r.y;
  });
  NPC_CALIBRATION[id] = table;
  return table;
}

// ---------- The AI flight commander ----------
class NpcCommander {
  constructor(flight, network, opts) {
    this.flight = flight;
    this.net = network;
    this.opts = Object.assign({ name: 'B Flight', others: () => [], rand: Math.random, lookAheadPx: 400 }, opts || {});
    this.name = this.opts.name;
    this.rand = this.opts.rand;
    this.turns = calibrateTurns(flight.numElements, flight.elementSize);
    this.legs = [];                 // [{ dir, x1, y1, x2, y2, endNode, edge }]
    this.lastStrike = null;         // floor of the cadence position at the last heel strike seen
    this.waitTime = 0;
    this.stats = { commands: 0, refused: 0, distance: 0, reroutes: 0 };
    this.goal = null;               // optional { x, y } to head for (Phase 9); else random roaming
    this.lastPos = flightCenter(flight);
    flight.npc = this;
  }

  // The sidewalk pieces this flight is on or about to march (current leg + next), with direction
  claims() {
    const out = [];
    this.legs.slice(0, 2).forEach(l => (l.edges || []).forEach(id => out.push({ id, dir: l.dir })));
    return out;
  }

  // Another flight has claimed part of leg N in the OPPOSITE direction (we'd meet head-on): that flight
  claimConflict(N) {
    const mine = new Set(N.edges || []);
    for (const other of this.opts.others()) {
      if (other === this.flight || !other.npc) continue;
      if (other.npc.claims().some(c => mine.has(c.id) && Math.abs(dirDelta(c.dir, N.dir)) >= 3)) {
        // both waiting on each other: the higher-priority flight goes first
        if (other.npc.waitingFor === this.flight && this.name < other.npc.name) continue;
        return other;
      }
    }
    return null;
  }

  // Put the flight on a random segment of the network, facing along it, centered on it
  static place(flight, net, rand, avoid, minDist) {
    for (let tries = 0; tries < 200; tries++) {
      const e = net.liveEdges[Math.floor(rand() * net.liveEdges.length)];
      if (e.len < Math.min(260, (net.minLeg || 390) * 0.5)) continue;
      const fromN = rand() < 0.5 ? e.a : e.b, A = net.nodes[fromN], B = net.nodes[net.other(e, fromN)];
      const t = 0.55, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
      if (avoid && avoid.some(p => Math.hypot(p.x - x, p.y - y) < (minDist || 600))) continue;
      const dir = dirOf(B.x - A.x, B.y - A.y);
      flight.opts.start = { x, y }; flight.opts.startDir = dir;
      flight.reset();
      const c = flightCenter(flight);        // shift so the flight's center (not its front) is on the line
      flight.opts.start = { x: x + (x - c.x), y: y + (y - c.y) };
      flight.reset();
      return { edge: e, from: fromN, to: net.other(e, fromN), dir };
    }
    return null;
  }

  // Start roaming from a placement (see place())
  start(placement) {
    const A = this.net.nodes[placement.from], B = this.net.nodes[placement.to];
    this.legs = [{ dir: placement.dir, x1: A.x, y1: A.y, x2: B.x, y2: B.y, endNode: placement.to, edge: placement.edge, edges: [placement.edge.id], w: placement.edge.w }];
    this.extendRoute();
  }

  // Add a route from the end of the last leg to a new destination (random, or the goal)
  extendRoute(avoidEdge) {
    const last = this.legs[this.legs.length - 1];
    if (!last || last.aim || last.fixed) return false;
    const live = this.net.live;
    for (let tries = 0; tries < 12; tries++) {
      let dest;
      if (this.goal && tries < 2) {                                 // head for the goal (else roam)
        dest = live.reduce((b, n) => Math.hypot(n.x - this.goal.x, n.y - this.goal.y) < Math.hypot(b.x - this.goal.x, b.y - this.goal.y) ? n : b, live[0]);
      } else {
        dest = live[Math.floor(this.rand() * live.length)];
      }
      if (dest.id === last.endNode) continue;
      const steps = this.net.route(last.endNode, last.dir, dest.id, avoidEdge);
      if (!steps || !steps.length) continue;
      // ...and only to a destination the flight can march on from (no pocket it can't turn out of)
      const endStep = steps[steps.length - 1], A = this.net.nodes[endStep.from], B = this.net.nodes[endStep.to];
      const onward = live[Math.floor(this.rand() * live.length)];
      if (!this.goal && onward.id !== dest.id && !this.net.route(dest.id, dirOf(B.x - A.x, B.y - A.y), onward.id)) continue;
      steps.forEach(st => this.addLeg(st));
      return true;
    }
    return false;
  }

  // Head for a point (Phase 9: chase / evade). Keeps the leg it's on (and the next one if the turn
  // into it is close), and re-plans the rest. Call it every few seconds with a fresh goal.
  setGoal(goal) {
    this.goal = goal;
    if (!this.legs.length || this.backOff || this.turnAround) return;
    if (this.legs[0].aim) {                       // back from an attack run: rejoin the nearest lane ahead
      const f = this.flight, c = flightCenter(f), h = f.mainDir(), u = dirVec(h);
      const ahead = this.net.live.filter(n => (n.x - c.x) * u.x + (n.y - c.y) * u.y > 300)
        .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
      if (!ahead) return;
      const d = dirOf(ahead.x - c.x, ahead.y - c.y), v = dirVec(d);
      this.legs = [{ dir: d, x1: ahead.x - v.x * 2000, y1: ahead.y - v.y * 2000, x2: ahead.x, y2: ahead.y, endNode: ahead.id, edge: null, edges: [], w: 0 }];
      this.extendRoute();
      return;
    }
    this.legs.splice(this.nearCorner ? 2 : 1);
    this.extendRoute();
  }

  // AUTOPILOT (Phase 11): follow a fixed route (corner points, map units) instead of the network,
  // then halt at the end. Used by the Live-mode tests (a scripted run of each mission) and as a demo.
  followRoute(points) {
    this.legs = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const A = points[i], B = points[i + 1];
      this.legs.push({ dir: dirOf(B.x - A.x, B.y - A.y), x1: A.x, y1: A.y, x2: B.x, y2: B.y, endNode: null, edge: null, edges: [], w: 0,
                       fixed: true, last: i + 2 === points.length });
    }
    this.fixedRoute = true;
    this.finished = false;
  }

  // ROAD GUARDS (detachment SOP) for flights that know the intersections: halt before it, Road Guards,
  // OUT, wait for the guards to post, march through, Road Guards, IN once the flight has passed.
  // Returns true while it is busy with the procedure (no steering then).
  roadGuardStep(c, strike) {
    const f = this.flight;
    if (!f.intersections.length || f.marchers().length <= DRILL.roadGuards.requiredAbove) return false;
    const rg = f.roadGuards;
    if (rg) {
      if (rg.cleared && !rg.guards.some(g => g.roadGuard && g.roadGuard.back)) this.tryGive('Road Guards, IN');
      if (!f.marching && !f.needCover && rg.guards.every(g => g.atPost)) this.tryGive('Forward, HARCH');
      return !f.marching;
    }
    if (!f.marching) {
      if (f.needCover) { this.tryGive('COVER'); return true; }
      if (this.rgPending) { this.rgPending = false; this.tryGive('Road Guards, OUT'); return true; }
      return false;
    }
    // Approaching an intersection we haven't guarded yet: halt a few meters before it
    const g = f.guide, u = dirVec(f.mainDir());
    this.rgDone = this.rgDone || new Set();
    for (const ix of f.intersections) {
      if (this.rgDone.has(ix.name) || ix.roadGuards === false) continue;
      const along = (ix.x - g.x) * u.x + (ix.y - g.y) * u.y, side = Math.abs((ix.x - g.x) * u.y - (ix.y - g.y) * u.x);
      if (side < ix.r + 60 && along > 0 && along - ix.r < 9 * STEP_PX) {
        if (f.columnMovementInProgress() || f.halfStep || f.markTime) return false;
        if (this.tryGive('Flight, HALT', strike)) { this.rgDone.add(ix.name); this.rgPending = true; }
        return true;
      }
    }
    return false;
  }

  // Attack run (Phase 9): march straight through `point` along the nearest of the 8 directions
  // (column movements / inclines line the flight up on it). The route network is left behind.
  aim(point) {
    const c = flightCenter(this.flight);
    const d = dirOf(point.x - c.x, point.y - c.y), u = dirVec(d);
    this.goal = point;
    if (this.backOff || this.turnAround || this.flight.columnMovementInProgress()) return;
    this.legs = [{ dir: d, x1: point.x - u.x * 2000, y1: point.y - u.y * 2000, x2: point.x + u.x * 2000, y2: point.y + u.y * 2000,
                   endNode: null, edge: null, edges: [], w: 0, aim: true }];
  }

  // Add one segment; straight continuations join the previous leg (one long line)
  addLeg(st) {
    const A = this.net.nodes[st.from], B = this.net.nodes[st.to];
    const dir = dirOf(B.x - A.x, B.y - A.y);
    const last = this.legs[this.legs.length - 1];
    if (last && last.dir === dir) {
      last.x2 = B.x; last.y2 = B.y; last.endNode = st.to; last.edge = st.edge; (last.edges = last.edges || []).push(st.edge.id);
      last.w = Math.min(last.w, st.edge.w); return;
    }
    this.legs.push({ dir, x1: A.x, y1: A.y, x2: B.x, y2: B.y, endNode: st.to, edge: st.edge, edges: [st.edge.id], w: st.edge.w });
  }

  remaining() {
    const c = flightCenter(this.flight);
    let total = 0;
    this.legs.forEach((l, i) => { total += i === 0 ? Math.hypot(l.x2 - c.x, l.y2 - c.y) : Math.hypot(l.x2 - l.x1, l.y2 - l.y1); });
    return total;
  }

  // Give a command if this is the right heel strike for it; returns true if given
  tryGive(text, strikeFoot) {
    const fl = this.flight;
    if (fl.pending || fl.haltAt !== null || fl.slides.length) return false;   // still finishing the last one
    const cmd = COMMANDS_BY_KEY[cleanUpCommand(text)];
    if (fl.routeStep && cmd && !cmd.routeStepOk) {             // route step: call the flight to attention first
      fl.giveCommand('Flight, Ten-HUT'); this.stats.commands++;
      return false;
    }
    const foot = cmd && this.flight.marching && !this.flight.routeStep ? cmd.foot : null;
    if (foot && foot !== 'either' && foot !== strikeFoot) return false;
    if (foot && !strikeFoot) return false;
    const before = this.flight.commandSeq;
    this.flight.giveCommand(text);
    this.stats.commands++;
    if (this.flight.commandSeq === before) { this.stats.refused++; return false; }
    return true;
  }

  // Others' people in front of this flight (it would walk into them): returns the blocking flight or null.
  // `dir` = look along another facing (the sidewalk after the next corner) instead of the current one.
  blocker(dir) {
    const f = this.flight, d = dir === undefined ? f.mainDir() : dir, h = dirVec(d), r = dirVec(turnDir(d, 1));
    const mine = f.everyone();
    const front = Math.max(...mine.map(p => p.x * h.x + p.y * h.y));
    const lats = mine.map(p => p.x * r.x + p.y * r.y);
    const lo = Math.min(...lats) - 45, hi = Math.max(...lats) + 45;   // room for the outer files swinging wide in a wheel
    for (const other of this.opts.others()) {
      if (other === f || (this.opts.ignore && this.opts.ignore(other))) continue;
      // where they are now, and where a marching flight will be ~3 steps from now (cross traffic)
      const v = other.marching && !other.markTime ? dirVec(other.mainDir()) : null;
      for (const q of other.everyone()) {
        for (const ahead of v ? [0, 120] : [0]) {
          const qx = q.x + (v ? v.x * ahead : 0), qy = q.y + (v ? v.y * ahead : 0);
          const along = qx * h.x + qy * h.y - front, lat = qx * r.x + qy * r.y;
          if (along > -10 && along < this.opts.lookAheadPx && lat > lo && lat < hi) { this.blockDist = along; return other; }
        }
      }
    }
    return null;
  }

  // Room for a Counter March right here: the flight's own footprint plus ~6 m ahead (the elements loop
  // forward) and ~2 m to each side must be free of buildings/obstacles and other flights
  counterMarchRoom() {
    const f = this.flight, d = f.mainDir(), h = dirVec(d), r = dirVec(turnDir(d, 1));
    const ps = f.everyone();
    const al = ps.map(p => p.x * h.x + p.y * h.y), la = ps.map(p => p.x * r.x + p.y * r.y);
    const a0 = Math.min(...al) - 30, a1 = Math.max(...al) + 190, b0 = Math.min(...la) - 60, b1 = Math.max(...la) + 60;
    for (let a = a0; a <= a1; a += 30) for (let b = b0; b <= b1; b += 30) {
      if (this.net.blocked && this.net.blocked(h.x * a + r.x * b, h.y * a + r.y * b)) return false;
    }
    return !this.opts.others().some(o => o !== f && o.everyone().some(q => {
      const qa = q.x * h.x + q.y * h.y, qb = q.x * r.x + q.y * r.y;
      return qa > a0 - 140 && qa < a1 + 140 && qb > b0 - 140 && qb < b1 + 140;
    }));
  }

  // No other flight's people within r units of point c
  clearOfOthers(c, r) {
    return !this.opts.others().some(o => o !== this.flight && o.everyone().some(q => Math.hypot(q.x - c.x, q.y - c.y) < r));
  }

  // Another flight within ~10 m of the corner we're about to turn at (junctions are taken one at a time)
  cornerTaken(N) {
    for (const other of this.opts.others()) {
      if (other === this.flight || (this.opts.ignore && this.opts.ignore(other))) continue;
      if (other.everyone().some(q => Math.hypot(q.x - N.x1, q.y - N.y1) < 330)) { this.blockDist = 330; return other; }
    }
    return null;
  }

  update(dt) {
    const f = this.flight;
    const c = flightCenter(f);
    this.stats.distance += Math.hypot(c.x - this.lastPos.x, c.y - this.lastPos.y);
    this.lastPos = c;
    // Which heel just struck (commands are given only on a heel strike)
    let strike = null;
    const info = f.footInfo();
    if (info) {
      const n = Math.floor(info.progress);
      if (this.lastStrike !== null && n !== this.lastStrike) strike = n % 2 === 1 ? 'left' : 'right';
      this.lastStrike = n;
    } else this.lastStrike = null;

    if (this.backOff) { this.doBackOff(c, strike); return; }
    if (this.roadGuardStep(c, strike)) return;
    if (this.finished) return;
    if (!f.marching) {                                         // at the halt
      if (f.needCover) { this.tryGive('COVER'); return; }
      if (f.pending || f.haltAt !== null) return;
      if (!this.blocker()) this.tryGive('Forward, HARCH');
      return;
    }
    if (f.pending || f.haltAt !== null || f.slides.length) return;
    if (this.legs.length && this.remaining() < 900) this.extendRoute();

    // Traffic: wait in place (mark time) while someone is in the way (ahead, or down the sidewalk
    // after the next corner); yield (turn around) if stuck
    const N = this.legs[1];
    const block = this.blocker() || (N && this.nearCorner ? this.blocker(N.dir) || this.cornerTaken(N) || this.claimConflict(N) : null);
    this.waitingFor = block;
    // Turning around (yielding, or a dead end): Counter March in the flight's own space. It isn't
    // given from mark time or half step, so step off first (Forward, HARCH).
    if (this.turnAround) {
      if (f.columnMovementInProgress()) return;
      if (!this.counterMarchRoom()) {                          // the loop needs space: wait in place
        if (!f.markTime) this.tryGive('Mark Time, HARCH', strike);
        return;
      }
      if (f.markTime || f.halfStep) { this.tryGive('Forward, HARCH', strike); return; }
      if (this.tryGive('Counter, HARCH', strike)) { this.turnAround = false; this.waitTime = 0; this.reverseRoute(); }
      return;
    }
    if (block) {
      this.waitTime += dt;
      if (this.waitTime > 30 && this.yields(block)) { this.backOff = { stage: 'start' }; this.turnAround = false; return; }
      if (!f.markTime && !f.columnMovementInProgress()) this.tryGive('Mark Time, HARCH', strike);
      // Give way by turning around, unless that would face another flight close behind
      if (this.waitTime > 6 && f.markTime && this.yields(block) && !this.blocker(turnDir(f.mainDir(), 2)) &&
          this.counterMarchRoom()) this.turnAround = true;
      return;
    }
    this.waitTime = 0;
    if (f.markTime) { this.tryGive('Forward, HARCH', strike); return; }
    if (f.columnMovementInProgress()) return;
    if (f.halfStep) { this.tryGive('Forward, HARCH', strike); return; }
    this.steer(c, strike);
  }

  // Last resort when stuck: back off in place with drill (no space needed), then turn the right way:
  //   To the Rear (now facing away, in inverted column) -> march away until clear -> To the Rear
  //   (column again, facing back) -> Counter, HARCH (column, facing away; Counter March is only
  //   given in column). Inverted column allows no column movements, so the flight halts at the end
  //   of its leg if it isn't clear by then.
  doBackOff(c, strike) {
    const f = this.flight, b = this.backOff;
    if (f.pending || f.haltAt !== null || f.columnMovementInProgress()) return;
    if (!f.marching && f.needCover) { this.tryGive('COVER'); return; }
    const L = this.legs[0];
    const toEnd = L ? (L.x2 - c.x) * dirVec(f.mainDir()).x + (L.y2 - c.y) * dirVec(f.mainDir()).y : 0;
    const clear = this.clearOfOthers(c, 330);
    if (b.stage === 'start') {
      if (f.markTime || f.halfStep) { this.tryGive('Forward, HARCH', strike); return; }
      if (this.tryGive('To the Rear, HARCH', strike)) { b.stage = 'away'; b.from = { x: c.x, y: c.y }; this.reverseRoute(true); this.stats.reroutes++; }
      return;
    }
    if (b.stage === 'away') {
      const far = Math.hypot(c.x - b.from.x, c.y - b.from.y) > 500;   // back away ~15 m first
      if (clear && (far || !f.marching)) { if (this.tryGive('To the Rear, HARCH', f.marching ? strike : undefined)) b.stage = 'counter'; return; }
      if (f.marching && toEnd < 120) this.tryGive('Flight, HALT', strike);   // wait at the end of the leg
      return;
    }
    if (b.stage === 'counter') {
      if (!this.counterMarchRoom()) { if (f.marching) this.tryGive('Flight, HALT', strike); return; }   // wait at the halt
      if (this.tryGive('Counter, HARCH', f.marching ? strike : undefined)) {
        this.backOff = null; this.waitTime = 0;
        this.reverseRoute(true);                                // facing away again: route on from here
        this.extendRoute(this.legs[0] && this.legs[0].edge);
      }
    }
  }

  // Who gives way when two flights block each other: the later-named flight
  yields(other) {
    const theirs = other.npcName || 'A Flight';
    return this.name > theirs;
  }

  // After a Counter March: march back along the current leg, then route somewhere new
  reverseRoute(legOnly) {
    const leg = this.legs[0];
    if (!leg) return;
    const startNode = this.net.nodes.find(n => Math.hypot(n.x - leg.x1, n.y - leg.y1) < 1);
    this.legs = [{ dir: turnDir(leg.dir, 2), x1: leg.x2, y1: leg.y2, x2: leg.x1, y2: leg.y1,
                   endNode: startNode ? startNode.id : leg.endNode, edge: leg.edge, edges: leg.edges || [], w: leg.w, aim: leg.aim }];
    if (legOnly) return;
    this.stats.reroutes++;
    this.extendRoute(leg.edge);
  }

  // Signed sideways distance of point c from where the flight should march on leg L, across facing
  // `dir` (+ = right). On a wide walkway (the Village concourse) flights keep to the RIGHT half, so two
  // flights going opposite ways pass each other.
  lateral(c, L, dir) {
    const r = dirVec(turnDir(dir, 1));
    return (c.x - L.x1) * r.x + (c.y - L.y1) * r.y - this.keepRight(L);
  }
  keepRight(L) { return L.w >= 260 ? L.w / 4 : 0; }

  // Should a turn to facing `newDir` onto leg L be given at this heel strike? (now is closer to the
  // ideal moment than two steps later)
  timeToTurn(c, text, newDir, L) {
    const f = this.flight, h = dirVec(f.mainDir()), r = dirVec(turnDir(newDir, 1));
    const off = (L.x1 - c.x) * r.x + (L.y1 - c.y) * r.y + this.keepRight(L);   // target line, across the new facing
    const lat = this.turns[text];
    const perStep = (f.halfStep ? STEP_PX / 2 : STEP_PX) * (h.x * r.x + h.y * r.y);
    return Math.abs(off - lat) <= Math.abs(off - 2 * perStep - lat);
  }

  turnCommand(delta, correcting) {
    if (delta === 2) return 'Column Right, HARCH';
    if (delta === -2) return 'Column Left, HARCH';
    if (delta === 1) return correcting ? 'Incline to the Right' : 'Column Half Right, HARCH';   // corrections: at route step
    if (delta === -1) return correcting ? 'Incline to the Left' : 'Column Half Left, HARCH';
    return null;
  }

  steer(c, strike) {
    const f = this.flight, h = f.mainDir();
    let L = this.legs[0];
    if (!L) return;
    // Drop legs we've already passed
    while (this.legs.length > 1 && h === this.legs[1].dir) { this.legs.shift(); L = this.legs[0]; }
    // 1. Not facing along the current leg (inclined to correct, or a turn still to finish): turn onto it
    if (h !== L.dir) {
      const delta = dirDelta(h, L.dir);
      // (straighten out with an incline at route step; at attention with Column Half: inclines are route step only)
      const text = this.turnCommand(delta, this.correcting && f.routeStep);
      if (text && strike && this.timeToTurn(c, text, L.dir, L)) { if (this.tryGive(text, strike)) this.correcting = false; }
      else if (!text && strike) this.turnAround = true;
      return;
    }
    // 2. The next corner (within ~6 steps of it, the sidewalk after it is checked for traffic too)
    const N = this.legs[1];
    this.nearCorner = false;
    if (N) {
      const delta = dirDelta(h, N.dir);
      const text = this.turnCommand(delta, false);
      if (text) {
        const r = dirVec(turnDir(N.dir, 1)), off = (N.x1 - c.x) * r.x + (N.y1 - c.y) * r.y;
        this.nearCorner = Math.abs(off - this.turns[text]) < 12 * STEP_PX;   // wait well short of a busy junction
      }
      if (text && strike && this.timeToTurn(c, text, N.dir, N)) {
        if (this.tryGive(text, strike)) { this.legs.shift(); this.correcting = false; }
        return;
      }
      if (!text) { this.legs.splice(1); this.extendRoute(); }      // (no sharp corners in routes; just in case)
    }
    // 3. Stay centered on the sidewalk: incline toward the line when more than ~0.8 m off
    const e = this.lateral(c, L, h);
    const toEnd = (L.x2 - c.x) * dirVec(h).x + (L.y2 - c.y) * dirVec(h).y;
    // Long straight stretches are marched at ROUTE STEP (inclines are route step only, user's rule);
    // the flight comes back to attention (Flight, Ten-HUT) before corners, halts and traffic.
    if (!f.roadGuards && f.routeStep && (this.nearCorner || toEnd < 300)) { this.tryGive('Flight, Ten-HUT'); return; }
    if (!f.roadGuards && !f.routeStep && !this.nearCorner && toEnd > 700 && strike) { this.tryGive('Route Step, HARCH', strike); return; }
    if (Math.abs(e) > 26 && toEnd > 260 && f.routeStep) {
      const text = e > 0 ? 'Incline to the Left' : 'Incline to the Right';
      if (this.tryGive(text)) this.correcting = true;
    }
    // 4. End of a fixed route: halt there. Dead end ahead with no route: turn around in place.
    if (!N && L.last) {
      if (toEnd < 60 && strike && this.tryGive('Flight, HALT', strike)) this.finished = true;
      return;
    }
    if (!N && toEnd < 320) this.turnAround = true;
  }
}
