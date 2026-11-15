// =====================================================================
//  tanks.js: TANKS MODE rules (logic only, no Phaser). Snake-style flanking game on a drill-pad arena.
//  Your flight is moved only with drill commands; enemy flights are computer commanders
//  (npc-commander.js) that hunt your flanks and dodge your front.
//
//  Rules (user's defaults until the Phase 9 review, see CLAUDE.md):
//   - your FRONT runs into an enemy's SIDE files (or its rear)     -> enemy eliminated, +1
//   - an enemy's FRONT runs into YOUR side (or rear)               -> you lose 1 of 3 lives
//   - head-on (front meets front)                                  -> you lose 1 life
//   - your flight leaves the arena                                 -> you lose 1 life
//   - eliminate all 3 enemies of a wave -> next wave (harder); clear every wave to win
//  After losing a life the flight re-forms at the center (halted) and is safe for a few seconds.
//
//    const game = new TanksGame(SCENARIOS.tanks.tanks, playerFlight, { arena, onSpawn, onRemove, onEvent });
//    game.update(dt)      // every frame, after playerFlight.update(dt)
// =====================================================================

class TanksGame {
  // rules: data from scenarios.js; player: FlightLogic; opts.arena = { x0, y0, x1, y1 } (units)
  constructor(rules, player, opts) {
    this.rules = rules;
    this.player = player;
    this.opts = opts || {};
    this.arena = opts.arena;
    this.rand = opts.rand || Math.random;
    this.lives = rules.lives;
    this.score = 0;
    this.wave = 0;
    this.enemies = [];          // { flight, npc, name, color, alive }
    this.log = [];              // { time, type: 'eliminated'|'life-lost'|'wave', reason, name }
    this.time = 0;
    this.safeUntil = 0;
    this.status = 'playing';    // playing | won | lost
    const inset = rules.laneInsetSteps * STEP_PX;
    this.net = PathNetwork.grid({ x0: this.arena.x0 + inset, y0: this.arena.y0 + inset,
                                  x1: this.arena.x1 - inset, y1: this.arena.y1 - inset }, rules.laneSpacingSteps * STEP_PX);
    this.startSpot = { x: (this.arena.x0 + this.arena.x1) / 2, y: (this.arena.y0 + this.arena.y1) / 2 + 4 * STEP_PX };
    this.nextWave();
  }

  emit(type, details) {
    const e = Object.assign({ time: Math.round(this.time * 10) / 10, type }, details || {});
    this.log.push(e);
    if (this.opts.onEvent) this.opts.onEvent(e);
  }

  // ---------- Waves ----------
  nextWave() {
    this.wave++;
    const w = this.rules.waves[Math.min(this.wave, this.rules.waves.length) - 1];
    this.waveRules = w;
    const all = () => [this.player, ...this.enemies.filter(e => e.alive).map(e => e.flight)];
    const avoid = [flightCenter(this.player)];
    for (let i = 0; i < w.enemies; i++) {
      const name = this.rules.enemyNames[i % this.rules.enemyNames.length];
      const f = new FlightLogic({ bounds: this.arena, start: { x: 0, y: 0 }, areaName: 'arena',
                                  cadence: Math.round(this.player.cadence * w.speed), elements: 3, elementSize: 3, disorder: 0 });
      f.npcName = name;
      const pl = NpcCommander.place(f, this.net, this.rand, avoid, 380);
      if (!pl) continue;
      avoid.push(flightCenter(f));
      const npc = new NpcCommander(f, this.net, { name, rand: this.rand, others: all, lookAheadPx: 200,
                                                  ignore: other => other === this.player });
      npc.start(pl);
      const enemy = { flight: f, npc, name, color: NPC_GUIDON_COLORS[i % NPC_GUIDON_COLORS.length], alive: true, nextPlan: 0 };
      this.enemies.push(enemy);
      if (this.opts.onSpawn) this.opts.onSpawn(enemy);
    }
    this.emit('wave', { wave: this.wave });
  }

  aliveEnemies() { return this.enemies.filter(e => e.alive); }

  // ---------- Geometry ----------
  // A flight's frame: facing h, right r, the extent of its formation, and which people are in front
  frame(f) {
    const d = f.mainDir(), h = DIRS[d], r = DIRS[turnDir(d, 1)];
    const ps = f.marchers();
    const al = ps.map(p => p.x * h.x + p.y * h.y), la = ps.map(p => p.x * r.x + p.y * r.y);
    return { h, r, ps, front: Math.max(...al), rear: Math.min(...al), left: Math.min(...la), right: Math.max(...la) };
  }

  // Which part of flight F (frame fr) is person q: 'front', 'side' or 'rear'
  partOf(fr, q) {
    const a = q.x * fr.h.x + q.y * fr.h.y, b = q.x * fr.r.x + q.y * fr.r.y;
    if (a >= fr.front - this.rules.frontDepthPx) return 'front';
    if (a <= fr.rear + 8) return 'rear';
    if (b <= fr.left + 8 || b >= fr.right - 8) return 'side';
    return 'inside';
  }

  // Closest pair of people of two flights closer than the contact distance, or null
  contact(A, B) {
    let best = null, bd = this.rules.contactPx;
    for (const p of A.marchers()) for (const q of B.marchers()) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bd) { bd = d; best = { p, q }; }
    }
    return best;
  }

  // Classify a contact between the player's flight and an enemy (pure; used by tests too)
  //   -> 'enemy-flanked' | 'player-flanked' | 'head-on' | null (a brush that doesn't count)
  classify(player, enemy) {
    const c = this.contact(player, enemy);
    if (!c) return null;
    const pf = this.frame(player), ef = this.frame(enemy);
    const mine = this.partOf(pf, c.p), theirs = this.partOf(ef, c.q);
    if (mine === 'front' && theirs === 'front') return 'head-on';
    if (mine === 'front' && (theirs === 'side' || theirs === 'rear' || theirs === 'inside')) return 'enemy-flanked';
    if (theirs === 'front' && (mine === 'side' || mine === 'rear' || mine === 'inside')) return 'player-flanked';
    return null;
  }

  // ---------- Each frame ----------
  update(dt) {
    if (this.status !== 'playing') return;
    this.time += dt;
    this.aliveEnemies().forEach(e => {
      this.think(e); e.npc.update(dt); e.flight.update(dt);
      const last = e.flight.events[e.flight.events.length - 1];
      if (last && last.type === 'out-of-bounds') this.reform(e);       // blundered into the edge: re-form on a lane
    });

    // Leaving the arena
    const a = this.arena, edge = this.rules.edgeMarginPx;
    if (this.time > this.safeUntil && this.player.marchers().some(p => p.x < a.x0 + edge || p.x > a.x1 - edge || p.y < a.y0 + edge || p.y > a.y1 - edge)) {
      this.loseLife('left the arena');
    }
    // Contacts
    for (const e of this.aliveEnemies()) {
      const kind = this.classify(this.player, e.flight);
      if (!kind) continue;
      if (kind === 'enemy-flanked') {
        e.alive = false;
        this.score++;
        this.emit('eliminated', { name: e.name });
        if (this.opts.onRemove) this.opts.onRemove(e);
      } else if (this.time > this.safeUntil) {
        this.loseLife(kind === 'head-on' ? 'head-on with ' + e.name : e.name + ' hit your flank');
      }
      if (this.status !== 'playing') return;
    }
    if (!this.aliveEnemies().length) {
      if (this.wave >= this.rules.waves.length) { this.status = 'won'; this.emit('won', {}); }
      else this.nextWave();
    }
  }

  loseLife(reason) {
    this.lives--;
    this.emit('life-lost', { reason, lives: this.lives });
    if (this.lives <= 0) { this.status = 'lost'; this.emit('lost', {}); return; }
    // Re-form at the start spot, halted, facing North; a few seconds to get going
    this.player.opts.start = { ...this.startSpot }; this.player.opts.startDir = 0;
    this.player.reset();
    this.safeUntil = this.time + this.rules.safeSeconds;
    // Enemies close to the start spot re-form somewhere else (no instant second hit)
    this.aliveEnemies().forEach(e => {
      if (e.flight.everyone().some(p => Math.hypot(p.x - this.startSpot.x, p.y - this.startSpot.y) < 600)) this.reform(e);
      e.nextPlan = this.time + 2;
    });
  }

  // An enemy that marched into the arena edge re-forms on a lane away from the player
  reform(e) {
    const pl = NpcCommander.place(e.flight, this.net, this.rand, [flightCenter(this.player), this.startSpot], 600);
    if (pl) { e.npc.legs = []; e.npc.backOff = null; e.npc.turnAround = false; e.npc.start(pl); e.nextPlan = this.time + 2; }
  }

  // ---------- Enemy AI: hunt the player's flank, dodge the player's front ----------
  think(e) {
    if (this.time < e.nextPlan) return;
    e.nextPlan = this.time + this.waveRules.replanSeconds;
    const pf = this.frame(this.player), ec = flightCenter(e.flight), pc = flightCenter(this.player);
    // Threat: the enemy is in front of the player's flight and close -> get out of the way (dodge)
    const along = (ec.x - pc.x) * pf.h.x + (ec.y - pc.y) * pf.h.y, lat = (ec.x - pc.x) * pf.r.x + (ec.y - pc.y) * pf.r.y;
    if (this.player.marching && along > 0 && along < this.rules.dodgeRangePx && Math.abs(lat) < (pf.right - pf.left) / 2 + 120) {
      const away = lat >= 0 ? 1 : -1;
      e.npc.setGoal({ x: ec.x + pf.r.x * away * 500, y: ec.y + pf.r.y * away * 500 });
      e.mode = 'dodge';
      return;
    }
    // Hunt: aim for a point beside the player's nearer side, a little ahead of where it's going
    const side = lat >= 0 ? 1 : -1;
    const lead = this.player.marching ? this.waveRules.leadSteps * STEP_PX : 0;
    const off = (pf.right - pf.left) / 2 + this.rules.huntOffsetPx;
    const target = { x: pc.x + pf.r.x * side * off + pf.h.x * lead, y: pc.y + pf.r.y * side * off + pf.h.y * lead };
    const dist = Math.hypot(target.x - ec.x, target.y - ec.y), m = this.rules.aimEdgePx, A = this.arena;
    const inside = target.x > A.x0 + m && target.x < A.x1 - m && target.y > A.y0 + m && target.y < A.y1 - m;
    if (dist < this.rules.attackRangePx && inside) {
      // Attack run: straight at the middle of the player's side (not the offset point beside it)
      e.npc.aim({ x: pc.x + pf.h.x * lead * 0.5, y: pc.y + pf.h.y * lead * 0.5 });
      e.mode = 'attack';
    } else {
      e.npc.setGoal(target);
      e.mode = 'hunt';
    }
  }

  results() {
    return {
      status: this.status, wave: this.wave, waves: this.rules.waves.length, score: this.score,
      lives: this.lives, startLives: this.rules.lives, time: this.time,
      eliminated: this.log.filter(e => e.type === 'eliminated'), livesLost: this.log.filter(e => e.type === 'life-lost'),
    };
  }
}
