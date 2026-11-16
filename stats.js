// =====================================================================
//  stats.js: LOCAL STATS (logic only, no Phaser; Phase 12). Every finished session (Practice,
//  FDE, Tanks, Live) is saved in this browser only (localStorage), on the cadet's own device.
//  No name or account: just the results (design rule: collect as little cadet data as possible).
//    STATS.record(results)   // called by the results screen
//    STATS.sessions()        // everything saved, oldest first
//    STATS.overview()        // totals, best per mode, accuracy by command, most-missed, trend
//    STATS.clear()
// =====================================================================

const STATS = {
  KEY: 'drillSimulator.stats.v1',
  MAX: 300,                       // keep the last 300 sessions
  storage: null,                  // tests swap in a stand-in; the game uses window.localStorage

  store() {
    if (this.storage) return this.storage;
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
  },

  sessions() {
    try { const s = this.store(); return s ? JSON.parse(s.getItem(this.KEY) || '[]') : []; } catch (e) { return []; }
  },

  save(list) {
    try { const s = this.store(); if (s) s.setItem(this.KEY, JSON.stringify(list.slice(-this.MAX))); } catch (e) { /* storage full or blocked */ }
  },

  clear() { this.save([]); },

  // Boil a results object (scenario.js results()) down to what is worth keeping
  summarize(res, when) {
    const s = res.summary;
    const byCommand = {};
    res.records.forEach(r => {
      if (!r.key) return;
      const c = byCommand[r.key] || (byCommand[r.key] = { given: 0, clean: 0, wrongFoot: 0, off: 0, refused: 0, sloppy: 0, prepOff: 0 });
      c.given++;
      if (r.clean) c.clean++;
      if (r.timing === 'wrong-foot') c.wrongFoot++;
      if (r.timing === 'off') c.off++;
      if (!r.executed) c.refused++;
      if (r.wording === 'sloppy') c.sloppy++;
      if (r.prep === 'off') c.prepOff++;
    });
    const out = {
      date: when || new Date().toISOString(), mode: res.mode, scenario: res.scenario, title: res.title, status: res.status,
      seconds: Math.round(res.elapsed || 0), given: s.given, accuracy: s.accuracy, onTime: s.onTime, prepOnTime: s.prepOnTime,
      refused: s.refused, wrongFoot: s.wrongFoot, bestStreak: s.bestStreak, byCommand,
    };
    if (res.debrief) Object.assign(out, { fdeMovements: res.completed, fdeCommands: res.debrief.given, fdeOutside: res.debrief.outside });
    if (res.tanks) Object.assign(out, { tanksScore: res.tanks.score, tanksWave: res.tanks.wave, tanksWon: res.tanks.status === 'won' });
    if (res.live) Object.assign(out, { liveScore: res.status === 'complete' ? res.live.score : null,
                                       courtesyCorrect: res.live.courtesy.correct, courtesyTotal: res.live.courtesy.total || 0 });
    return out;
  },

  record(res, when) {
    if (!res || !res.records || (!res.records.length && res.status !== 'complete')) return null;   // nothing happened
    if (res.scenario === 'calibrate') return null;                                                 // not a drill session
    const entry = this.summarize(res, when);
    const list = this.sessions();
    list.push(entry);
    this.save(list);
    return entry;
  },

  overview() {
    const list = this.sessions();
    const totals = { sessions: list.length, commands: 0, clean: 0, seconds: 0 };
    const cmds = {};
    list.forEach(e => {
      totals.commands += e.given || 0; totals.seconds += e.seconds || 0;
      Object.entries(e.byCommand || {}).forEach(([k, c]) => {
        const t = cmds[k] || (cmds[k] = { key: k, given: 0, clean: 0, wrongFoot: 0, off: 0, refused: 0, sloppy: 0, prepOff: 0 });
        Object.keys(c).forEach(f => { t[f] += c[f]; });
        totals.clean += c.clean;
      });
    });
    const byCommand = Object.values(cmds).map(c => ({ ...c,
      name: typeof COMMANDS_BY_KEY !== 'undefined' && COMMANDS_BY_KEY[c.key] ? COMMANDS_BY_KEY[c.key].say : c.key,
      accuracy: c.given ? Math.round(100 * c.clean / c.given) : null, mistakes: c.given - c.clean }))
      .sort((a, b) => b.given - a.given);
    const mostMissed = byCommand.filter(c => c.mistakes > 0).sort((a, b) => b.mistakes - a.mistakes || a.accuracy - b.accuracy).slice(0, 5);
    const best = {};
    const better = (mode, label, value, higher, e) => {
      if (value === null || value === undefined) return;
      const cur = best[mode + label];
      if (!cur || (higher ? value > cur.value : value < cur.value)) best[mode + label] = { mode, label, value, date: e.date, title: e.title };
    };
    list.forEach(e => {
      if (e.mode === 'Practice') { better('Practice', 'best accuracy (%)', e.given >= 10 ? e.accuracy : null, true, e); better('Practice', 'best streak', e.bestStreak, true, e); }
      if (e.mode === 'FDE' && e.fdeMovements === 20) { better('FDE', 'fastest 20/20 (s)', e.seconds, false, e); better('FDE', 'fewest commands for 20/20', e.fdeCommands, false, e); }
      if (e.mode === 'Tanks') { better('Tanks', 'most flights flanked', e.tanksScore, true, e); better('Tanks', 'furthest wave', e.tanksWave, true, e); }
      if (e.mode === 'Live') better('Live', 'best score (' + e.title + ')', e.liveScore, true, e);
    });
    const trend = list.filter(e => e.given >= 5).slice(-30).map(e => ({ date: e.date, accuracy: e.accuracy, onTime: e.onTime, mode: e.mode }));
    return { totals: { ...totals, accuracy: totals.commands ? Math.round(100 * totals.clean / totals.commands) : null },
             byCommand, mostMissed, best: Object.values(best), trend, recent: list.slice(-10).reverse() };
  },
};
