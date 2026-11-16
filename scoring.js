// =====================================================================
//  scoring.js: the SCORING ENGINE (logic only, no Phaser). Reads a flight's event log
//  (FlightLogic.events) and grades every command the commander gave:
//    - wording:     exact, or sloppy (a letter or two wrong), or not a valid command at that moment
//    - timing:      command of execution on the correct heel strike (DAFPAM 2.4.2)
//    - preparatory: preparatory command on the same heel, one step before (DAFPAM 2.2.7, 3.9.2);
//                   only graded when it was said/typed as its own part (voice, or two-part typing)
//    - executed:    the flight carried it out (or refused it, and why)
//  SCORING.records(events) -> one record per command; SCORING.summary(records) -> totals;
//  SCORING.hint(record) -> what the correct command is and when to give it (Practice coach).
// =====================================================================

const SCORING = {
  // Timing words for a timing error (0 = exactly on the heel strike, 1 = a whole step off)
  // problem: the flight's verdict (null = on time; the window depends on the cadence)
  timingGrade(error, foot, problem) {
    if (error === null || error === undefined || !foot) return 'n/a';
    if (!problem) return 'ok';
    return foot !== 'either' && error > 0.5 ? 'wrong-foot' : 'off';
  },

  // One record per command given (accepted or refused), oldest first
  records(events) {
    const out = [], byId = {};
    events.forEach(e => {
      if (e.type === 'command') {
        const r = {
          id: e.id, time: e.time, step: e.step, text: e.text, key: e.key, name: e.name, action: e.action,
          voice: e.voice, foot: e.foot, executed: true, reason: null,
          wording: e.wrongLetters > 0 ? 'sloppy' : 'ok',
          timingError: e.timingError, timing: e.deferredTiming ? 'pending' : SCORING.timingGrade(e.timingError, e.foot, e.timingProblem),
          timingProblem: e.timingProblem || null,
          prep: !e.foot ? 'n/a' : !e.prepGiven ? 'not-graded' : e.prepProblem ? 'off' : 'ok',
          prepProblem: e.prepProblem || null, prepGap: e.prepGap,
        };
        out.push(r);
        if (e.id) byId[e.id] = r;
      } else if (e.type === 'timing-graded' && byId[e.commandId]) {
        const r = byId[e.commandId];             // voice: exact timing arrives a moment later
        r.timingError = e.timingError;
        r.timing = SCORING.timingGrade(e.timingError, e.foot, e.problem);
        r.timingProblem = e.problem;
        if (e.prepGiven) { r.prep = e.prepProblem ? 'off' : 'ok'; r.prepProblem = e.prepProblem; r.prepGap = e.prepGap; }
      } else if (e.type === 'command-rejected') {
        out.push({ id: null, time: e.time, step: e.step, text: e.text, key: e.key, executed: false, reason: e.reason,
                   name: e.key && COMMANDS_BY_KEY[e.key] ? COMMANDS_BY_KEY[e.key].say : null,
                   wording: e.key ? 'ok' : 'invalid', timing: 'n/a', prep: 'n/a' });
      }
    });
    out.forEach(r => { r.clean = SCORING.isClean(r); });
    return out;
  },

  // A command with nothing wrong (a pending voice timing counts as fine until graded)
  isClean(r) {
    return r.executed && r.wording === 'ok' && (r.timing === 'ok' || r.timing === 'n/a' || r.timing === 'pending') &&
           r.prep !== 'off';
  },

  // What went wrong, in plain words (empty = nothing)
  problems(r) {
    const p = [];
    if (!r.executed) p.push(r.reason);
    if (r.wording === 'sloppy') p.push('sloppy wording ("' + r.text.trim() + '")');
    if (r.timing === 'wrong-foot' || r.timing === 'off') p.push(r.timingProblem || 'off the heel strike');
    if (r.prep === 'off') p.push(r.prepProblem);
    return p.filter(Boolean);
  },

  summary(records) {
    const executed = records.filter(r => r.executed);
    const timed = executed.filter(r => r.timing !== 'n/a' && r.timing !== 'pending');
    const prepGraded = executed.filter(r => r.prep === 'ok' || r.prep === 'off');
    const pct = (a, b) => b ? Math.round(100 * a / b) : null;
    let streak = 0, bestStreak = 0;
    records.forEach(r => { streak = r.clean ? streak + 1 : 0; bestStreak = Math.max(bestStreak, streak); });
    return {
      given: records.length,
      executed: executed.length,
      refused: records.length - executed.length,
      clean: records.filter(r => r.clean).length,
      accuracy: pct(records.filter(r => r.clean).length, records.length),          // % of commands with no mistake
      wording: pct(executed.filter(r => r.wording === 'ok').length, executed.length),
      timed: timed.length,
      onTime: pct(timed.filter(r => r.timing === 'ok').length, timed.length),
      wrongFoot: timed.filter(r => r.timing === 'wrong-foot').length,
      prepGraded: prepGraded.length,
      prepOnTime: pct(prepGraded.filter(r => r.prep === 'ok').length, prepGraded.length),
      streak, bestStreak,
      mistakes: records.filter(r => !r.clean),
    };
  },

  // The preparatory command and command of execution of a command, e.g. ['Column Right', 'HARCH']
  parts(say) {
    const i = say.lastIndexOf(', ');
    return i < 0 ? [null, say] : [say.slice(0, i), say.slice(i + 2)];
  },

  // How to give a command correctly, e.g. 'Say "Column Right" as your RIGHT heel strikes, then HARCH
  // as it strikes again.'
  howTo(cmd) {
    const [prep, exec] = SCORING.parts(cmd.say);
    if (!cmd.foot) return 'Give ' + cmd.say + ' at the halt.';
    if (cmd.foot === 'either') {
      return 'Say "' + (prep || '') + '" as either heel strikes, then ' + exec + ' when that SAME heel strikes again.';
    }
    const foot = cmd.foot.toUpperCase();
    if (!prep) return 'Say ' + exec + ' as your ' + foot + ' heel strikes.';
    return 'Say "' + prep + '" as your ' + foot + ' heel strikes, then ' + exec + ' when the ' + foot + ' heel strikes again (two steps later).';
  },

  // Practice coach: the correct command and when to give it, for a record with a mistake
  hint(r) {
    const cmd = r.key ? COMMANDS_BY_KEY[r.key] : null;
    if (!r.executed) return null;               // the reason already says what to do instead
    const lines = [];
    if (r.wording === 'sloppy') lines.push('Say it exactly: ' + cmd.say + '.');
    if (r.timing === 'wrong-foot' || r.timing === 'off' || r.prep === 'off') lines.push(SCORING.howTo(cmd));
    if (cmd && cmd.note && lines.length) lines.push('(' + cmd.say + ': ' + cmd.note + '; DAFPAM ' + cmd.ref + ')');
    return lines.join(' ');
  },
};
