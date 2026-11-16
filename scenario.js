// =====================================================================
//  scenario.js: the SCENARIO ENGINE (logic only, no Phaser). Runs one scenario from
//  scenarios.js on a flight: timer, drill area (boundary breaks), objectives, win/fail.
//  It reads the flight's event log (FlightLogic.events) and grades it with SCORING.
//    const run = new ScenarioRun(SCENARIOS.practice, flight, { onMistake, onObjective, onEnd });
//    run.update(dt)        // every frame
//    run.finish()          // the commander ends the session (Practice) -> results
//    run.results()         // everything the results/debrief screen shows
//
//  Objective types (see scenarios.js):
//    movement:  { type: 'movement', id, label, keys: ['right flank harch', ...] }
//               done when one of the commands is carried out while the flight is inside the area
//               (a command given while outside does not count and must be redone)
//    cleanStreak: { type: 'cleanStreak', id, label, count: 30 }
//               done when `count` commands in a row are given with no mistake
//  Scenario fields: id, title, mode, map, hints (Practice coach), timer { limitSeconds,
//  startOn: 'first-command'|'open' } or null, objectives [...], endWhenComplete (true: finishes by
//  itself when every objective is done). The map sets run.area (map units) for the drill area.
//  Evaluations (FDE) add: planningSeconds, reportIn / reportOut { say, pattern } (statements the
//  commander must make), timeoutMessage, efficientOrder + efficientNotes (debrief).
//  Stages: 'planning' (place the flight, read the card) -> 'report' (planning time is up: report in)
//          -> 'ready' (reported in; the clock starts at the first drill movement) -> 'drill'.
// =====================================================================

class ScenarioRun {
  constructor(def, flight, callbacks) {
    this.def = def;
    this.flight = flight;
    this.cb = callbacks || {};
    this.lastSeq = flight.eventSeq || 0;       // only events from now on belong to this run
    this.events = [];
    this.elapsed = 0;                           // seconds on the scenario clock (the flight's own clock)
    this.started = !def.timer || def.timer.startOn === 'open';
    this.startClock = flight.clock;
    this.status = 'running';                    // running | complete | timeout | finished
    // Campus scenarios (Live) give positions in meters; everything else in map units
    this.scale = def.map === 'Campus' && typeof CAMPUS !== 'undefined' ? CAMPUS.pxPerMeter : 1;
    const A = def.area;
    this.area = def.areaUnits || (A && def.map === 'Campus' ? { x0: A.x0 * this.scale, y0: A.y0 * this.scale, x1: A.x1 * this.scale, y1: A.y1 * this.scale } : null);
    this.route = def.route ? def.route.map(([x, y]) => ({ x: x * this.scale, y: y * this.scale })) : null;
    this.offRoute = 0;                          // seconds spent off the planned route (Live)
    this.courtesy = null;                       // CourtesyMonitor (Live, set by the campus map)
    this.inArea = true;
    this.boundaryBreaks = 0;
    this.objectives = (def.objectives || []).map(o => ({ ...o, done: false, doneAt: null, attempts: 0 }));
    this.order = [];                            // commands carried out, in order (FDE debrief)
    this.stage = def.reportIn ? (def.planningSeconds ? 'planning' : 'report') : 'drill';
    this.planStart = flight.clock;
    this.planningLeft = def.planningSeconds || 0;
    this.reportedIn = !def.reportIn;
    this.reportedOut = false;
    this.taps = { voice: [], typed: [] };      // timing calibration beats (seconds; + = late)
  }

  // TIMING CALIBRATION: one beat given (voice or Enter). Returns { good, message }.
  calibrationTap(text, options) {
    const f = this.flight, info = f.footInfo(), C = this.def.calibrate;
    if (!info) return { good: 'warn', message: 'Wait until the flight is marking time.' };
    const stepSec = f.stepSeconds;
    const p = info.progress - ((options && options.ageSeconds) || 0) / stepSec;   // raw: no correction applied
    const s = signedTimingAt(p, 'right');
    if (Math.abs(s) > 0.45) return { good: false, message: 'That was nearer the LEFT heel. Give it as the RIGHT heel strikes (needle on the R side).' };
    const kind = options && options.voice ? 'voice' : 'typed', list = this.taps[kind];
    list.push(s * stepSec);
    const late = s * stepSec;
    if (list.length >= C.taps) {
      const sorted = list.slice().sort((a, b) => a - b), mid = sorted[Math.floor(sorted.length / 2)];
      this.calibration = { kind, offset: Math.max(-C.maxOffsetSec, Math.min(C.maxOffsetSec, Math.round(mid * 100) / 100)), beats: list.slice() };
      this.end('complete');
    }
    return { good: true, message: 'Beat ' + list.length + ' / ' + C.taps + ': ' + Math.abs(late).toFixed(2) + ' s ' + (late >= 0 ? 'late' : 'early') };
  }

  setStage(stage) {
    this.stage = stage;
    this.events.push({ type: 'stage', stage, time: this.flight.clock });
    if (this.cb.onStage) this.cb.onStage(stage);
  }

  // Cleaned-up statement text: lower case letters, digits and single spaces
  static clean(text) { return String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  // A statement to the evaluator (report in / report out). Returns null if the text isn't one,
  // otherwise { good, message }.
  statement(text) {
    const d = this.def, t = ScenarioRun.clean(text);
    if (!this.running) return null;
    if (d.reportIn && d.reportIn.pattern.test(t)) {
      if (this.reportedIn) return { good: false, message: 'You have already reported in.' };
      this.reportedIn = true;
      this.events.push({ type: 'report-in', time: this.flight.clock, text });
      this.setStage('ready');
      return { good: true, message: 'Reported in. The ' + formatClock(d.timer.limitSeconds) + ' clock starts at your first drill movement.' };
    }
    if (d.reportOut && d.reportOut.pattern.test(t)) {
      if (!this.reportedIn) return { good: false, message: 'Report in first: "' + d.reportIn.say + '"' };
      this.reportedOut = true;
      this.events.push({ type: 'report-out', time: this.flight.clock, text });
      this.end(this.objectives.every(o => o.done) ? 'complete' : 'reported-out');
      return { good: true, message: 'Reported out.' };
    }
    return null;
  }

  // Why a drill command may not be given right now (null = it may)
  blockCommand() {
    if (!this.running) return 'The evaluation is over.';
    if (this.reportedIn) return null;
    return (this.stage === 'planning' ? 'Planning period: read the drill card and place the flight (click the pad). ' : '') +
           'Report in first: "' + this.def.reportIn.say + '"';
  }

  get running() { return this.status === 'running'; }

  update(dt) {
    if (!this.running) return;
    if (this.stage === 'planning') {
      this.planningLeft = Math.max(0, this.def.planningSeconds - (this.flight.clock - this.planStart));
      if (this.planningLeft <= 0) this.setStage('report');
    }
    if (this.started) this.elapsed = this.flight.clock - this.startClock;
    this.checkArea();
    const fresh = this.flight.events.filter(e => e.seq > this.lastSeq);
    if (fresh.length) this.lastSeq = fresh[fresh.length - 1].seq;
    fresh.forEach(e => this.handle(e));
    const t = this.def.timer;
    if (t && t.limitSeconds && this.started && this.elapsed >= t.limitSeconds) this.end('timeout');
    this.checkCheckpoints(dt);
  }

  // Is every marcher inside the drill area? Count each time the flight breaks the boundary.
  checkArea() {
    if (!this.area) return;
    const a = this.area;
    const inside = this.flight.marchers().every(p => p.x >= a.x0 && p.x <= a.x1 && p.y >= a.y0 && p.y <= a.y1);
    if (this.inArea && !inside) {
      this.boundaryBreaks++;
      this.events.push({ type: 'boundary', time: this.elapsed });
      if (this.cb.onBoundary) this.cb.onBoundary(false);
    } else if (!this.inArea && inside && this.cb.onBoundary) this.cb.onBoundary(true);
    this.inArea = inside;
  }

  // Live: checkpoints in order (the flight's center within r), and time spent off the route
  checkCheckpoints(dt) {
    if (!this.running) return;
    const c = flightCenter(this.flight), S = this.scale;
    const cur = this.objectives.find(o => o.type === 'checkpoint' && !o.done);
    if (cur && Math.hypot(c.x - cur.x * S, c.y - cur.y * S) <= cur.r * S) {
      if (!this.started) { this.started = true; this.startClock = this.flight.clock; }
      cur.done = true; cur.doneAt = this.elapsed;
      if (this.cb.onObjective) this.cb.onObjective(cur);
      if (this.def.endWhenComplete && this.objectives.every(o => o.done)) this.end('complete');
    }
    if (this.route && this.started) {
      let best = Infinity;
      for (let i = 0; i + 1 < this.route.length; i++) {
        best = Math.min(best, distanceToLine(c.x, c.y, [this.route[i].x, this.route[i].y, this.route[i + 1].x, this.route[i + 1].y]));
      }
      if (best > LIVE_SCORING.routeCorridorM * S) this.offRoute += dt;
    }
  }

  // The next checkpoint and how far it is (meters), for the HUD
  nextCheckpoint() {
    const cur = this.objectives.find(o => o.type === 'checkpoint' && !o.done);
    if (!cur) return null;
    const c = flightCenter(this.flight), S = this.scale;
    return { o: cur, meters: Math.hypot(c.x - cur.x * S, c.y - cur.y * S) / S, dx: cur.x * S - c.x, dy: cur.y * S - c.y };
  }

  // Live score: 100 minus penalties (LIVE_SCORING)
  liveScore(res) {
    const ev = type => this.events.filter(e => e.type === type);
    const cs = this.courtesy ? this.courtesy.summary() : { missed: 0, wrong: 0, noSalute: 0 };
    const counts = {
      noRoadGuards: ev('no-road-guards').length, obstacle: ev('obstacle').length,
      stairs: ev('stairs').filter(e => e.atAttention).length,
      courtesyMissed: cs.missed, noSalute: cs.noSalute, courtesyWrong: cs.wrong,
      offRoute: Math.floor(this.offRoute / 10), refused: res.summary.refused, wrongFoot: res.summary.wrongFoot,
    };
    const breakdown = LIVE_SCORING.penalties.map(p => ({ label: p.label, count: counts[p.key] || 0, points: (counts[p.key] || 0) * p.points }))
      .filter(b => b.count);
    const score = Math.max(0, LIVE_SCORING.start - breakdown.reduce((s, b) => s + b.points, 0));
    return { score, breakdown, courtesy: cs, roadGuards: ev('road-guards').filter(e => e.event === 'out').map(e => e.name) };
  }

  handle(e) {
    this.events.push(e);
    const at = () => this.started && typeof e.time === 'number' ? Math.max(0, e.time - this.startClock) : this.elapsed;
    if (e.type === 'command' && !this.started && this.def.timer && this.def.timer.startOn === 'first-command') {
      this.started = true;
      this.startClock = e.time;
      if (this.stage === 'ready') this.setStage('drill');
    }
    if (e.type === 'command') {
      const already = this.objectives.some(o => o.type === 'movement' && o.keys.includes(e.key) && o.done);
      this.order.push({ key: e.key, name: e.name, text: e.text, time: at(), inArea: this.inArea,
                        marching: !!e.step || e.marching, repeat: already });
      this.objectives.filter(o => o.type === 'movement' && o.keys.includes(e.key)).forEach(o => {
        o.attempts++;
        if (o.done) return;
        if (!this.inArea) return;               // out of bounds: does not count (user's FDE rule)
        o.done = true; o.doneAt = at();
        if (this.cb.onObjective) this.cb.onObjective(o);
      });
    }
    // Mistakes (for the Practice coach) and streak objectives use the graded records
    if (e.type === 'command' || e.type === 'command-rejected' || e.type === 'timing-graded') {
      const recs = SCORING.records(this.events);
      const r = e.type === 'timing-graded' ? recs.find(x => x.id === e.commandId) : recs[recs.length - 1];
      if (r && !r.clean && r.timing !== 'pending' && this.cb.onMistake) this.cb.onMistake(r, SCORING.hint(r));
      if (r && r.clean && e.type === 'command' && this.cb.onClean) this.cb.onClean(r);
      const s = SCORING.summary(recs);
      this.objectives.filter(o => o.type === 'cleanStreak' && !o.done).forEach(o => {
        o.progress = s.streak;
        if (s.streak >= o.count) { o.done = true; o.doneAt = at(); if (this.cb.onObjective) this.cb.onObjective(o); }
      });
    }
    if (this.def.endWhenComplete && this.objectives.length && this.objectives.every(o => o.done)) this.end('complete');
  }

  end(status) {
    if (!this.running) return;
    if (this.started) this.elapsed = this.flight.clock - this.startClock;
    this.status = status;
    if (this.cb.onEnd) this.cb.onEnd(this.results());
  }

  // The commander ends the session
  finish() { this.update(0); this.end(this.objectives.length && this.objectives.every(o => o.done) ? 'complete' : 'finished'); }

  // Commands whose movement was already done (repeats) or given out of bounds: "wasted"
  wastedCommands() {
    const seen = new Set();
    return this.order.filter(c => {
      const wasted = seen.has(c.key) || !c.inArea;
      seen.add(c.key);
      return wasted;
    });
  }

  results() {
    const records = SCORING.records(this.events);
    const res = {
      scenario: this.def.id, title: this.def.title, mode: this.def.mode,
      status: this.status, elapsed: this.elapsed,
      limit: this.def.timer ? this.def.timer.limitSeconds : null,
      objectives: this.objectives.map(o => ({ id: o.id, label: o.label, done: o.done, doneAt: o.doneAt,
                                             attempts: o.attempts, progress: o.progress, count: o.count })),
      completed: this.objectives.filter(o => o.done).length,
      boundaryBreaks: this.boundaryBreaks,
      order: this.order,
      wasted: this.wastedCommands().length,
      records,
      summary: SCORING.summary(records),
      reportedIn: this.reportedIn, reportedOut: this.reportedOut,
      message: this.status === 'timeout' && this.def.timeoutMessage ? this.def.timeoutMessage : null,
    };
    if (this.def.efficientOrder) res.debrief = this.debrief(res);
    if (this.extra) res.tanks = this.extra();   // mode-specific results (Tanks)
    if (this.def.calibrate) res.calibration = this.calibration || null;
    if (this.def.mode === 'Live') res.live = this.liveScore(res);
    return res;
  }

  // FDE debrief: compare the commander's order with the efficient order and give tips
  // (where time or commands were lost). No score is invented (user's decision).
  debrief(res) {
    const d = this.def, order = this.order, tips = [];
    const eff = d.efficientOrder.map(t => cleanUpCommand(t));
    const count = (list, key) => list.filter(k => k === key).length;
    const keys = order.map(c => c.key);
    const missing = this.objectives.filter(o => !o.done).map(o => o.label);
    const outside = order.filter(c => !c.inArea);
    const refused = res.records.filter(r => !r.executed);
    const haltOnly = new Set(DRILL.commands.filter(c => c.when === 'halt').map(c => c.key));
    // At-the-halt movements done after the flight had already marched (the efficient plan does them first)
    let marched = false; const lateHalt = [];
    order.forEach(c => {
      if (haltOnly.has(c.key) && marched) lateHalt.push(c.name);
      if (/^(forward|to the rear|mark time|double time|column)/.test(c.key || '')) marched = true;   // stepped off
    });
    if (missing.length) tips.push('Not completed: ' + missing.join(', ') + '. Check the drill card before reporting out.');
    if (order.length > eff.length) {
      tips.push('You gave ' + order.length + ' commands; the efficient order uses ' + eff.length + '. Each extra command costs time.');
    }
    const halts = count(keys, 'halt'), effHalts = count(eff, 'halt');
    if (halts > effHalts) tips.push('You halted ' + halts + ' times (efficient order: ' + effHalts + '). Every halt also costs a COVER.');
    if (lateHalt.length) tips.push('At-the-halt movements done after marching (' + [...new Set(lateHalt)].join(', ') +
                                   '): do them in one block at the start, before stepping off.');
    if (outside.length) tips.push(outside.length + ' command(s) given outside the cones did not count and had to be redone. ' +
                                  'Turn earlier so the flight stays inside the drill area.');
    if (res.boundaryBreaks) tips.push('Boundary breaks: ' + res.boundaryBreaks + '.');
    const repeats = order.filter(c => c.repeat && c.inArea && !['halt', 'cover', 'forward harch'].includes(c.key));
    if (repeats.length) tips.push('Repeated movements that were already checked off: ' + repeats.map(c => c.name).join(', ') + '.');
    if (refused.length) tips.push(refused.length + ' command(s) were refused (wrong moment or wording); each one is lost time.');
    if (refused.some(r => /inverted column/.test(r.reason || ''))) {
      tips.push('Column movements can\'t be given in inverted column: turn the flight back into column first (To the Rear).');
    }
    if (this.status === 'timeout') tips.push('Time ran out. Practice the efficient order until you can give it without stopping to think.');
    if (!tips.length) tips.push('Clean evaluation: every movement in the efficient number of commands.');
    return {
      efficientOrder: d.efficientOrder, efficientNotes: d.efficientNotes || [],
      yourOrder: order.map(c => ({ text: c.name || c.text, inArea: c.inArea, repeat: c.repeat, time: c.time })),
      given: order.length, efficient: eff.length, outside: outside.length, refused: refused.length, tips,
    };
  }
}

// Everything the commander types or says goes through here: statements to the evaluator (report
// in / out) go to the scenario, drill commands to the flight (unless the scenario isn't ready for them).
function routeCommand(text, options) {
  const run = typeof activeRun !== 'undefined' ? activeRun : null;
  const flight = typeof activeFlight !== 'undefined' ? activeFlight : null;
  if (!flight) return null;
  // Greetings and the commander's salute (courtesy.js, campus)
  const courtesy = typeof activeCourtesy !== 'undefined' ? activeCourtesy : null;
  if (courtesy) {
    const st = courtesy.statement(text);
    if (st) { flight.feedback((st.good === true ? '✔ ' : st.good ? '⚠ ' : '✘ ') + st.message, st.good); return null; }
  }
  if (run && run.def.calibrate) {                           // timing calibration: every beat counts
    const st = run.calibrationTap(text, options);
    flight.feedback((st.good === true ? '✔ ' : st.good ? '⚠ ' : '✘ ') + st.message, st.good);
    return null;
  }
  if (run) {
    const st = run.statement(text);
    if (st) { flight.feedback((st.good ? '✔ ' : '✘ ') + st.message, st.good); return null; }
    const block = run.blockCommand();
    if (block) { flight.feedback('✘ ' + block, false); return null; }
  }
  return flight.giveCommand(text, options);
}

// "m:ss" for a number of seconds
function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
