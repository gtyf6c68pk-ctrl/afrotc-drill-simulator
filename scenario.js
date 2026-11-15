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
//  Scenario fields: id, title, mode, map, hints (Practice coach), area {x0,y0,x1,y1} in STEPS
//  from the map's play area (or null), timer { limitSeconds, startOn: 'first-command'|'open' } or null,
//  objectives [...], endWhenComplete (true: finishes by itself when every objective is done).
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
    this.area = def.areaUnits || null;          // the drill area in map units (set by the map)
    this.inArea = true;
    this.boundaryBreaks = 0;
    this.objectives = (def.objectives || []).map(o => ({ ...o, done: false, doneAt: null, attempts: 0 }));
    this.order = [];                            // commands carried out, in order (FDE debrief)
  }

  get running() { return this.status === 'running'; }

  update(dt) {
    if (!this.running) return;
    if (this.started) this.elapsed = this.flight.clock - this.startClock;
    this.checkArea();
    const fresh = this.flight.events.filter(e => e.seq > this.lastSeq);
    if (fresh.length) this.lastSeq = fresh[fresh.length - 1].seq;
    fresh.forEach(e => this.handle(e));
    const t = this.def.timer;
    if (t && t.limitSeconds && this.started && this.elapsed >= t.limitSeconds) this.end('timeout');
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

  handle(e) {
    this.events.push(e);
    if (e.type === 'command' && !this.started && this.def.timer && this.def.timer.startOn === 'first-command') {
      this.started = true;
      this.startClock = e.time;
    }
    if (e.type === 'command') {
      this.order.push({ key: e.key, name: e.name, time: this.elapsed, inArea: this.inArea });
      this.objectives.filter(o => o.type === 'movement' && o.keys.includes(e.key)).forEach(o => {
        o.attempts++;
        if (o.done) return;
        if (!this.inArea) return;               // out of bounds: does not count (user's FDE rule)
        o.done = true; o.doneAt = this.elapsed;
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
        if (s.streak >= o.count) { o.done = true; o.doneAt = this.elapsed; if (this.cb.onObjective) this.cb.onObjective(o); }
      });
    }
    if (this.def.endWhenComplete && this.objectives.length && this.objectives.every(o => o.done)) this.end('complete');
  }

  end(status) {
    if (!this.running) return;
    this.status = status;
    if (this.cb.onEnd) this.cb.onEnd(this.results());
  }

  // The commander ends the session
  finish() { this.end(this.objectives.length && this.objectives.every(o => o.done) ? 'complete' : 'finished'); }

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
    return {
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
    };
  }
}

// "m:ss" for a number of seconds
function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
