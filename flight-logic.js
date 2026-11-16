// =====================================================================
//  flight-logic.js: the flight's GAME LOGIC. No Phaser / drawing code here,
//  so a future 3D version (Phase 10) can reuse it unchanged.
//    const flight = new FlightLogic({ ...options });
//    flight.giveCommand('Forward, HARCH');
//    flight.update(secondsSinceLastFrame);
//    flight.everyone()  -> people with x, y, dir, kind, off, rot, walkAngle (for drawing)
//  Commands and drill rules come from drill-rules.js.
//  Positions are in game units: 20 units = one 24-inch step.
// =====================================================================

// ---------- Measurements (from drill-rules.js) ----------
const STEP_PX = DRILL.measurements.stepPx;
const DISTANCE_PX = DRILL.measurements.distancePx;
const INTERVAL_PX = DRILL.measurements.intervalPx;
const CLOSE_INTERVAL_PX = DRILL.measurements.closeIntervalPx;
const RIGHT_STEP_PX = DRILL.measurements.rightStepPx;
const CDR_OFFSET = DRILL.measurements.cdrOffsetPx;
const CDR_DEPTH = DRILL.measurements.cdrDepth;
const CDR_FRONT_PACES = DRILL.measurements.cdrFrontPaces;
const CDR_CLEARANCE = DRILL.measurements.cdrClearancePx;
const WALK_SPEED = DRILL.measurements.walkSpeedPx;
const DOUBLE_TIME_STEP_PX = DRILL.measurements.doubleTimeStepPx;
const DOUBLE_TIME_RATIO = DRILL.measurements.doubleTimeRatio;
const MAX_DRIFT = DRILL.disorder.maxDriftPx;
const NATURAL_DRIFT = DRILL.disorder.naturalDriftPx;
const TIMING_GRACE = DRILL.disorder.timingGrace;
const BAD_TIMING_DRIFT = DRILL.disorder.badTimingDriftPx;
const SLOPPY_WORD_DRIFT = DRILL.disorder.sloppyWordDriftPx;
const COVER_SPEED = DRILL.disorder.coverSpeedPx;
const STAIRS_DRIFT = DRILL.disorder.stairsDriftPx;
const CADENCE_WORDS = DRILL.cadenceWords;

// Commands by their key, e.g. COMMANDS_BY_KEY['forward harch']
const COMMANDS_BY_KEY = {};
DRILL.commands.forEach(c => { COMMANDS_BY_KEY[c.key] = c; });

// How far (in steps, 0 to 1) cadence position `p` is from a heel strike of `foot`.
// Heel strikes: left at steps 1, 3, 5...; right at 2, 4, 6...; 'either' = any.
// Is this (cleaned-up) text a preparatory command waiting for its command of execution?
// e.g. "right flank" (-> Right Flank, HARCH) or "flight" (-> Flight, HALT / Flight, Ten-HUT)
function isPreparatoryOnly(cleaned) {
  if (!cleaned || COMMANDS_BY_KEY[cleaned]) return false;
  if (cleaned === DRILL.preparatory.unitWord) return true;
  return DRILL.commands.some(c => c.key.startsWith(cleaned + ' ') &&
                                  DRILL.executionWords.includes(c.key.slice(cleaned.length + 1)));
}

// Grade the PREPARATORY command's timing (DAFPAM 2.2.7, 2.4, 3.9.2): its last word on the same heel
// as the command of execution, at least one step before it (normally two steps: same heel, next strike).
//   prepStep / execStep: cadence positions when each part was said; foot: the command's foot
// Returns null (fine) or { error, gap, text }.
function prepTimingProblem(prepStep, execStep, foot) {
  const P = DRILL.preparatory;
  const gap = execStep - prepStep;
  const round2 = v => Math.round(v * 100) / 100;
  if (gap < P.minGapSteps) {
    return { error: 1, gap: round2(gap), text: 'the preparatory command and the command of execution ran together; leave one step between them (DAFPAM 2.4.1)' };
  }
  if (foot === 'either') {                         // Flight, HALT: both parts on the same heel (even gap)
    const error = Math.abs(gap - 2 * Math.round(gap / 2));
    if (error <= 2 * TIMING_GRACE) return null;
    return { error: round2(error), gap: round2(gap), text: 'give "Flight" and HALT on the SAME foot: "Flight" as a heel strikes, HALT when that heel strikes again (DAFPAM 3.9.2)' };
  }
  const error = timingErrorAt(prepStep, foot);
  if (error <= TIMING_GRACE) return null;
  return { error: round2(error), gap: round2(gap),
           text: 'preparatory command ' + (error > 0.5 ? 'on the WRONG foot' : 'a little off the heel strike') +
                 '; give it as the ' + foot.toUpperCase() + ' heel strikes, two steps before the command of execution (DAFPAM 3.9.2)' };
}

function timingErrorAt(p, foot) {
  if (p < 0) return 0;
  if (foot === 'either') return Math.abs(p - Math.round(p));
  const offset = foot === 'left' ? 1 : 0;          // left strikes on odd steps
  const nearest = Math.round((p - offset) / 2) * 2 + offset;
  return Math.min(1, Math.abs(p - nearest));
}

// Number of single-letter changes needed to turn string a into string b
function letterDifference(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// Eight directions, 45 degrees apart (needed for Column Half Right/Left and inclines):
// 0 = North (up the screen), 1 = Northeast, 2 = East, 3 = Southeast,
// 4 = South, 5 = Southwest, 6 = West, 7 = Northwest. One quarter turn = 2.
const D45 = Math.SQRT1_2;
const DIRS = [
  { x: 0,    y: -1,   name: 'North' },
  { x: D45,  y: -D45, name: 'Northeast' },
  { x: 1,    y: 0,    name: 'East' },
  { x: D45,  y: D45,  name: 'Southeast' },
  { x: 0,    y: 1,    name: 'South' },
  { x: -D45, y: D45,  name: 'Southwest' },
  { x: -1,   y: 0,    name: 'West' },
  { x: -D45, y: -D45, name: 'Northwest' },
];
// Turn a direction by `quarterTurns` (+ right, - left; 0.5 = 45 degrees)
function turnDir(dir, quarterTurns) { return ((dir + Math.round(quarterTurns * 2)) % 8 + 8) % 8; }

// ---------- Geometry helpers ----------
// "a" = how far forward a spot is, "b" = how far to the right, for a given facing.
function aOf(p, h) { return p.x * DIRS[h].x + p.y * DIRS[h].y; }
function bOf(p, h) { const r = DIRS[turnDir(h, 1)]; return p.x * r.x + p.y * r.y; }
function toXY(a, b, h) {
  const f = DIRS[h], r = DIRS[turnDir(h, 1)];
  return { x: a * f.x + b * r.x, y: a * f.y + b * r.y };
}

// Does the straight line from p to q pass through the box?
function crossesBox(p, q, b) {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const checks = [[-dx, p.x - b.x0], [dx, b.x1 - p.x], [-dy, p.y - b.y0], [dy, b.y1 - p.y]];
  for (const [pp, qq] of checks) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else        { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 < t1 - 1e-6;
}

// Walk a person toward a spot. Returns true when they arrive.
function walkToward(p, spot, maxDist) {
  const dx = spot.x - p.x, dy = spot.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d <= maxDist) { p.x = spot.x; p.y = spot.y; p.walkAngle = null; return true; }
  p.x += dx / d * maxDist; p.y += dy / d * maxDist;
  p.walkAngle = Math.atan2(dx, -dy);
  return false;
}

// March a person forward, turning at any pivot points on their path.
function moveAlongPath(p, distance) {
  while (distance > 0) {
    const d = DIRS[p.dir];
    const turn = p.turns[0];
    if (turn) {
      const toTurn = (turn.x - p.x) * d.x + (turn.y - p.y) * d.y;
      if (toTurn <= distance) {           // reached the pivot point: step onto it and turn
        p.x = turn.x; p.y = turn.y; p.dir = turn.dir;
        p.turns.shift();
        distance -= Math.max(toTurn, 0);
        continue;
      }
    }
    p.x += d.x * distance;
    p.y += d.y * distance;
    distance = 0;
  }
}

// Typed or spoken text -> standard command key (lowercase, punctuation removed, spellings
// from drill-rules.js). Spoken text also gets DRILL.voiceSpellings (march -> harch, ...).
function cleanUpCommand(text, voice) {
  let s = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (voice) DRILL.voiceSpellings.forEach(([pattern, replacement]) => { s = s.replace(pattern, replacement); });
  DRILL.spellings.forEach(([pattern, replacement]) => { s = s.replace(pattern, replacement); });
  return s.replace(DRILL.unitPrefix, '');
}

// =====================================================================
//  The Flight (logic only)
// =====================================================================
class FlightLogic {
  // options:
  //   bounds:   { x0, y0, x1, y1 }  area the flight must stay inside
  //   start:    { x, y }            where the front of the flight starts
  //   startDir: direction the flight starts facing (0 = North ... 3 = West)
  //   areaName: 'drill pad'         used in messages
  //   onFeedback(message, good)     called after each command (good: true / false / 'warn')
  //   onStatus(text)                called every frame with the flight's status
  //   cadence:     steps per minute (120 = regulation quick time)
  //   elements:    number of elements (files in column), 2 to 4
  //   elementSize: cadets per element
  //   cdrSide:     'left' or 'right', the danger side the commander marches on
  //   disorder:    0 = off, 0.5 = low, 1 = normal, 1.5 = high
  //   obstacleAt(x, y): optional; returns a name (e.g. a building) if that spot is blocked
  //   stairsAt(x, y):   optional; returns a name if that spot is on stairs (must be taken at route step)
  //   intersections:    optional list of { name, x, y, r } (road crossings, for road guards later)
  //   onIntersection(event, intersection): optional; event = 'approaching' | 'crossing' | 'cleared'
  //   onEvent(entry):   optional; called with every new event-log entry (see log())
  constructor(options) {
    this.opts = options;
    this.numElements = options.elements || 3;
    this.elementSize = options.elementSize || 5;
    this.stepSeconds = 60 / (options.cadence || 120);     // time for one step
    this.doubleStepSeconds = this.stepSeconds / DOUBLE_TIME_RATIO;   // double time: 180 instead of 120
    this.cadence = options.cadence || 120;
    this.disorderLevel = options.disorder !== undefined ? options.disorder : 1;
    this.generation = 0;  // goes up on every reset, so the drawing code knows to rebuild
    this.events = [];     // EVENT LOG: everything that happens (read by scoring and scenarios)
    this.clock = 0;       // seconds since the flight was created
    this.commandSeq = 0;  // id of the last command carried out (event log)
    this.heldPrep = null; // a preparatory command typed/said on its own, waiting for its execution word
    this.intersections = (options.intersections || []).map(i => ({ ...i, state: null }));
    this.elements = [];   // elements[e][i]: element e (0 = 1st), cadet i (0 = element leader)
    this.guide = null;
    this.commander = null;
    this.reset();
  }

  // ---------- Who is in the flight ----------
  members()  { return this.elements.flat(); }                  // the cadets in the elements
  inRanks()  { return this.marchers().filter(p => !p.roadGuard); }   // everyone marching with the flight right now
  marchers() { return [...this.members(), this.guide]; }       // everyone in the formation
  everyone() { return [...this.marchers(), this.commander].filter(p => p); }

  // kind: 'leader' (element leader), 'member', 'guide', or 'commander'
  makePerson(x, y, dir, kind) {
    return { x, y, dir, kind, turns: [], group: null, target: null, walkAngle: null,
             off: { x: 0, y: 0 },   // drift away from their proper spot (disorder)
             rot: 0,                // slight twist when out of position
             drift: null };         // direction they are slowly wandering
  }

  // ---------- Setting up the flight ----------
  reset() {
    this.generation += 1;
    this.elements = [];
    this.guide = null;
    this.commander = null;
    this.marching = false;
    this.stepCount = 0;       // steps since the flight stepped off, with fractions (drives left/right foot)
    this.markTime = false;    // marching in place (DAFPAM 3.12)
    this.doubleTime = false;  // 180 steps/min, 30-inch steps (DAFPAM 3.11)
    this.halfStep = false;    // true after a column movement, until Forward, HARCH (DAFPAM 4.11)
    this.routeStep = false;   // true after Route Step / At Ease, HARCH, until Flight, Ten-HUT (DAFPAM 3.19)
    this.routeStepKind = 'ROUTE STEP';   // or 'AT EASE'
    this.posture = 'attention';
    this.roadGuards = null;   // { ix, guards, crossed } while road guards are out (detachment SOP)
    this.cdrHold = null;      // spot the commander holds (middle of the intersection) while they are out   // at the halt: 'attention', 'paradeRest' (3.3.1.1) or 'presentArms' (3.7)
    this.stepShift = 0;       // Change Step moves the cadence by one step
    this.changeStepAt = null; // step number when a Change Step finishes
    this.lastMovement = null; // 'column' or 'counter': the last movement that ends in a half step
    this.clearTimedActions();
    // Where the flight commander marches. These flip on A-bout, HACE and To the Rear
    // so the commander stays on the same physical side instead of crossing over.
    this.cdrOnLeft = this.opts.cdrSide !== 'right';
    this.cdrDepth = CDR_DEPTH;
    this.cdrStayPut = false;  // true right after an About Face in line: commander holds position
    this.closeInterval = false;   // files at close interval (Close, HARCH, DAFPAM 4.10)
    this.sideStep = null;         // Right/Left Step: direction of the side steps (DAFPAM 3.14)
    this.slides = [];             // people side-stepping at the halt (Close/Extend, HARCH)
    this.needCover = false;   // true after a halt: the next command must be COVER
    this.covering = false;    // true while cadets are moving back into place
    this.onStairs = false;    // somebody in the flight is on stairs right now
    this.intersections.forEach(i => { i.state = null; });

    // Column formation facing the start direction (North unless the map says otherwise).
    // 1st element is the left file, last element is the right file, element leaders in front.
    const h = this.opts.startDir || 0;
    const start = this.opts.start;
    const spot = (forward, right) => {
      const o = toXY(forward, right, h);
      return { x: start.x + o.x, y: start.y + o.y };
    };
    for (let e = 0; e < this.numElements; e++) {
      const right = (e - (this.numElements - 1) / 2) * INTERVAL_PX;
      const el = [];
      for (let i = 0; i < this.elementSize; i++) {
        const s = spot(-i * DISTANCE_PX, right);
        el.push(this.makePerson(s.x, s.y, h, i === 0 ? 'leader' : 'member'));
      }
      this.elements.push(el);
    }
    // Guide: in front of the right file (DAFPAM 4.2.5)
    const g = spot(DISTANCE_PX, ((this.numElements - 1) / 2) * INTERVAL_PX);
    this.guide = this.makePerson(g.x, g.y, h, 'guide');
    // Flight commander: danger side, toward the rear
    const post = this.commanderPost();
    this.commander = this.makePerson(post.x, post.y, h, 'commander');

    this.reportStatus();
    if (this.events) this.log('reset', {});
    this.feedback('Flight formed in column. Ready for your command.', true);
  }

  feedback(message, good) { if (this.opts.onFeedback) this.opts.onFeedback(message, good); }

  // EVENT LOG (Phase 4). Every entry: { type, time (s), step (cadence position), ...details }.
  // Types: command, command-rejected, preparatory, timing-graded, movement, halted, out-of-bounds,
  //        obstacle, stairs, intersection, reset. Scoring and scenarios read this.events
  //        (each entry has a running number `seq`, so readers can pick up where they left off).
  log(type, details) {
    this.eventSeq = (this.eventSeq || 0) + 1;
    const entry = { seq: this.eventSeq, type, time: Math.round(this.clock * 1000) / 1000,
                    step: this.marching ? Math.round(this.realSteps() * 100) / 100 : null, ...details };
    this.events.push(entry);
    if (this.events.length > 5000) this.events.shift();      // keep memory bounded
    if (this.opts.onEvent) this.opts.onEvent(entry);
    return entry;
  }

  // A command the flight did not carry out: show why, and record it
  reject(text, key, reason) {
    this.feedback('✘ ' + reason, false);
    this.log('command-rejected', { text, key: key || null, reason });
  }

  // ---------- Reading the formation ----------
  // The direction most of the flight is facing
  mainDir() {
    const counts = [0, 0, 0, 0, 0, 0, 0, 0];
    this.members().forEach(p => counts[p.dir]++);
    return counts.indexOf(Math.max(...counts));
  }

  // Column, inverted column, line, or inverted line, based on where the element leaders are
  formationType() {
    const h = this.mainDir();
    let da = 0, db = 0;
    this.elements.forEach(all => {
      const el = all.filter(p => !p.roadGuard);          // road guards who are out don't count
      if (!el.length) return;
      const ca = el.reduce((s, p) => s + aOf(p, h), 0) / el.length;
      const cb = el.reduce((s, p) => s + bOf(p, h), 0) / el.length;
      da += aOf(el[0], h) - ca;
      db += bOf(el[0], h) - cb;
    });
    if (Math.abs(da) >= Math.abs(db)) return da > 0 ? 'column' : 'inverted column';
    return db > 0 ? 'line' : 'inverted line';
  }

  columnMovementInProgress() {
    return this.inRanks().some(p => p.turns.length > 0 || (p.group && p.group.remaining > 0));
  }

  // ---------- Guide and flight commander posts ----------
  // Where the guide belongs at the halt (DAFPAM 4.2.3, 4.2.5, 4.2.6)
  guidePost() {
    const h = this.mainDir();
    const m = this.members();
    const front = Math.max(...m.map(p => aOf(p, h)));
    const right = Math.max(...m.map(p => bOf(p, h)));
    const left  = Math.min(...m.map(p => bOf(p, h)));
    switch (this.formationType()) {
      case 'column':        return toXY(front + DISTANCE_PX, right, h);  // in front of the right file
      case 'line':          return toXY(front, right + this.interval(), h);  // right of the front rank
      case 'inverted line': return toXY(front, left - this.interval(), h);   // left of the front rank
      default:              return null;                                 // stays where it is
    }
  }

  // Flight commander's post.
  //  - Halted in line: 3 paces in front of, centered on, and facing the flight (DAFPAM 2.3.1)
  //  - Otherwise: alongside the flight on the danger side (normally left), 3/4 of the way back
  commanderPost() {
    if (this.cdrHold) return this.cdrHold;
    if (this.cdrStayPut) return { x: this.commander.x, y: this.commander.y, dir: this.commander.dir };
    const h = this.mainDir();
    const m = this.members().filter(p => p.dir === h);
    const front = Math.max(...m.map(p => aOf(p, h)));
    const rear  = Math.min(...m.map(p => aOf(p, h)));
    const left  = Math.min(...m.map(p => bOf(p, h)));
    const right = Math.max(...m.map(p => bOf(p, h)));
    if (this.commanderAtFrontOfLine()) {
      const spot = toXY(front + CDR_FRONT_PACES * STEP_PX, (left + right) / 2, h);
      spot.dir = turnDir(h, 2);                     // facing the flight
      return spot;
    }
    const side = this.cdrOnLeft ? left - CDR_OFFSET : right + CDR_OFFSET;
    const spot = toXY(front - this.cdrDepth * (front - rear), side, h);
    spot.dir = h;
    return spot;
  }

  commanderAtFrontOfLine() {
    const type = this.formationType();
    return !this.marching && (type === 'line' || type === 'inverted line');
  }

  // After an About Face / To the Rear: keep the commander on the same physical spot.
  commanderStaysOnSide(wasAtFrontOfLine) {
    if (wasAtFrontOfLine) { this.cdrStayPut = true; return; }
    this.cdrOnLeft = !this.cdrOnLeft;
    this.cdrDepth = 1 - this.cdrDepth;
  }

  // Walking around the flight instead of through it: if the straight path crosses
  // the formation, head for the nearest corner of the formation first.
  routeAround(from, to) {
    const xs = this.marchers().map(p => p.x), ys = this.marchers().map(p => p.y);
    const box = { x0: Math.min(...xs) - CDR_CLEARANCE, x1: Math.max(...xs) + CDR_CLEARANCE,
                  y0: Math.min(...ys) - CDR_CLEARANCE, y1: Math.max(...ys) + CDR_CLEARANCE };
    const inner = { x0: box.x0 + 2, x1: box.x1 - 2, y0: box.y0 + 2, y1: box.y1 - 2 };
    const inside = p => p.x > inner.x0 && p.x < inner.x1 && p.y > inner.y0 && p.y < inner.y1;
    if (inside(from) || inside(to) || !crossesBox(from, to, inner)) return to;

    const corners = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 },
                     { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
    const len = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
    let best = null, bestLen = Infinity;
    corners.forEach((c, i) => {
      // One corner: from -> c -> to
      if (!crossesBox(from, c, inner) && !crossesBox(c, to, inner)) {
        const L = len(from, c) + len(c, to);
        if (L < bestLen) { bestLen = L; best = c; }
      }
      // Two corners: from -> c -> next corner -> to
      [corners[(i + 1) % 4], corners[(i + 3) % 4]].forEach(c2 => {
        if (!crossesBox(from, c, inner) && !crossesBox(c2, to, inner)) {
          const L = len(from, c) + len(c, c2) + len(c2, to);
          if (L < bestLen) { bestLen = L; best = c; }
        }
      });
    });
    return best || to;
  }

  // Side-to-side space between files right now
  interval() { return this.closeInterval ? CLOSE_INTERVAL_PX : INTERVAL_PX; }

  relocateGuideIfNeeded() {
    const post = this.guidePost();
    if (post && Math.hypot(post.x - this.guide.x, post.y - this.guide.y) > 2) this.guide.target = post;
  }

  finishGuideMove() {
    const g = this.guide;
    if (!g.target) return;
    g.x = g.target.x; g.y = g.target.y;
    g.target = null; g.walkAngle = null; g.dir = this.mainDir();
  }

  // ---------- Cadence ----------
  // Step off from the halt. Everyone steps off with the LEFT foot (DAFPAM 3.10.1).
  startMarching() {
    if (this.marching) return;
    this.marching = true;
    this.stepCount = 0;
    this.stepShift = 0;
    this.changeStepAt = null;
    this.clearTimedActions();
  }

  clearTimedActions() {
    this.pending = null;          // something that happens at the next heel strike
    this.haltAt = null;           // step number when the halt finishes (trailing foot alongside)
    this.shortStepUntil = null;   // To the Rear: 12-inch steps until this step number
  }

  // Where we are in the cadence, in real steps since stepping off
  realSteps() { return this.stepCount; }

  // The heel strike the current command was really given on. Spoken commands are heard
  // late, so this goes back by the command's age (see giveCommand). Movements are counted
  // from here, like a real flight reacting to the command of execution.
  commandStep() { return Math.round(this.commandAt !== undefined ? this.commandAt : this.realSteps()); }

  // Step number `n` steps after the command; never in the past (if the computer heard the
  // command late, the movement happens right away instead).
  stepsAfterCommand(n) { return Math.max(this.commandStep() + n, this.realSteps()); }

  // Most movements are executed after "one more step": run `action` at the next heel strike.
  // Returns the step number of that heel strike.
  onNextStep(action) {
    const at = this.stepsAfterCommand(1);
    this.pending = { at, action };
    return at;
  }

  // Which foot is striking. null at the halt. Otherwise:
  //   progress:   position in the cadence, in steps (odd whole numbers = left heel strikes,
  //               even = right heel strikes). Change Step shifts this by one.
  //   stepsTaken: whole steps completed (each one is a heel strike)
  //   lastFoot:   foot whose heel most recently struck ('left' / 'right' / null before the 1st step)
  //   word:       cadence count for that heel strike (HUT, TOOP, THREEP, FOURP)
  //   swing:      metronome needle position, -1 = LEFT side, +1 = RIGHT side
  footInfo() {
    if (!this.marching) return null;
    const real = this.stepCount;
    const stepsTaken = Math.floor(real);
    const cs = this.changeStepAt;
    const shift = this.stepShift + (cs !== null && stepsTaken >= cs ? 1 : 0);
    const progress = real + shift;
    const v = stepsTaken + shift;
    // During Change Step the left foot strikes twice in a row: the needle does a
    // little hop on the LEFT side instead of swinging over to the right.
    const hitch = cs !== null && stepsTaken === cs - 1;
    const swing = hitch ? -1 + 0.5 * Math.sin(Math.PI * (real - stepsTaken)) : Math.cos(Math.PI * progress);
    return {
      progress,
      stepsTaken,
      halfStep: this.halfStep,
      routeStep: this.routeStep,
      routeLabel: this.routeStepKind,
      markTime: this.markTime,
      sideStep: !!this.sideStep,
      doubleTime: this.doubleTime,
      cadence: this.doubleTime ? Math.round(this.cadence * DOUBLE_TIME_RATIO) : this.cadence,
      changingStep: cs !== null,
      halting: this.haltAt !== null || (this.pending !== null && this.pending.isHalt === true),
      lastFoot: v === 0 ? null : (v % 2 === 1 ? 'left' : 'right'),
      word: v === 0 ? null : CADENCE_WORDS[(v - 1) % 4],
      swing,
    };
  }

  // How far (in steps, 0 to 1) the command was from the correct heel strike.
  // Heel strikes: left at steps 1, 3, 5...; right at 2, 4, 6...
  //   ageSeconds: how long ago the command was really given (voice is reported late)
  timingError(foot, ageSeconds = 0) {
    const info = this.footInfo();
    if (!info || !foot) return 0;
    return timingErrorAt(info.progress - ageSeconds / (this.doubleTime ? this.doubleStepSeconds : this.stepSeconds), foot);
  }

  // The problems (and extra drift) for a timing error, as used in feedback messages
  timingProblem(timing, foot) {
    if (timing <= TIMING_GRACE) return null;
    const drift = (timing - TIMING_GRACE) / (1 - TIMING_GRACE) * BAD_TIMING_DRIFT;
    if (foot === 'either') return { drift, text: 'given between steps; give it as a heel strikes' };
    if (timing > 0.5) return { drift, text: 'given on the WRONG foot; it belongs on the ' + foot.toUpperCase() + ' foot' };
    return { drift, text: 'a little off the ' + foot.toUpperCase() + ' heel strike' };
  }

  // Spoken commands (offline recognizer): the command was carried out right away using an
  // estimate; now the exact moment the last word was said is known. Grade the foot timing on
  // that, and move the "one more step" onto the correct step if it hasn't happened yet.
  //   ageAtGive: seconds between the word being said and the command being carried out
  //   prepAgeAtGive (optional): the same for the last word of the preparatory command
  judgeTiming(handle, ageAtGive, prepAgeAtGive) {
    if (!handle) return;
    const exactStep = handle.stepAtGive - ageAtGive / handle.stepSec;
    if (handle.pending && this.pending === handle.pending) {
      this.pending.at = Math.max(Math.round(exactStep) + handle.pendingOffset, this.realSteps());
    }
    if (!handle.foot) return;
    const error = timingErrorAt(exactStep, handle.foot);
    const problem = this.timingProblem(error, handle.foot);
    const prepStep = prepAgeAtGive !== undefined && prepAgeAtGive !== null ? handle.stepAtGive - prepAgeAtGive / handle.stepSec : null;
    const prep = prepStep !== null ? prepTimingProblem(prepStep, exactStep, handle.foot) : null;
    this.log('timing-graded', { commandId: handle.id, name: handle.name, foot: handle.foot,
                                timingError: Math.round(error * 100) / 100, problem: problem ? problem.text : null,
                                prepGiven: prepStep !== null, prepProblem: prep ? prep.text : null,
                                prepGap: prepStep !== null ? Math.round((exactStep - prepStep) * 100) / 100 : null });
    if (!problem && !prep) return;
    if (problem && handle.action !== 'cover') this.addDisorder(problem.drift);
    const texts = [problem && problem.text, prep && prep.text].filter(Boolean);
    this.feedback('⚠ ' + handle.name + ' — ' + texts.join('; ') + '.' + (problem ? ' The flight is getting ragged.' : ''), 'warn');
  }

  stop() {
    this.marching = false;
    this.halfStep = false;
    this.markTime = false;
    this.sideStep = null;
    this.doubleTime = false;
    this.routeStep = false;
    this.changeStepAt = null;
    this.clearTimedActions();
    this.needCover = true;    // after every halt the commander must command COVER
    if (!this.columnMovementInProgress()) this.relocateGuideIfNeeded();
  }

  // ---------- Disorder ----------
  // Shake the formation up: each cadet drifts up to `amount` units in a random direction.
  addDisorder(amount) {
    amount *= this.disorderLevel;
    if (amount <= 0) return;
    this.covering = false;
    this.members().forEach(p => {
      const angle = Math.random() * Math.PI * 2;
      const dist = amount * (0.4 + 0.6 * Math.random());
      p.off.x += Math.cos(angle) * dist;
      p.off.y += Math.sin(angle) * dist;
      p.rot += (Math.random() - 0.5) * 0.3 * (amount / MAX_DRIFT);
      this.clampDrift(p);
    });
  }

  clampDrift(p) {
    const d = Math.hypot(p.off.x, p.off.y);
    if (d > MAX_DRIFT) { p.off.x *= MAX_DRIFT / d; p.off.y *= MAX_DRIFT / d; }
    p.rot = Math.max(-0.35, Math.min(0.35, p.rot));
  }

  // Average drift of the cadets, in units
  averageDrift() {
    const m = this.members();
    return m.reduce((s, p) => s + Math.hypot(p.off.x, p.off.y), 0) / m.length;
  }

  // ---------- The commands ----------
  // Each returns a message. Starting with "OK:" means the flight carried it out.
  // `cmd` is the command's entry from drill-rules.js.
  runAction(cmd) {
    switch (cmd.action) {
      case 'forwardMarch': return this.cmdForwardMarch(cmd);
      case 'halt':         return this.cmdHalt(cmd);
      case 'facing':       return cmd.turn === 2 ? this.cmdAboutFace(cmd) : this.cmdFacing(cmd);
      case 'flank':        return this.cmdFlank(cmd);
      case 'toTheRear':    return this.cmdToTheRear(cmd);
      case 'column':       return this.cmdColumn(cmd);
      case 'incline':      return this.cmdIncline(cmd);
      case 'changeStep':   return this.cmdChangeStep(cmd);
      case 'counterMarch': return this.cmdCounterMarch(cmd);
      case 'routeStep':    return this.cmdRouteStep(cmd);
      case 'attention':    return this.cmdAttention(cmd);
      case 'paradeRest':   return this.cmdParadeRest(cmd);
      case 'roadGuards':   return cmd.out ? this.cmdRoadGuardsOut(cmd) : this.cmdRoadGuardsIn(cmd);
      case 'presentArms':  return this.cmdPresentArms(cmd);
      case 'orderArms':    return this.cmdOrderArms(cmd);
      case 'cover':        return this.cmdCover(cmd);
      case 'interval':     return this.cmdInterval(cmd);
      case 'sideStep':     return this.cmdSideStep(cmd);
      case 'troopWalkEdge': return this.cmdTroopWalkEdge(cmd);
      case 'halfStep':     return this.cmdHalfStep(cmd);
      case 'markTime':     return this.cmdMarkTime(cmd);
      case 'doubleTime':   return this.cmdDoubleTime(cmd);
      case 'quickTime':    return this.cmdQuickTime(cmd);
      default:             return cmd.say + ' is not available yet.';
    }
  }

  // From the halt: step off. While half stepping: one more 12-inch step, then the
  // full 24-inch step (DAFPAM 3.13.2). After a Counter March, only once everyone has
  // completed the movement (DAFPAM 4.16.1.6).
  cmdForwardMarch(cmd) {
    // From mark time: one more step in place, then step off with a full step (DAFPAM 3.12.3)
    if (this.marching && this.markTime) {
      this.onNextStep(() => { this.markTime = false; });
      return 'OK:' + cmd.say + ' (one more step in place, then step off)';
    }
    if (this.marching && this.halfStep) {
      if (this.lastMovement === 'counter' && this.columnMovementInProgress()) {
        return cmd.say + ' is given once every member has completed the counter march.';
      }
      this.onNextStep(() => { this.halfStep = false; });
      return 'OK:' + cmd.say + ' (one more half step, then full step)';
    }
    if (this.marching) return 'The flight is already marching at a full step.';
    this.startMarching();
    return 'OK:' + cmd.say;
  }

  // Flight, HALT (DAFPAM 3.10.2), on either foot: one more step, then the trailing
  // foot is brought smartly alongside the front foot. Two counts in all.
  // From double time: two more steps in double time, then halt in two counts at quick time (3.11.5).
  cmdHalt(cmd) {
    if (!this.marching) return 'The flight is already halted.';
    if (this.doubleTime) {
      this.pending = {
        at: this.stepsAfterCommand(2), isHalt: true,
        action: () => { this.doubleTime = false; this.startHalt(); },
      };
      return 'OK:' + cmd.say + ' (two more double-time steps, then halt)';
    }
    this.startHalt();
    return 'OK:' + cmd.say;
  }

  startHalt() {
    const at = this.onNextStep(() => { this.haltAt = at + 1; });
    this.pending.isHalt = true;
  }

  // Half Step (DAFPAM 3.13): one more full step, then 12-inch steps until Forward, HARCH or HALT.
  // Not from the halt; quick time only.
  cmdHalfStep(cmd) {
    if (!this.marching) return 'Half Step is not executed from the halt (DAFPAM 3.13.3).';
    if (this.halfStep) return 'The flight is already half stepping.';
    if (this.columnMovementInProgress()) return 'Wait until the whole flight has finished the column movement.';
    this.onNextStep(() => { this.halfStep = true; this.lastMovement = 'halfStep'; });
    return 'OK:' + cmd.say + ' (half step until Forward, HARCH or Flight, HALT)';
  }

  // Mark Time (DAFPAM 3.12). Marching: one more step, bring the trailing foot up, then march
  // in place. From the halt: start marching in place, left foot first. Quick time only.
  cmdMarkTime(cmd) {
    if (this.markTime) return 'The flight is already marking time.';
    if (this.columnMovementInProgress()) return 'Wait until the whole flight has finished the column movement.';
    if (!this.marching) {
      this.startMarching();
      this.markTime = true;
      return 'OK:' + cmd.say + ' (marching in place; Forward, HARCH to step off)';
    }
    this.onNextStep(() => { this.markTime = true; this.halfStep = false; });
    return 'OK:' + cmd.say + ' (one more step, then in place; Forward, HARCH to step off)';
  }

  // Double Time (DAFPAM 3.11): 180 steps/min (scaled with the cadence setting), 30-inch steps.
  // From the halt: step off in double time. From quick time: one more step, then double time.
  cmdDoubleTime(cmd) {
    if (this.doubleTime) return 'The flight is already in double time.';
    if (this.halfStep || this.markTime) return 'Double time is given from quick time or the halt. Command Forward, HARCH first.';
    if (this.columnMovementInProgress()) return 'Wait until the whole flight has finished the column movement.';
    if (!this.marching) {
      this.startMarching();
      this.doubleTime = true;
      return 'OK:' + cmd.say;
    }
    this.onNextStep(() => { this.doubleTime = true; });
    return 'OK:' + cmd.say + ' (one more quick-time step, then double time)';
  }

  // Quick Time (DAFPAM 3.11.4): two more steps in double time, then quick time.
  cmdQuickTime(cmd) {
    if (!this.doubleTime) return 'The flight is already in quick time.';
    this.pending = { at: this.stepsAfterCommand(2), action: () => { this.doubleTime = false; } };
    return 'OK:' + cmd.say + ' (two more double-time steps, then quick time)';
  }

  // COVER (DAFPAM 4.4.2): everyone except the guide takes small choppy steps
  // to re-establish dress, cover, interval and distance.
  cmdCover(cmd) {
    if (this.marching) return cmd.say + ' is given at the halt.';
    this.needCover = false;
    this.covering = true;
    return 'OK:' + cmd.say + ' (the flight re-establishes dress, cover, interval and distance)';
  }

  cmdFacing(cmd) {
    if (this.marching) return 'Facing movements are only given at the halt. Halt the flight first.';
    if (this.columnMovementInProgress()) return 'Finish the column movement first (Forward, HARCH).';
    this.marchers().forEach(p => { p.dir = turnDir(p.dir, cmd.turn); });
    this.relocateGuideIfNeeded();
    return 'OK:' + cmd.say;
  }

  cmdAboutFace(cmd) {
    const atFront = this.commanderAtFrontOfLine();
    const r = this.cmdFacing(cmd);
    if (r.startsWith('OK:')) this.commanderStaysOnSide(atFront);
    return r;
  }

  cmdFlank(cmd) {
    if (!this.marching) return cmd.label + ' is given while marching.';
    if (this.halfStep) return cmd.label + ' is not given while half stepping. Command Forward, HARCH first.';
    if (this.columnMovementInProgress()) return 'Wait until the whole flight has finished the column movement.';
    // One more step, then pivot (DAFPAM 3.17)
    const turn = cmd.action === 'toTheRear' ? 2 : cmd.turn;
    this.onNextStep(() => { this.marchers().forEach(p => { p.dir = turnDir(p.dir, turn); }); });
    return 'OK:' + cmd.say;
  }

  // To the Rear (DAFPAM 3.16): a 12-inch step, pivot 180 degrees, a 12-inch step in
  // the new direction, then full steps.
  // From the halt (user's detachment practice): face about and step off, 12-inch first step.
  cmdToTheRear(cmd) {
    if (!this.marching) {
      if (this.columnMovementInProgress()) return 'Finish the column movement first.';
      const atFront = this.commanderAtFrontOfLine();
      this.marchers().forEach(p => { p.dir = turnDir(p.dir, 2); });
      this.relocateGuideIfNeeded();
      this.commanderStaysOnSide(atFront);
      this.startMarching();
      this.shortStepUntil = 1;    // 12-inch step in the new direction, then full steps
      return 'OK:' + cmd.say + ' (face about and step off)';
    }
    const r = this.cmdFlank(cmd);
    if (r.startsWith('OK:')) {
      this.commanderStaysOnSide(false);
      this.shortStepUntil = this.pending.at + 1;
    }
    return r;
  }

  // Column Right / Left (DAFPAM 4.11, 90 degrees) and Column Half Right / Left (4.12, 45 degrees).
  // The base file (right file for a turn to the right, left file for a turn to the left)
  // pivots first. Every other file marches a little further, pivots, and comes up abreast.
  // Files on the inside of the turn take half steps until everyone is lined up again.
  //  - Column Right/Left: then the whole flight half steps until Forward, HARCH.
  //  - Column Half Right/Left: the full step resumes on its own once ranks are abreast.
  cmdColumn(cmd) {
    if (cmd.notInvertedColumn && this.formationType() === 'inverted column') {
      return cmd.label + ' cannot be given in inverted column: column movements are made from column (DAFPAM 4.11). ' +
             'Put the element leaders back at the head first: To the Rear, HARCH or Counter, HARCH.';
    }
    const r = this.turnColumn(cmd.turn, { incline: false });
    if (r) return r;
    if (Math.abs(cmd.turn) === 1) {
      this.lastMovement = 'column';
      this.halfStep = true;   // half step after the turn until Forward, HARCH (DAFPAM 4.11)
      return 'OK:' + cmd.say + ' (half step until Forward, HARCH)';
    }
    this.lastMovement = 'columnHalf';
    return 'OK:' + cmd.say + ' (full step resumes once the ranks are abreast)';
  }

  // Incline (DAFPAM 4.12.4, 3.19): the guide moves off in the new direction and the rest
  // follow. No "one more step", no half step afterwards. Allowed at route step / at ease.
  cmdIncline(cmd) {
    if (!this.marching) return cmd.label + ' is given while marching.';
    const r = this.turnColumn(cmd.turn, { incline: true });
    if (r) return r;
    return 'OK:' + cmd.say;
  }

  // The shared turning movement for columns and inclines. Returns an error message, or null if it started.
  turnColumn(quarterTurns, { incline }) {
    if (this.columnMovementInProgress()) return 'Wait until the whole flight has finished the column movement.';
    if (this.halfStep) return 'Changes of direction are not made from the half step (DAFPAM 3.13.3). Command Forward, HARCH first.';
    const type = this.formationType();
    if (type !== 'column' && type !== 'inverted column') {
      return 'Column movements and inclines are given when the flight is in column. Face the flight into column first.';
    }
    const h = this.mainDir();
    const newDir = turnDir(h, quarterTurns);
    const guide = this.guide;

    // Each element is a file. The guide marches with the file it is lined up with.
    const files = this.elements.map(el => [...el]);
    const fileB = files.map(f => bOf(f[0], h));
    let guideFile = 0;
    fileB.forEach((b, k) => { if (Math.abs(b - bOf(guide, h)) < Math.abs(fileB[guideFile] - bOf(guide, h))) guideFile = k; });
    files[guideFile].push(guide);

    const base = quarterTurns > 0 ? fileB.indexOf(Math.max(...fileB)) : fileB.indexOf(Math.min(...fileB));
    // The base file's leader takes one more step before pivoting (DAFPAM 4.11.1.1, 4.12.1).
    // From the halt: one step forward for Column Right; a face in marching for Column Left
    // and for Column Half Right/Left (4.11.4, 4.12.3). Inclines have no extra step.
    let oneMoreStep;
    if (incline) oneMoreStep = 0;
    else if (!this.marching) oneMoreStep = (quarterTurns === 1 ? STEP_PX : 0);
    else oneMoreStep = this.halfStep ? STEP_PX / 2 : STEP_PX;
    const baseFront = Math.max(...files[base].map(p => aOf(p, h))) + oneMoreStep;

    // Outer files pivot a little further forward so the interval stays the same after the
    // turn: sideways distance x tan(half the turn angle) (= sideways for 90, x 0.414 for 45).
    const lead = Math.tan(Math.abs(quarterTurns) * Math.PI / 4);
    const plans = files.map((f, k) => {
      const sideways = Math.abs(fileB[k] - fileB[base]);
      const pivot = toXY(baseFront + sideways * lead, fileB[k], h);
      pivot.dir = newDir;
      const toPivot = aOf(pivot, h) - aOf(f[0], h);
      const along = aOf(pivot, newDir) - toPivot;   // where this file ends up along the new direction
      return { f, pivot, along };
    });
    const furthestBack = Math.min(...plans.map(p => p.along));
    plans.forEach(({ f, pivot, along }) => {
      const group = { remaining: along - furthestBack };  // distance to make up by half stepping
      f.forEach(p => { p.turns.push({ ...pivot }); p.group = group; });
    });

    this.startMarching();
    return null;
  }

  // Close, HARCH / Extend, HARCH (DAFPAM 4.10). In column, at the halt or at quick time.
  // The right file (the "fourth element") is the base and stands fast / half steps; the other
  // files move toward it (Close) or away from it (Extend) until the new interval is reached.
  //  - Halted: 12-inch right (left) steps, all together (4.10.1, 4.10.3).
  //  - Marching: pivot 45 degrees toward (away from) the base, march over, pivot back; the
  //    base half steps; then everyone half steps until Forward, HARCH (4.10.2, 4.10.4).
  cmdInterval(cmd) {
    const close = cmd.close;
    if (this.formationType() !== 'column') return cmd.say + ' is given with the flight in column.';
    if (this.closeInterval === close) return 'The flight is already at ' + (close ? 'close' : 'normal') + ' interval.';
    if (this.columnMovementInProgress()) return 'Wait until the whole flight has finished the current movement.';
    if (this.marching && (this.halfStep || this.markTime || this.doubleTime)) {
      return cmd.say + ' is given at the halt or at quick time with a full step. Command Forward, HARCH first.';
    }
    const h = this.mainDir();
    const files = this.elements.map(el => [...el]).sort((f, g) => bOf(g[0], h) - bOf(f[0], h));   // right to left
    const fileB = files.map(f => bOf(f[0], h));
    let guideFile = 0;
    fileB.forEach((b, k) => { if (Math.abs(b - bOf(this.guide, h)) < Math.abs(fileB[guideFile] - bOf(this.guide, h))) guideFile = k; });
    files[guideFile].push(this.guide);
    const change = INTERVAL_PX - CLOSE_INTERVAL_PX;            // per file
    const toward = DIRS[turnDir(h, close ? 1 : -1)];           // close: to the right; extend: to the left

    if (!this.marching) {
      // Side steps at the halt: file k (counting from the right) moves k x change
      files.forEach((f, k) => f.forEach(p => {
        if (k > 0) this.slides.push({ p, ux: toward.x, uy: toward.y, remaining: k * change });
      }));
      this.closeInterval = close;
      return 'OK:' + cmd.say + ' (' + (close ? 'right' : 'left') + ' steps)';
    }

    // Marching: two pivots per moving file, then catch up and half step
    const diagDir = turnDir(h, close ? 0.5 : -0.5);
    const plans = files.map((f, k) => {
      const shift = k * change;
      const leaderA = aOf(f[0], h);
      if (k === 0) return { f, turns: [], along: leaderA };     // base file: straight on
      const a1 = Math.max(...f.map(p => aOf(p, h))) + STEP_PX;  // one more step, then pivot
      const b1 = fileB[k];
      const t1 = toXY(a1, b1, h); t1.dir = diagDir;
      const sideways = close ? shift : -shift;
      const t2 = toXY(a1 + shift, b1 + sideways, h); t2.dir = h;
      const path = (a1 - leaderA) + shift * Math.SQRT2;
      return { f, turns: [t1, t2], along: a1 + shift - path };
    });
    const furthestBack = Math.min(...plans.map(pl => pl.along));
    plans.forEach(({ f, turns, along }) => {
      const group = { remaining: along - furthestBack };
      f.forEach(p => { turns.forEach(t => p.turns.push({ ...t })); p.group = group; });
    });
    this.closeInterval = close;
    this.lastMovement = 'interval';
    this.halfStep = true;   // half step once the interval is obtained, until Forward, HARCH (4.10.2)
    return 'OK:' + cmd.say + ' (half step until Forward, HARCH)';
  }

  // Right Step / Left Step, HARCH (DAFPAM 3.14): from the halt only. 12-inch steps to the side
  // (step out, then close the other foot: one 12-inch step every two counts) until Flight, HALT.
  cmdSideStep(cmd) {
    if (this.marching) return cmd.label + ' is given only from the halt.';
    if (this.columnMovementInProgress()) return 'Wait until the whole flight has finished the current movement.';
    const d = DIRS[turnDir(this.mainDir(), cmd.turn)];
    this.startMarching();
    this.sideStep = { x: d.x, y: d.y };
    return 'OK:' + cmd.say + ' (until Flight, HALT)';
  }

  // GUIDE RIGHT (detachment troop-walk procedure, user's design): on a sidewalk, the flight
  // slides sideways (12-inch side steps, while marching or at the halt) until the guide's file
  // is along the RIGHT edge of the sidewalk. The map tells us where the edge is (opts.sidewalkEdge).
  cmdTroopWalkEdge(cmd) {
    if (!this.opts.sidewalkEdge) return cmd.say + ' needs a sidewalk; use it on the campus map.';
    const type = this.formationType();
    if (type !== 'column' && type !== 'inverted column') return cmd.say + ' is given with the flight in column.';
    if (this.columnMovementInProgress()) return 'Wait until the whole flight has finished the current movement.';
    if (this.sideStep || this.markTime || this.routeStep) return cmd.say + ' is given at the halt or while marching at attention.';
    const h = this.mainDir();
    const shift = this.opts.sidewalkEdge(this.guide.x, this.guide.y, h);   // + = to the right
    if (shift === null) return 'The guide is not on a sidewalk running this way. March onto the sidewalk first.';
    if (Math.abs(shift) < 3) return 'The guide is already along the right edge of the sidewalk.';
    const d = DIRS[turnDir(h, shift > 0 ? 1 : -1)];
    this.marchers().forEach(p => this.slides.push({ p, ux: d.x, uy: d.y, remaining: Math.abs(shift) }));
    return 'OK:' + cmd.say + ' (sliding ' + (shift > 0 ? 'right' : 'left') + ' to the edge of the sidewalk)';
  }

  // Change Step (DAFPAM 3.15), given on the RIGHT foot. Everyone takes one more step
  // with the left foot, brings the right foot up to the left heel, and steps off again
  // with the left: the left foot strikes twice in a row, so the step changes.
  cmdChangeStep(cmd) {
    if (!this.marching) return cmd.label + ' is given while marching.';
    if (this.changeStepAt !== null) return 'The flight is already changing step.';
    this.changeStepAt = Math.ceil(this.stepsAfterCommand(2));
    return 'OK:' + cmd.say;
  }

  // Route Step (DAFPAM 3.19.1). Cadets keep marching but don't have to stay in step.
  // Only Flight, Ten-HUT may be given until the flight is back at attention.
  // At Ease, MARCH (3.19.2) works the same way, but in silence.
  cmdRouteStep(cmd) {
    if (!this.marching) return cmd.label + ' is given while marching.';
    if (this.routeStep) return 'The flight is already ' + this.routeStepPhrase() + '.';
    if (this.halfStep) return cmd.label + ' is given from quick time. Command Forward, HARCH first.';
    if (this.columnMovementInProgress()) return 'Wait until the whole flight has finished the column movement.';
    this.changeStepAt = null;
    this.routeStepKind = cmd.variant || 'ROUTE STEP';
    this.onNextStep(() => { this.routeStep = true; });   // one more step, then route step (3.19.1)
    return 'OK:' + cmd.say + ' (only inclines and Flight, Ten-HUT can be given now)';
  }

  routeStepPhrase() { return this.routeStepKind === 'AT EASE' ? 'at ease' : 'at route step'; }

  // Flight, Ten-HUT: back to attention from route step.
  // Flight, Ten-HUT: from parade rest at the halt (3.3.2), or from route step / at ease (3.19)
  cmdAttention(cmd) {
    if (!this.marching && this.posture === 'paradeRest') { this.posture = 'attention'; return 'OK:' + cmd.say; }
    if (!this.routeStep) return 'The flight is already at attention.';
    this.routeStep = false;
    return 'OK:' + cmd.say;
  }

  // ---------- Road guards (detachment SOP; see DRILL.roadGuards) ----------
  // The intersection the halted flight is in front of (guide within the approach distance), or null
  intersectionAhead() {
    const g = this.guide, f = DIRS[this.mainDir()];
    let best = null, bd = Infinity;
    this.intersections.forEach(ix => {
      const d = Math.hypot(g.x - ix.x, g.y - ix.y);
      const ahead = (ix.x - g.x) * f.x + (ix.y - g.y) * f.y > -ix.r;
      if (ahead && d < ix.r + DRILL.roadGuards.approachPx && d < bd) { bd = d; best = ix; }
    });
    return best;
  }

  cmdRoadGuardsOut(cmd) {
    const R = DRILL.roadGuards;
    if (this.roadGuards) return 'The road guards are already out.';
    if (this.marching) return 'Halt the flight before the intersection first, then command Road Guards, OUT.';
    const ix = this.intersectionAhead();
    if (!ix) return 'There is no intersection ahead of the flight to guard.';
    if (this.marchers().length <= R.requiredAbove) return 'With 8 or fewer the flight commander acts as road guard (AFROTCI 36-2011 Vol 1).';
    // Who: last rank, outside files (+ the middle file for a third guard)
    const els = this.elements, count = els.length >= 4 ? Math.max(R.count, 3) : R.count;
    const files = [0, els.length - 1, Math.floor(els.length / 2)].slice(0, count);
    const guards = files.map(e => els[e][els[e].length - 1]);
    // Where: each side of the crossing (perpendicular to the flight's march), a third one on the far side
    const h = this.mainDir(), u = DIRS[h], r = DIRS[turnDir(h, 1)], reach = Math.max(ix.r - R.postPastEdgePx, ix.r * 0.6);
    const posts = [
      { x: ix.x - r.x * reach, y: ix.y - r.y * reach, dir: turnDir(h, -1) },   // left side, facing that traffic
      { x: ix.x + r.x * reach, y: ix.y + r.y * reach, dir: turnDir(h, 1) },    // right side
      { x: ix.x + u.x * reach, y: ix.y + u.y * reach, dir: h },                // far side
    ];
    guards.forEach((p, i) => { p.roadGuard = { post: posts[i] }; p.atPost = false; });
    this.roadGuards = { ix, guards, crossed: false, cleared: false };
    this.cdrHold = { x: ix.x - u.x * 30, y: ix.y - u.y * 30, dir: turnDir(h, 2) };   // the middle, facing the flight
    this.log('road-guards', { event: 'out', name: ix.name, count: guards.length });
    return 'OK:' + cmd.say + ' (' + guards.length + ' road guards to ' + ix.name + ')';
  }

  cmdRoadGuardsIn(cmd) {
    const rg = this.roadGuards;
    if (!rg) return 'No road guards are out.';
    if (rg.guards.some(g => g.roadGuard.back)) return 'The road guards are already returning.';
    if (!rg.crossed || !rg.cleared) return 'The flight has not passed ' + rg.ix.name + ' yet. Road Guards, IN once it has.';
    rg.guards.forEach(g => { g.roadGuard.back = true; g.atPost = false; });
    this.cdrHold = null;                           // the commander marches back to post
    this.log('road-guards', { event: 'in', name: rg.ix.name });
    return 'OK:' + cmd.say;
  }

  // Road guards run out to their posts, and back to their places in the flight
  moveRoadGuards(dt) {
    const rg = this.roadGuards, run = DRILL.roadGuards.runSpeedPx * dt;
    rg.guards.forEach(g => {
      if (!g.roadGuard) return;
      if (!g.roadGuard.back) {
        if (!g.atPost && walkToward(g, g.roadGuard.post, run)) { g.atPost = true; g.dir = g.roadGuard.post.dir; }
        return;
      }
      // back to the place behind the person ahead of them in their file
      const el = this.elements.find(e => e.includes(g)), i = el.indexOf(g), ahead = el[i - 1];
      const spot = { x: ahead.x - DIRS[ahead.dir].x * DISTANCE_PX, y: ahead.y - DIRS[ahead.dir].y * DISTANCE_PX };
      if (walkToward(g, spot, run + (this.marching ? STEP_PX * dt / this.stepSeconds : 0))) {
        g.roadGuard = null; g.dir = ahead.dir; g.turns = []; g.group = null;
      }
    });
    if (rg.guards.every(g => !g.roadGuard)) {
      this.roadGuards = null;
      this.log('road-guards', { event: 'back', name: rg.ix.name });
      this.feedback('Road guards are back in the flight.', 'info');
    }
  }

  // Parade, HEST (3.3.1.1): only from attention at the halt
  cmdParadeRest(cmd) {
    if (this.marching) return 'Parade Rest is given at the halt. Halt the flight first.';
    if (this.columnMovementInProgress()) return 'Finish the column movement first.';
    this.posture = 'paradeRest';
    return 'OK:' + cmd.say;
  }

  // Pre-sent, HARMS / Or-der, HARMS (3.7): first and second count of the hand salute, at the halt
  cmdPresentArms(cmd) {
    if (this.marching) return 'Present Arms is given at the halt. Halt the flight first.';
    this.posture = 'presentArms';
    return 'OK:' + cmd.say;
  }
  cmdOrderArms(cmd) {
    if (this.posture !== 'presentArms') return 'Or-der, HARMS follows Pre-sent, HARMS (DAFPAM 3.7).';
    this.posture = 'attention';
    return 'OK:' + cmd.say;
  }

  // Counter March (DAFPAM 4.16), given on the LEFT foot. Each element loops around so the
  // flight reverses direction inside its own space. The element that has to cross furthest
  // turns furthest forward (for 4 elements: 1st = 4 steps, 4th = 3, 2nd = 2, 3rd = 1), so
  // no paths cross. Each element comes back down half an interval to the side, between the
  // original files. Then the flight half steps until Forward, HARCH.
  cmdCounterMarch(cmd) {
    if (this.columnMovementInProgress()) return 'Wait until the whole flight has finished the current movement.';
    if (this.halfStep) return 'Changes of direction are not made from the half step (DAFPAM 3.13.3). Command Forward, HARCH first.';
    if (this.formationType() !== 'column') return cmd.say + ' is given with the flight in column (element leaders in front).';
    const h = this.mainDir();
    const back = turnDir(h, 2);
    const guide = this.guide;

    // Files from left to right, with the guide in the file it is lined up with
    const files = this.elements.map(el => [...el]).sort((f, g) => bOf(f[0], h) - bOf(g[0], h));
    const fileB = files.map(f => bOf(f[0], h));
    let guideFile = 0;
    fileB.forEach((b, k) => { if (Math.abs(b - bOf(guide, h)) < Math.abs(fileB[guideFile] - bOf(guide, h))) guideFile = k; });
    files[guideFile].push(guide);

    const N = files.length;
    const leftB = Math.min(...fileB);
    // From the halt each element leader takes one extra pace first (DAFPAM 4.16.2)
    const front = Math.max(...this.marchers().map(p => aOf(p, h))) + (this.marching ? 0 : STEP_PX);
    const lanes = files.map((_, e) => leftB + (N - 1 - e + 0.5) * this.interval());   // where each file comes back down
    const spans = files.map((_, e) => Math.abs(lanes[e] - fileB[e]));
    const order = spans.map((_, e) => e).sort((i, j) => spans[i] - spans[j]);
    const steps = [];
    order.forEach((e, rank) => { steps[e] = (rank + 1) * STEP_PX; });

    const plans = files.map((f, e) => {
      const sideDir = turnDir(h, lanes[e] > fileB[e] ? 1 : -1);   // pivot right or left
      const a = front + steps[e];
      const p1 = toXY(a, fileB[e], h); p1.dir = sideDir;
      const p2 = toXY(a, lanes[e], h); p2.dir = back;
      const pathToP2 = (a - aOf(f[0], h)) + spans[e];
      return { f, p1, p2, along: aOf(p2, back) - pathToP2 };
    });
    const furthestBack = Math.min(...plans.map(p => p.along));
    plans.forEach(({ f, p1, p2, along }) => {
      const group = { remaining: along - furthestBack };   // half step until abreast
      f.forEach(p => { p.turns.push({ ...p1 }, { ...p2 }); p.group = group; });
    });

    this.startMarching();
    this.lastMovement = 'counter';
    this.halfStep = true;
    this.commanderStaysOnSide(false);   // commander stays on the same physical side
    return 'OK:' + cmd.say + ' (half step until Forward, HARCH)';
  }

  // ---------- Giving a command ----------
  // options: { voice: true, ageSeconds } for spoken commands (see voice.js)
  giveCommand(text, options = {}) {
    let cleaned = cleanUpCommand(text, options.voice);
    if (!cleaned) return;
    const stepSecNow = this.doubleTime ? this.doubleStepSeconds : this.stepSeconds;
    const saidStep = age => this.marching ? this.realSteps() - (age || 0) / stepSecNow : null;
    // When the preparatory command was said (cadence position), if known
    let prepStep = options.prepAgeSeconds !== undefined && options.prepAgeSeconds !== null ? saidStep(options.prepAgeSeconds) : null;

    // 0. Two-part commands: the preparatory command on its own ("Right Flank"), then the command
    //    of execution ("HARCH") within a few seconds. Both moments are graded (DAFPAM 3.9.2).
    if (this.heldPrep && this.clock - this.heldPrep.clock > DRILL.preparatory.holdSeconds) this.heldPrep = null;
    if (this.heldPrep) {                         // ("HALT" alone is a command too: join it to a held "Flight")
      const joined = cleanUpCommand(this.heldPrep.text + ' ' + text, options.voice);
      if (COMMANDS_BY_KEY[joined]) {
        text = this.heldPrep.text.trim() + ', ' + text.trim();
        cleaned = joined;
        prepStep = this.heldPrep.step;
      }
    }
    this.heldPrep = null;
    if (isPreparatoryOnly(cleaned) && !(this.needCover && cleaned !== DRILL.preparatory.unitWord)) {
      this.heldPrep = { text, clock: this.clock, step: saidStep(options.ageSeconds) };
      this.feedback('… ' + text.trim() + ' (preparatory command). Now the command of execution.', 'info');
      this.log('preparatory', { text });
      return;
    }

    // 1. After every halt, the next command must be COVER.
    if (this.needCover && letterDifference(cleaned, 'cover') > 1) {
      this.reject(text, null, '"Flight, HALT... what?" After a halt, command COVER.');
      return;
    }

    // 2. Teach the correct inflection instead of accepting MARCH / FACE / ATTENTION.
    for (const r of DRILL.rejectedWords) {
      if (new RegExp('\\b' + r.word + '\\b').test(cleaned)) {
        this.reject(text, null, r.fix);
        return;
      }
    }

    // 3. Find the command. A command with a letter or two wrong is still carried out,
    //    but sloppily (the cadets aren't sure what they heard).
    let cmd = COMMANDS_BY_KEY[cleaned], wrongLetters = 0;
    if (!cmd) {
      let best = null, bestDiff = Infinity;
      const digits = t => (t.match(/\d+/g) || []).join(' ');   // numbers must match exactly (45 vs 90)
      DRILL.commands.filter(c => digits(c.key) === digits(cleaned)).forEach(c => {
        const diff = letterDifference(cleaned, c.key);
        if (diff < bestDiff) { best = c; bestDiff = diff; }
      });
      const allowed = best && best.key.length >= 8 ? 2 : 1;
      if (best && bestDiff <= allowed) { cmd = best; wrongLetters = bestDiff; }
      else {
        this.feedback('"' + text + '" is not a command I know. Check the list on the right.', false);
        this.log('command-rejected', { text, key: null, reason: 'unknown command' });
        return;
      }
    }

    // At route step / at ease the only commands allowed are inclines and Flight, Ten-HUT (DAFPAM 3.19).
    if (this.routeStep && !cmd.routeStepOk) {
      this.reject(text, cmd.key, 'The flight is ' + this.routeStepPhrase() +
                    '. Only inclines can be given; call it to attention first: Flight, Ten-HUT.');
      return;
    }

    // In double time only inclines, Quick Time and HALT may be given (DAFPAM 3.11.6).
    if (this.doubleTime && !cmd.doubleTimeOk) {
      this.reject(text, cmd.key, 'In double time only inclines, Quick Time, HARCH and Flight, HALT can be given.');
      return;
    }
    // While side stepping: only Flight, HALT (DAFPAM 3.14.3).
    if (this.sideStep && !cmd.sideStepOk) {
      this.reject(text, cmd.key, 'The flight is side stepping. Only Flight, HALT can be given.');
      return;
    }
    // While marking time: Forward, HARCH or Flight, HALT.
    // Road guards out: march straight through the intersection (SOP)
    if (this.roadGuards && !DRILL.roadGuards.allowedWhileOut.includes(cmd.action)) {
      this.reject(text, cmd.key, 'Road guards are out: march the flight straight through the intersection, then Road Guards, IN.');
      return;
    }
    // Parade rest: only Flight, Ten-HUT (3.3.2). Present arms: only Order, HARMS (3.7).
    if (this.posture === 'paradeRest' && cmd.action !== 'attention') {
      this.reject(text, cmd.key, 'The flight is at parade rest. Call it to attention first: Flight, Ten-HUT (DAFPAM 3.3.2).');
      return;
    }
    if (this.posture === 'presentArms' && cmd.action !== 'orderArms') {
      this.reject(text, cmd.key, 'The flight is at present arms. Command Or-der, HARMS first (DAFPAM 3.7).');
      return;
    }
    if (this.markTime && !cmd.markTimeOk) {
      this.reject(text, cmd.key, 'The flight is marking time. Command Forward, HARCH (left foot) or Flight, HALT.');
      return;
    }

    // The flight is still taking its "one more step" for the last command.
    if (this.pending || this.haltAt !== null || this.slides.length) {
      this.reject(text, cmd.key, 'Wait a step: the flight is still carrying out the last command.');
      return;
    }

    // 4. Timing: while marching in step, was it given as the correct heel struck the ground?
    const foot = this.marching && !this.routeStep ? cmd.foot : null;
    const timing = this.timingError(foot, options.ageSeconds || 0);
    const stepSec = this.doubleTime ? this.doubleStepSeconds : this.stepSeconds;
    const execStep = saidStep(options.ageSeconds);
    const prepIssue = foot && prepStep !== null && !options.deferTiming ? prepTimingProblem(prepStep, execStep, foot) : null;
    this.commandAt = this.realSteps() - (options.ageSeconds || 0) / stepSec;   // when it was really given

    this.finishGuideMove();
    this.cdrStayPut = false;
    const estimatedStep = this.commandStep();
    const result = this.runAction(cmd);
    this.commandAt = undefined;   // later, delayed steps count from their own moment
    if (!result.startsWith('OK:')) {
      this.reject(text, cmd.key, result);
      this.reportStatus();
      return;
    }

    // 5. Sloppy timing or wording makes the flight ragged.
    //    (deferTiming: the offline recognizer will report the exact timing later; see judgeTiming)
    const name = result.slice(3);
    const problems = [];
    let drift = 0;
    const timingIssue = options.deferTiming ? null : this.timingProblem(timing, foot);
    if (timingIssue) { drift += timingIssue.drift; problems.push(timingIssue.text); }
    if (wrongLetters > 0) {
      drift += wrongLetters * SLOPPY_WORD_DRIFT;
      problems.push('sloppy wording ("' + text.trim() + '")');
    }
    if (prepIssue) problems.push(prepIssue.text);   // graded, but the flight still executes cleanly
    const isCover = cmd.action === 'cover';
    if (!isCover) this.addDisorder(drift);

    const ragged = isCover || drift === 0 ? '' : ' The flight is getting ragged.';
    if (problems.length) this.feedback('⚠ ' + name + ' — ' + problems.join('; ') + '.' + ragged, 'warn');
    else this.feedback('✔ ' + name, true);
    const id = ++this.commandSeq;
    this.log('command', { id, text, key: cmd.key, name: cmd.say, action: cmd.action, voice: !!options.voice,
                          foot, timingError: options.deferTiming ? null : Math.round(timing * 100) / 100,
                          timingProblem: timingIssue ? timingIssue.text : null,
                          prepGiven: prepStep !== null, prepProblem: prepIssue ? prepIssue.text : null,
                          prepGap: prepStep !== null && execStep !== null ? Math.round((execStep - prepStep) * 100) / 100 : null,
                          wrongLetters, problems, deferredTiming: !!options.deferTiming,
                          formation: this.formationType(), marching: this.marching });
    this.reportStatus();
    if (!options.deferTiming) return null;
    return {    // handle for judgeTiming
      id, name, foot, action: cmd.action, stepAtGive: this.realSteps(),
      stepSec: this.doubleTime ? this.doubleStepSeconds : this.stepSeconds,
      pending: this.pending, pendingOffset: this.pending ? Math.round(this.pending.at) - estimatedStep : 0,
    };
  }

  // ---------- Moving each frame (call from the scene's update) ----------
  update(dt) {
    this.clock += dt;
    let dSteps = 0;   // steps taken this frame (double time = more steps per second)
    if (this.marching) {
      dSteps = dt / (this.doubleTime ? this.doubleStepSeconds : this.stepSeconds);
      this.stepCount += dSteps;
      // Change Step finished: make the one-step shift permanent
      if (this.changeStepAt !== null && Math.floor(this.stepCount) >= this.changeStepAt) {
        this.stepShift += 1;
        this.changeStepAt = null;
      }
      const steps = this.realSteps();
      // "One more step" is done: carry out the movement
      if (this.pending && steps >= this.pending.at) {
        const action = this.pending.action;
        this.pending = null;
        action();
        this.log('movement', {});
      }
      // Halt, count two: trailing foot alongside, and the flight is halted
      if (this.haltAt !== null && steps >= this.haltAt) {
        this.stop();
        this.log('halted', {});
        this.feedback('Flight halted. Command COVER.', true);
      }
      if (this.shortStepUntil !== null && steps >= this.shortStepUntil) this.shortStepUntil = null;
    }

    if (this.marching && this.haltAt === null) {   // no forward movement while bringing the trailing foot up
      const fullStep = (this.doubleTime ? DOUBLE_TIME_STEP_PX : STEP_PX) * dSteps;
      // During a column movement, files that are ahead half step until the others are abreast.
      // Once everyone is abreast, the whole flight half steps until Forward, HARCH.
      // To the Rear uses two 12-inch steps around the pivot.
      const catchingUp = this.marchers().some(p => p.group && p.group.remaining > 0);
      const shortStep = (this.halfStep && !catchingUp) || this.shortStepUntil !== null;
      const normalStep = (this.markTime || this.sideStep) ? 0 : shortStep ? fullStep / 2 : fullStep;   // in place
      const groupMove = new Map();
      this.marchers().forEach(p => {
        let dist = normalStep;
        if (p.group && (groupMove.has(p.group) || p.group.remaining > 0)) {
          if (!groupMove.has(p.group)) {     // half step: lose half of each step until caught up
            const lost = Math.min(p.group.remaining, fullStep / 2);
            p.group.remaining -= lost;
            groupMove.set(p.group, fullStep - lost);
          }
          dist = groupMove.get(p.group);
        }
        if (p === this.guide && p.target) return;   // guide is walking to a new post (see below)
        if (p.roadGuard) return;                     // road guards are out of the ranks (see moveRoadGuards)
        moveAlongPath(p, dist);
        if (this.sideStep) {                         // Right/Left Step: 12 inches every two counts
          p.x += this.sideStep.x * RIGHT_STEP_PX / 2 * dSteps;
          p.y += this.sideStep.y * RIGHT_STEP_PX / 2 * dSteps;
        }
      });

      const b = this.opts.bounds;
      if (this.inRanks().some(p => p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1)) {
        this.stop();
        this.log('out-of-bounds', { area: this.opts.areaName });
        this.feedback('✘ The flight reached the edge of the ' + this.opts.areaName +
                      ' and stopped. Turn it before marching again.', false);
      } else if (this.opts.obstacleAt) {
        // Look half a step ahead of each person for a building
        for (const p of this.inRanks()) {
          const d = DIRS[p.dir];
          const hit = this.opts.obstacleAt(p.x + d.x * STEP_PX / 2, p.y + d.y * STEP_PX / 2);
          if (hit) {
            this.stop();
            this.log('obstacle', { name: hit });
            this.feedback('✘ The flight marched into ' + hit + ' and stopped. Turn it before marching again.', false);
            break;
          }
        }
      }
    }

    if (!this.columnMovementInProgress()) this.marchers().forEach(p => { p.group = null; });

    if (this.opts.stairsAt) this.checkStairs();
    if (this.intersections.length) this.trackIntersections();

    // Natural drift: real cadets slowly wander out of position while marching
    if (this.marching && this.disorderLevel > 0) {
      const rate = NATURAL_DRIFT * this.disorderLevel / this.stepSeconds;   // units per second
      this.members().forEach(p => {
        if (!p.drift || Math.random() < dt * 0.5) {
          const a = Math.random() * Math.PI * 2;
          p.drift = { x: Math.cos(a), y: Math.sin(a) };
        }
        p.off.x += p.drift.x * rate * dt;
        p.off.y += p.drift.y * rate * dt;
        this.clampDrift(p);
      });
    }

    // COVER: small choppy steps back into the proper spot
    if (this.covering) {
      let done = true;
      this.members().forEach(p => {
        const d = Math.hypot(p.off.x, p.off.y);
        const move = COVER_SPEED * dt;
        if (d <= move) { p.off.x = 0; p.off.y = 0; }
        else { p.off.x -= p.off.x / d * move; p.off.y -= p.off.y / d * move; done = false; }
        p.rot = Math.abs(p.rot) <= dt ? 0 : p.rot - Math.sign(p.rot) * dt;
        if (p.rot !== 0) done = false;
      });
      if (done) this.covering = false;
    }

    // Side steps at the halt (Close/Extend, HARCH): 12-inch steps in cadence
    if (this.slides.length) {
      const move = RIGHT_STEP_PX * dt / this.stepSeconds;
      this.slides = this.slides.filter(sl => {
        const d = Math.min(move, sl.remaining);
        sl.p.x += sl.ux * d; sl.p.y += sl.uy * d; sl.remaining -= d;
        return sl.remaining > 0.01;
      });
    }

    if (this.guide.target && walkToward(this.guide, this.guide.target, WALK_SPEED * dt)) this.finishGuideMove();
    if (this.roadGuards) this.moveRoadGuards(dt);
    const post = this.commanderPost();
    const cdr = this.commander;
    if (walkToward(cdr, this.routeAround(cdr, post), WALK_SPEED * dt) &&
        cdr.x === post.x && cdr.y === post.y) cdr.dir = post.dir;

    this.reportStatus();
  }

  // Stairs must be taken at route step (user's rule). Marching onto them at attention is a
  // mistake: the flight gets ragged and the commander gets a correction (once per set of stairs).
  checkStairs() {
    let stairs = null;
    if (this.marching) {
      for (const p of this.marchers()) { stairs = this.opts.stairsAt(p.x, p.y); if (stairs) break; }
    }
    if (stairs && !this.onStairs) this.log('stairs', { name: stairs, atAttention: !this.routeStep });
    if (stairs && !this.onStairs && !this.routeStep) {
      this.addDisorder(STAIRS_DRIFT);
      this.feedback('⚠ The flight marched onto ' + stairs + ' at attention. Command Route Step, HARCH before stairs.', 'warn');
    }
    this.onStairs = !!stairs;
  }

  // ROAD GUARD FOUNDATION: notice when the flight approaches, is crossing, and has cleared an
  // intersection, and report it (status line + options.onIntersection). The road-guard
  // procedure itself will be built on these events once the detachment's SOP is available.
  //   approaching: the guide is within DRILL.roadGuards.approachPx and heading toward it
  //   crossing:    anyone in the flight is inside the intersection
  //   cleared:     the whole flight is out of it again
  trackIntersections() {
    const f = DIRS[this.mainDir()], g = this.guide;
    this.intersections.forEach(ix => {
      const crossing = this.inRanks().some(p => Math.hypot(p.x - ix.x, p.y - ix.y) < ix.r);
      const ahead = (ix.x - g.x) * f.x + (ix.y - g.y) * f.y > 0;
      const near = Math.hypot(g.x - ix.x, g.y - ix.y) < ix.r + DRILL.roadGuards.approachPx;
      const state = crossing ? 'crossing' : (this.marching && ahead && near) ? 'approaching' : null;
      if (state === ix.state) return;
      const wasActive = ix.state !== null;
      ix.state = state;
      const event = state || (wasActive ? 'cleared' : null);
      if (event) this.log('intersection', { event, name: ix.name });
      // Road guards (SOP): required for flights larger than 8 (Vol 1)
      const rg = this.roadGuards;
      if (event === 'crossing' && rg && rg.ix === ix) rg.crossed = true;
      if (event === 'cleared' && rg && rg.ix === ix) { rg.cleared = true; this.feedback('The flight has passed ' + ix.name + '. Command Road Guards, IN.', 'info'); }
      if (event === 'crossing' && this.marchers().length > DRILL.roadGuards.requiredAbove &&
          !(rg && rg.ix === ix && rg.guards.every(g => g.atPost))) {
        this.log('no-road-guards', { name: ix.name });
        this.feedback('⚠ The flight crossed ' + ix.name + ' without road guards posted. Halt before the intersection and command Road Guards, OUT.', 'warn');
      }
      if (event && this.opts.onIntersection) this.opts.onIntersection(event, ix);
    });
  }

  // One line describing the flight, e.g. "Marching — column formation, facing North — alignment: sharp"
  statusText() {
    const what = this.columnMovementInProgress() ? 'column movement in progress' : this.formationType() + ' formation';
    const halting = this.haltAt !== null || (this.pending && this.pending.isHalt);
    const moving = !this.marching ? ({ paradeRest: 'Halted at PARADE REST', presentArms: 'Halted at PRESENT ARMS' }[this.posture] || 'Halted') : halting ? 'Halting' : this.markTime ? 'Marking time' : this.sideStep ? 'Side stepping' : this.doubleTime ? 'Marching (DOUBLE TIME)'
                 : this.routeStep ? 'Marching (' + this.routeStepKind + ')'
                 : this.halfStep ? 'Marching (HALF STEP)' : this.changeStepAt !== null ? 'Marching (CHANGING STEP)' : 'Marching';
    const drift = this.averageDrift();
    const alignment = this.covering ? 'covering...' : drift < 2 ? 'sharp' : drift < 6 ? 'slightly ragged' : 'ragged';
    const ix = this.intersections.find(i => i.state === 'crossing') || this.intersections.find(i => i.state === 'approaching');
    const at = ix ? ' — ' + (ix.state === 'crossing' ? 'crossing ' : 'approaching ') + ix.name : '';
    return moving + ' — ' + what + ', facing ' + DIRS[this.mainDir()].name + ' — alignment: ' + alignment + at;
  }

  reportStatus() { if (this.opts.onStatus) this.opts.onStatus(this.statusText()); }
}
