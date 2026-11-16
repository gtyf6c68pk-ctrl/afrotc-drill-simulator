// =====================================================================
//  courtesy.js: CAMPUS PEOPLE and MILITARY COURTESY (logic only, no Phaser; Phase 10).
//  Rules and wording come from courtesy-rules.js (COURTESY); the POC and cadre from roster.js.
//
//  PeopleSim: civilians, POC cadets and cadre officers walking the campus walkways.
//    They step aside and wait for flights (pedestrians always yield to a formation).
//  CourtesyMonitor: watches who comes near the flight commander and grades the commander's
//    greeting / salute: right words, right person (rank + name), in time, salute when required.
//    In formation only the flight commander salutes and greets, for the whole flight (DAFPAM 3.6.3).
// =====================================================================

// ---------- Walkways (every footway/path, for people on foot; not just drillable ones) ----------
function walkwayNetwork(scene) {
  const net = new PathNetwork();
  const isWalk = r => ['footway', 'path', 'pedestrian', 'cycleway', 'steps'].includes(r.k);
  CAMPUS.roads.filter(isWalk).forEach(r => {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i], y1 = r.p[i + 1], x2 = r.p[i + 2], y2 = r.p[i + 3];
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      if (scene.buildingAt(x1, y1) || scene.buildingAt(x2, y2) || scene.buildingAt(mx, my)) continue;
      net.addSegment(x1, y1, x2, y2, r.w);
    }
  });
  return net.keepLargestComponent();
}

// ---------- People walking around ----------
class PeopleSim {
  // net: walkway PathNetwork; opts: { rand, roster (ROSTER), counts (COURTESY.people) }
  constructor(net, opts) {
    this.net = net;
    this.rand = (opts && opts.rand) || Math.random;
    const P = COURTESY.people;
    this.speed = P.walkSpeedMps * CAMPUS.pxPerMeter;
    this.people = [];
    const roster = (opts && opts.roster) || (typeof ROSTER !== 'undefined' ? ROSTER : { poc: [], cadre: [] });
    const pick = (list, n) => list.slice().sort(() => this.rand() - 0.5).slice(0, n);
    const k = (opts && opts.scale) || 1;                     // difficulty: more or fewer people
    const n = v => Math.round(v * k);
    for (let i = 0; i < n(P.civilians); i++) {
      const sub = P.civilianKinds[Math.floor(this.rand() * P.civilianKinds.length)];
      this.add({ kind: 'civilian', sub, sex: this.rand() < 0.5 ? 'M' : 'F' });
    }
    pick(roster.poc, n(P.poc)).forEach(r => this.add({ kind: 'poc', person: r, sex: r.sex }));
    pick(roster.cadre, Math.max(1, n(P.cadre))).forEach(r => this.add({ kind: 'cadre', person: r, sex: r.sex }));
  }

  add(p) {
    const live = this.net.live;
    const n = live[Math.floor(this.rand() * live.length)];
    Object.assign(p, { id: 'p' + this.people.length, x: n.x, y: n.y, node: n.id, target: null, angle: 0,
                       speedK: 0.85 + this.rand() * 0.3, seed: Math.floor(this.rand() * 1e6), step: 0, waiting: 0, aside: 0 });
    this.pickNext(p);
    this.people.push(p);
  }

  // Walk to a random neighbouring junction (no immediate U-turn if there's another way)
  pickNext(p) {
    const node = this.net.nodes[p.node];
    const edges = node.edges.filter(e => this.net.nodes[e.a].alive && this.net.nodes[e.b].alive);
    let choices = edges.filter(e => this.net.other(e, p.node) !== p.prev);
    if (!choices.length) choices = edges;
    const e = choices[Math.floor(this.rand() * choices.length)];
    p.prev = p.node;
    p.node = this.net.other(e, p.node);
    p.side = (this.rand() - 0.5) * Math.min(e.w * 0.6, 60);       // walk a little left or right of the center
  }

  // flights: FlightLogic list; people get out of the way of any formation
  update(dt, flights) {
    this.people.forEach(p => {
      const T = this.net.nodes[p.node];
      const dx = T.x - p.x, dy = T.y - p.y, d = Math.hypot(dx, dy);
      const ux = d ? dx / d : 0, uy = d ? dy / d : 0;
      // Formation close by? stop, and step aside if it's really close
      let near = null, nd = Infinity;
      flights.forEach(f => f.everyone().forEach(q => {
        const dd = Math.hypot(q.x - p.x, q.y - p.y);
        if (dd < nd) { nd = dd; near = q; }
      }));
      if (near && nd < 70) {                      // ~2 m: move straight away from the nearest marcher
        const ax = (p.x - near.x) / (nd || 1), ay = (p.y - near.y) / (nd || 1);
        p.x += ax * this.speed * 1.2 * dt; p.y += ay * this.speed * 1.2 * dt;
        p.waiting = 1; p.moving = true; p.angle = Math.atan2(ax, -ay);
        return;
      }
      const ahead = near && nd < 200 && ((near.x - p.x) * ux + (near.y - p.y) * uy) > 0;
      if (ahead) { p.waiting = 1; p.moving = false; return; }   // wait for the flight to pass
      p.waiting = 0;
      const step = this.speed * p.speedK * dt;
      if (d <= step) { p.x = T.x; p.y = T.y; this.pickNext(p); return; }
      p.x += ux * step; p.y += uy * step;
      p.angle = Math.atan2(ux, -uy);
      p.moving = true;
      p.step += step;
    });
  }
}

// ---------- Greeting and salute checks ----------
function courtesyTimeWord(hour) {
  const t = COURTESY.timeOfDay.find(t => hour < t.before);
  return t ? t.word : COURTESY.timeOfDay[COURTESY.timeOfDay.length - 1].word;
}

// Cleaned-up words for comparing what was said (lower case, no punctuation, ma'am -> maam)
function courtesyClean(text) {
  return String(text).toLowerCase().replace(/ma'?am/g, 'maam').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Everything that would be a correct greeting for this person at this hour
function expectedGreetings(p, hour) {
  const tod = courtesyTimeWord(hour);
  const sirmaam = p.sex === 'F' ? 'maam' : 'sir';
  const address = p.person ? (p.person.addressAs + ' ' + p.person.last) : '';
  return (COURTESY.greetings[p.kind] || []).map(t => courtesyClean(t.replace('{tod}', tod).replace('{sirmaam}', sirmaam).replace('{address}', address)));
}

// Who someone is, in words for messages
function personLabel(p) {
  if (p.person) return p.person.display + ' (' + (p.kind === 'cadre' ? 'cadre' : 'POC') + ')';
  return 'a ' + (p.sub || 'civilian');
}

class CourtesyMonitor {
  // flight: the player's FlightLogic; opts: { hour: () => 0..23, onResult(result), onPrompt(list) }
  constructor(flight, opts) {
    this.flight = flight;
    this.opts = opts || {};
    this.hour = this.opts.hour || (() => new Date().getHours());
    this.open = new Map();          // person id -> interaction { p, saluted, greeted, wrong, openedAt }
    this.done = new Set();          // people already dealt with (once per person per visit)
    this.results = [];              // { who, kind, outcome: 'correct'|'missed'|'wrong-words'|'no-salute'|'late', detail }
    this.time = 0;
    this.saluteUntil = 0;
  }

  needsSalute(p) { return !!COURTESY.salute[p.kind]; }

  update(dt, people) {
    this.time += dt;
    const c = this.flight.commander, M = CAMPUS.pxPerMeter;
    if (!c) return;
    people.forEach(p => {
      const d = Math.hypot(p.x - c.x, p.y - c.y) / M;
      const it = this.open.get(p.id);
      if (!it && !this.done.has(p.id) && d <= COURTESY.recognitionMeters) {
        this.open.set(p.id, { p, saluted: false, greeted: false, wrong: null, openedAt: this.time });
      } else if (it && d > COURTESY.passedMeters) {
        this.close(it);
      }
    });
    if (this.opts.onPrompt) this.opts.onPrompt([...this.open.values()]);
  }

  // The chance has passed: grade what was (not) done
  close(it) {
    this.open.delete(it.p.id);
    this.done.add(it.p.id);
    const needSalute = this.needsSalute(it.p);
    let outcome = 'correct', detail = '';
    if (!it.greeted && !(needSalute && it.saluted)) { outcome = 'missed'; detail = 'not greeted'; }
    else if (!it.greeted) { outcome = it.wrong ? 'wrong-words' : 'missed'; detail = it.wrong || 'saluted but no greeting'; }
    else if (needSalute && !it.saluted) { outcome = 'no-salute'; detail = 'officers are saluted outdoors (DAFPAM 3.6.1)'; }
    this.record(it.p, outcome, detail);
  }

  record(p, outcome, detail) {
    const r = { who: personLabel(p), kind: p.kind, outcome, detail, time: Math.round(this.time), expected: expectedGreetings(p, this.hour())[0] };
    this.results.push(r);
    if (this.opts.onResult) this.opts.onResult(r);
  }

  // The commander's salute or greeting (typed or spoken). Returns null if it isn't one,
  // otherwise { good, message }.
  statement(text) {
    const t = courtesyClean(text);
    if (COURTESY.saluteWords.includes(t)) {
      this.saluteUntil = this.time + COURTESY.saluteSeconds;
      this.flight.cdrSaluting = COURTESY.saluteSeconds;          // the view raises the commander's right hand
      const officer = [...this.open.values()].find(it => this.needsSalute(it.p) && !it.saluted);
      if (officer) { officer.saluted = true; return { good: true, message: 'Salute rendered to ' + personLabel(officer.p) + '.' }; }
      return { good: 'warn', message: 'You saluted, but no officer is close enough to recognize.' };
    }
    if (!/^good (morning|afternoon|evening)\b/.test(t)) return null;   // not a greeting
    const open = [...this.open.values()].filter(it => !it.greeted);
    if (!open.length) return { good: 'warn', message: 'Nobody close enough to greet.' };
    // Whom is it for? The person whose correct greeting matches; else the closest one
    const c = this.flight.commander;
    const hour = this.hour();
    const match = open.find(it => expectedGreetings(it.p, hour).includes(t));
    if (match) {
      match.greeted = true;
      if (!this.needsSalute(match.p) || match.saluted) { this.close(match); return { good: true, message: 'Greeted ' + personLabel(match.p) + '.' }; }
      return { good: true, message: 'Greeted ' + personLabel(match.p) + '. Salute too: an officer.' };
    }
    const nearest = open.sort((a, b) => Math.hypot(a.p.x - c.x, a.p.y - c.y) - Math.hypot(b.p.x - c.x, b.p.y - c.y))[0];
    const want = expectedGreetings(nearest.p, hour);
    const tod = courtesyTimeWord(hour);
    let why = 'say "' + want[0] + '"';
    if (!t.includes(tod)) why = 'it is ' + tod + ': ' + why;
    else if (nearest.p.person && !t.includes(nearest.p.person.last.toLowerCase())) why = 'use rank and name: ' + why;
    nearest.wrong = why;
    return { good: false, message: 'Not quite for ' + personLabel(nearest.p) + ': ' + why + '.' };
  }

  summary() {
    const n = k => this.results.filter(r => r.outcome === k).length;
    return { total: this.results.length, correct: n('correct'), missed: n('missed'), wrong: n('wrong-words'), noSalute: n('no-salute'),
             results: this.results };
  }
}

// Voice phrases for greetings (the offline voice engine only listens for known phrases)
function courtesyPhrases() {
  const out = new Set(COURTESY.saluteWords);
  const roster = typeof ROSTER !== 'undefined' ? [...ROSTER.poc, ...ROSTER.cadre] : [];
  COURTESY.timeOfDay.forEach(({ word }) => {
    ['', ' sir', " ma'am"].forEach(s => out.add('good ' + word + s));
    roster.forEach(r => out.add(('good ' + word + ' ' + r.addressAs + ' ' + r.last).toLowerCase()));
  });
  return [...out];
}
