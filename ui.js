// =====================================================================
//  ui.js: the screens and on-screen controls (HUD), built in the web page itself
//  (crisp text at any window size). The game canvas behind them only draws the world.
//    showScreen('menu' | 'settings' | 'play')   which overlay is visible
//    openScene('DrillPad' | 'Campus' | 'Menu')  switch the map
//    setHud({ mode, attribution })              title and credits line on a map
//    setActiveCamera(cameraController)          hook up zoom / follow buttons
// =====================================================================

// ---------- Opening a screen straight from the page address ----------
// e.g. index.html?scene=Campus&start=drillfield&zoom=0.4&commands=Forward,%20HARCH|Column%20Right,%20HARCH
//   scene:    Menu, DrillPad, Campus, Settings or Reference
//   start:    campus starting point (lowder / drillfield) for this visit only
//   zoom:     starting zoom (e.g. 0.4)
//   commands: commands to give right away, separated by |  (used by tools/screenshot.sh)
//   scenario: which scenario to run on the drill pad (see scenarios.js), e.g. sequence30
//   finish:   1 = end the session right after `advance` and show the results (screenshots)
//   seed:     repeatable random choices (e.g. where the computer-controlled flights start)
//   at:       look at this spot instead of following the flight, in meters from the map's top-left (e.g. at=520,210)
//   advance:  fast-forward the simulation this many seconds when the map opens (screenshots;
//             headless Chrome doesn't run the game's frame loop, so time has to be stepped by hand)
// Handy for sharing a direct link and for the automated screenshots.
const LINK = (() => {
  const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  return { scene: q.get('scene'), start: q.get('start'), zoom: q.get('zoom') ? Number(q.get('zoom')) : null,
           commands: q.get('commands') ? q.get('commands').split('|') : [],
           advance: q.get('advance') ? Number(q.get('advance')) : 0,
           at: q.get('at') ? q.get('at').split(',').map(Number) : null,
           scenario: q.get('scenario'), finish: q.get('finish') === '1',
           seed: q.get('seed') ? Number(q.get('seed')) : null, brief: q.get('brief') };
})();

// Give the commands from the page address (once, the first time a map opens). Call it at the
// END of a map's create(). With ?advance=N the simulation is stepped N seconds right away
// (commands 1.2 s apart) and the picture refreshed; otherwise commands use the game clock.
function giveLinkCommands(scene, flight) {
  const list = LINK.commands, advance = LINK.advance;
  LINK.commands = []; LINK.advance = 0;
  if (!advance) {
    list.forEach((c, i) => scene.time.delayedCall(300 + i * 1200, () => routeCommand(c)));
    return;
  }
  const step = s => {
    for (let i = 0; i < s * 60; i++) {
      flight.update(1 / 60);
      if (scene.stepOthers) scene.stepOthers(1 / 60);           // computer-controlled flights
      if (scene.metronome) scene.metronome.update(1 / 60);
    }
  };
  let used = 0;
  list.forEach(c => { routeCommand(c); step(1.2); used += 1.2; });
  step(Math.max(0, advance - used));
  if (scene.flightView) scene.flightView.sync(1);
  (scene.npcs || []).forEach(n => n.view.sync(1));
  if (scene.camera) scene.camera.update(1, true);
  if (scene.update) scene.update(0, 16);   // one normal frame, so the per-frame code is exercised too
  if (activeRun) { activeRun.update(0); updateRunHud(true); }
  if (LINK.finish && activeRun) { LINK.finish = false; activeRun.finish(); }
}

const $ = id => document.getElementById(id);

// ---------- Screens ----------
function showScreen(name) {
  $('screen-menu').classList.toggle('hidden', name !== 'menu');
  $('screen-settings').classList.toggle('hidden', name !== 'settings');
  $('screen-results').classList.toggle('hidden', name !== 'results');
  $('screen-reference').classList.toggle('hidden', name !== 'reference');
  $('screen-briefing').classList.toggle('hidden', name !== 'briefing');
  $('screen-stats').classList.toggle('hidden', name !== 'stats');
  $('hud').classList.toggle('hidden', name !== 'play');
  if (name !== 'play') { $('minimapFrame').classList.add('hidden'); $('reference').classList.add('closed'); }
  if (name === 'settings') buildSettings();
  if (name !== 'play') $('toasts').innerHTML = '';
}

// Switch the game to another map (the Phaser scene); `game` is created in main.js
function openScene(key) {
  game.scene.getScenes(true).forEach(s => game.scene.stop(s.scene.key));
  game.scene.start(key);
}

function setHud({ mode, attribution }) {
  $('hud-mode').innerHTML = mode;
  $('hud-attribution').textContent = attribution || '';
  $('log').innerHTML = '';
  activeRun = null;
  $('objective').classList.add('hidden');
  $('coach').classList.add('hidden');
  $('btnFinish').classList.add('hidden');
  $('drillCard').classList.add('hidden');
  $('btnMap').classList.add('hidden');
  document.documentElement.style.setProperty('--right-top', '70px');
  setPlanningControls(null);
  showScreen('play');
}

// The planning period's "Turn flight" button (null = hide it)
let planningTurn = null;
function setPlanningControls(onTurn) {
  planningTurn = onTurn;
  $('btnTurn').classList.toggle('hidden', !onTurn);
}

// ---------- Scenarios (scenario.js): objective tracker, Practice coach, results ----------
let currentScenario = 'practice';   // which scenario the drill pad runs (chosen on the menu)
let activeRun = null;               // the ScenarioRun on the open map (null on maps without one)
let activeScene = null;             // the open map's Phaser scene (Tanks reads its game from here)
let lastResults = null;

// Start a scenario on a map's flight and hook it up to the HUD
function startRun(def, flight) {
  let coachTimer = null;
  const run = new ScenarioRun(def, flight, {
    onMistake: (r, hint) => {
      if (!def.hints) return;
      const what = SCORING.problems(r).join('; ');
      $('coach').innerHTML = '<div class="head">Coach</div><div class="what">' + esc(r.text.trim()) + ': ' + esc(what) +
                             '</div>' + (hint ? '<div class="fix">' + esc(hint) + '</div>' : '');
      $('coach').classList.remove('hidden');
      clearTimeout(coachTimer);
      coachTimer = setTimeout(() => $('coach').classList.add('hidden'), 12000);
    },
    onClean: () => { clearTimeout(coachTimer); coachTimer = setTimeout(() => $('coach').classList.add('hidden'), 2500); },
    onObjective: o => { if (o.type !== 'movement') toast('✔ ' + o.label, 'good'); },   // movements: the drill card ticks
    onBias: (kind, secs) => {                       // your commands are steadily early/late: offer a correction
      const key = kind === 'voice' ? 'timingOffsetVoice' : 'timingOffsetTyped';
      $('coach').innerHTML = '<div class="head">Timing</div><div class="what">Your last 8 ' + (kind === 'voice' ? 'spoken' : 'typed') +
        ' commands were all about <b>' + Math.abs(secs).toFixed(2) + ' s ' + (secs > 0 ? 'late' : 'early') + '</b>. That steady offset is usually the ' +
        (kind === 'voice' ? 'microphone / how a word lands on the beat' : 'keyboard') + ', not your rhythm.</div>' +
        '<div class="fix"><button class="btn primary" id="biasFix">Correct for it</button> <button class="btn" id="biasNo">No thanks</button></div>';
      $('coach').classList.remove('hidden');
      clearTimeout(coachTimer);
      $('biasNo').onclick = () => $('coach').classList.add('hidden');
      $('biasFix').onclick = () => {
        settings[key] = Math.max(-0.35, Math.min(0.35, Math.round(((settings[key] || 0) + secs) * 100) / 100));
        saveSettings();
        const o = flight.opts.timingOffset || (flight.opts.timingOffset = { voice: 0, typed: 0 });
        o[kind] = settings[key];                    // applies right away
        $('coach').classList.add('hidden');
        toast('Timing correction for ' + (kind === 'voice' ? 'voice' : 'typing') + ': ' + fmtOffset(settings[key]), 'good');
        setTimeout(() => $('commandBox').focus(), 0);
      };
    },
    onEnd: res => showResults(res),
  });
  activeRun = run;
  $('btnFinish').classList.remove('hidden');
  $('btnFinish').textContent = def.reportOut ? '✔ End evaluation' : '✔ Finish';
  $('drillCard').classList.toggle('hidden', !run.objectives.some(o => o.type === 'movement'));
  $('objective').classList.remove('hidden');
  updateRunHud(true);
  return run;
}

// Refresh the objective tracker (called by the map every frame; redraws a few times a second)
let runHudAt = 0;
function updateRunHud(force) {
  const run = activeRun;
  if (!run || (!force && performance.now() - runHudAt < 250)) return;
  runHudAt = performance.now();
  const def = run.def, s = SCORING.summary(SCORING.records(run.events));
  const t = def.timer;
  const clock = t && t.limitSeconds ? formatClock(t.limitSeconds - run.elapsed) : formatClock(run.elapsed);
  const pct = v => v === null ? '–' : v + '%';
  let html = '<div class="row"><b>' + esc(def.title) + '</b><span class="clock">' + clock + '</span></div>';
  // Timing calibration
  if (def.calibrate) {
    const n = Math.max(run.taps.voice.length, run.taps.typed.length);
    html += '<div class="stats">Say <b>HARCH</b> (or type <b>harch</b> + Enter) each time the <b>RIGHT</b> heel strikes: the metronome needle on the R side. ' +
            '<b>' + n + ' / ' + def.calibrate.taps + '</b></div><div class="bar"><i style="width:' + (100 * n / def.calibrate.taps) + '%"></i></div>' +
            '<div class="stats">Current correction: voice ' + fmtOffset(settings.timingOffsetVoice) + ' · typing ' + fmtOffset(settings.timingOffsetTyped) + '</div>';
    $('objective').innerHTML = html;
    return;
  }
  // Live missions: next checkpoint (distance + direction), progress, courtesy tally
  if (def.mode === 'Live') {
    const next = run.nextCheckpoint(), done = run.objectives.filter(o => o.done).length;
    if (next) {
      const deg = (Math.atan2(next.dx, -next.dy) * 180 / Math.PI + 360) % 360;
      const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
      html += '<div class="stats">Next: <b>' + esc(next.o.label) + '</b> · ' + Math.round(next.meters) + ' m ' + compass +
              ' <span style="display:inline-block;transform:rotate(' + deg + 'deg)">⬆</span></div>';
    } else if (run.objectives.some(o => o.type === 'movement')) {
      html += '<div class="stats">Movements <b>' + done + ' / ' + run.objectives.length + '</b> (see the card)' +
              (run.inArea ? '' : ' · <span class="no">outside the field</span>') + '</div>';
      renderDrillCard(run);
    }
    html += '<div class="bar"><i style="width:' + (100 * done / run.objectives.length) + '%"></i></div>';
    const c = run.courtesy && run.courtesy.summary();
    if (c) html += '<div class="stats">Courtesy ✔ ' + c.correct + ' · missed ' + c.missed + ' · wrong ' + c.wrong + ' · no salute ' + c.noSalute +
                   (run.offRoute > 1 && run.route ? ' · <span class="no">off route</span>' : '') + '</div>';
    if (run.courtesy && activeScene && activeScene.difficulty && activeScene.difficulty.prompts) {
      [...run.courtesy.open.values()].filter(it => !it.greeted || (run.courtesy.needsSalute(it.p) && !it.saluted)).forEach(it => {
        html += '<div class="say">' + esc(personLabel(it.p)) + (run.courtesy.needsSalute(it.p) && !it.saluted ? ' — salute (SALUTE) and greet' : ' — greet') + '</div>';
      });
    }
    $('objective').innerHTML = html;
    return;
  }
  // Tanks: lives, wave, score
  const tg = activeScene && activeScene.tanks;
  if (tg) {
    html += '<div class="stats">Lives <b style="color:var(--bad)">' + '♥'.repeat(Math.max(0, tg.lives)) + '</b>' +
            '<span class="na">' + '♥'.repeat(Math.max(0, tg.rules.lives - tg.lives)) + '</span> · Wave <b>' + tg.wave + ' / ' + tg.rules.waves.length +
            '</b> · Flanked <b>' + tg.score + '</b> · Enemies left <b>' + tg.aliveEnemies().length + '</b></div>' +
            '<div class="stats">Hit their side with your FRONT. Don\'t let their front hit your side, don\'t meet head-on, stay inside the pad.</div>';
    $('objective').innerHTML = html;
    return;
  }
  // Evaluations: what to do now (planning, report in, clock, report out)
  if (def.reportIn) {
    if (!run.reportedIn) $('btnTurn').classList.toggle('hidden', !planningTurn);
    else $('btnTurn').classList.add('hidden');
    const done = run.objectives.filter(o => o.done).length;
    if (run.stage === 'planning') {
      html += '<div class="stats"><span class="stage">Planning ' + formatClock(run.planningLeft) + '</span> · read the drill card, ' +
              'click the pad to place the flight, ↻ to turn it. Then report in:</div><div class="say">' + esc(def.reportIn.say) + '</div>';
    } else if (run.stage === 'report') {
      html += '<div class="stats"><span class="stage">Planning time is up.</span> Report in:</div><div class="say">' + esc(def.reportIn.say) + '</div>';
    } else if (run.stage === 'ready') {
      html += '<div class="stats">Reported in. The clock starts at your first drill movement.</div>';
    } else {
      html += '<div class="stats">Movements <b>' + done + ' / ' + run.objectives.length + '</b>' + (run.inArea ? '' : ' · <span class="no">OUTSIDE THE CONES: return to the drill area</span>') +
              ' · boundary breaks ' + run.boundaryBreaks + '</div>' +
              '<div class="bar"><i style="width:' + (100 * done / run.objectives.length) + '%"></i></div>' +
              (done === run.objectives.length ? '<div class="say">' + esc(def.reportOut.say) + '</div>' : '');
    }
    renderDrillCard(run);
    $('objective').innerHTML = html;
    return;
  }
  run.objectives.filter(o => o.type === 'cleanStreak').forEach(o => {
    html += '<div class="stats">Streak: <b>' + (o.progress || 0) + ' / ' + o.count + '</b> commands without an error</div>' +
            '<div class="bar"><i style="width:' + Math.min(100, 100 * (o.progress || 0) / o.count) + '%"></i></div>';
  });
  html += '<div class="stats">' + s.given + ' commands · ' + pct(s.accuracy) + ' without a mistake · ' +
          pct(s.onTime) + ' on the correct heel · best streak ' + s.bestStreak + '</div>';
  $('objective').innerHTML = html;
}

// Campus courtesy panel: who is waiting for a greeting / salute, and the tally so far
let activeCourtesy = null;          // CourtesyMonitor on the campus (courtesy.js)
let courtesyHudAt = 0;
function updateCourtesyHud(mon) {
  if (performance.now() - courtesyHudAt < 300) return;
  courtesyHudAt = performance.now();
  const s = mon.summary(), open = [...mon.open.values()].filter(it => !it.greeted || (mon.needsSalute(it.p) && !it.saluted));
  let h = '<div class="row"><b>Military courtesy</b><span class="na">' + (COURTESY.confirmed ? '' : 'greeting rules: placeholder') + '</span></div>';
  h += '<div class="stats">✔ ' + s.correct + ' · missed ' + s.missed + ' · wrong words ' + s.wrong + ' · no salute ' + s.noSalute + '</div>';
  open.forEach(it => {
    const officer = mon.needsSalute(it.p);
    h += '<div class="say">' + esc(personLabel(it.p)) + (officer && !it.saluted ? ' — salute (type SALUTE) and greet' : ' — greet') + '</div>';
  });
  $('objective').innerHTML = h;
  $('objective').classList.remove('hidden');
}

// The drill card (movement checklist) on the right
function renderDrillCard(run) {
  const card = '<h4>Drill card</h4><ol>' + run.objectives.filter(o => o.type === 'movement')
    .map(o => '<li class="' + (o.done ? 'done' : '') + '">' + esc(o.label) + '</li>').join('') + '</ol>';
  if ($('drillCard').innerHTML !== card) $('drillCard').innerHTML = card;
}

const esc = t => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// The results / debrief screen
function showResults(res) {
  lastResults = res;
  if (!res._saved) { res._saved = true; STATS.record(res); }   // My stats (this device only)
  const s = res.summary;
  const pct = v => v === null ? '–' : v + '%';
  const tile = (v, l, cls) => '<div class="tile ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
  const grade = (v, good, ok) => v === null ? '' : v >= good ? 'good' : v >= ok ? 'warn' : 'bad';
  const statusText = { complete: 'Complete ✔', timeout: 'Time is up', finished: 'Session finished', running: '',
                       'reported-out': 'Reported out' }[res.status] || res.status;
  if (res.debrief) { showFdeResults(res, statusText); return; }
  if (res.tanks) { showTanksResults(res); return; }
  if (res.scenario === 'calibrate') { showCalibrationResults(res); return; }
  if (res.live) { showLiveResults(res, statusText); return; }
  let h = '<h2>' + esc(res.title) + '</h2><p class="sub">' + esc(res.mode) + ' · ' + statusText + ' · time ' + formatClock(res.elapsed) + '</p>';
  h += '<div class="tiles">' +
       tile(s.given, 'commands given') +
       tile(pct(s.accuracy), 'without a mistake', grade(s.accuracy, 90, 70)) +
       tile(pct(s.onTime), 'command of execution on the correct heel', grade(s.onTime, 90, 70)) +
       tile(s.prepGraded ? pct(s.prepOnTime) : '–', s.prepGraded ? 'preparatory command on time' :
            'preparatory command (graded with voice or two-part typing)', grade(s.prepGraded ? s.prepOnTime : null, 90, 70)) +
       tile(s.refused, 'refused (not executed)', s.refused ? 'bad' : 'good') +
       tile(s.bestStreak, 'best streak without an error') + '</div>';
  if (res.objectives.length) {
    h += '<h3>Objectives (' + res.completed + ' / ' + res.objectives.length + ')</h3><ul class="checklist">' +
         res.objectives.map(o => '<li class="' + (o.done ? 'ok' : 'no') + '">' + (o.done ? '✔ ' : '✘ ') + esc(o.label) +
         (o.count ? ' (best ' + Math.max(o.progress || 0, s.bestStreak) + ')' : '') + '</li>').join('') + '</ul>';
  }
  if (res.boundaryBreaks) h += '<p class="sub">Boundary breaks: ' + res.boundaryBreaks + '</p>';
  const mistakes = s.mistakes.slice(-12);
  h += '<h3>' + (mistakes.length ? 'Work on these' + (s.mistakes.length > 12 ? ' (last 12)' : '') : 'No mistakes. Well done.') + '</h3>';
  mistakes.forEach(r => {
    const hint = SCORING.hint(r);
    h += '<div class="mistake"><b>' + esc(r.text.trim()) + '</b> (' + formatClock(r.time - (res.records[0] ? res.records[0].time : 0)) +
         ') — ' + esc(SCORING.problems(r).join('; ')) + (hint ? '<div class="fix">✔ ' + esc(hint) + '</div>' : '') + '</div>';
  });
  if (res.records.length) {
    const cell = (v, map) => '<td class="' + (map[v] ? map[v][1] : 'na') + '">' + (map[v] ? map[v][0] : '–') + '</td>';
    const T = { ok: ['✔', 'ok'], 'wrong-foot': ['wrong foot', 'no'], off: ['off beat', 'meh'], pending: ['…', 'na'] };
    const P = { ok: ['✔', 'ok'], off: ['✘', 'no'], 'not-graded': ['–', 'na'] };
    h += '<details><summary>Every command (' + res.records.length + ')</summary><table class="list"><tr><th>#</th><th>Command</th>' +
         '<th>Execution</th><th>Preparatory</th><th>Wording</th><th>Result</th></tr>' +
         res.records.map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(r.text.trim()) + '</td>' + cell(r.timing, T) + cell(r.prep, P) +
           '<td class="' + (r.wording === 'ok' ? 'ok' : 'no') + '">' + (r.wording === 'ok' ? '✔' : r.wording) + '</td>' +
           '<td class="' + (r.executed ? 'ok' : 'no') + '">' + (r.executed ? 'executed' : esc(r.reason)) + '</td></tr>').join('') +
         '</table></details>';
  }
  h += '<div class="sheet-actions"><button class="btn" id="resultsMenu">☰ Main menu</button>' +
       '<button class="btn primary" id="resultsAgain">↻ Again</button></div>';
  $('resultsSheet').innerHTML = h;
  $('resultsMenu').onclick = () => openScene('Menu');
  $('resultsAgain').onclick = () => openScene('DrillPad');
  showScreen('results');
}

// FDE results and debrief (no /100 score: the point is the most efficient ORDER of commands)
function showFdeResults(res, statusText) {
  const d = res.debrief, s = res.summary;
  const tile = (v, l, cls) => '<div class="tile ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
  let h = '<h2>' + esc(res.title) + '</h2><p class="sub">' + esc(statusText) + (res.message ? ' · <b>' + esc(res.message) + '</b>' : '') + '</p>';
  h += '<div class="tiles">' +
       tile(res.completed + ' / ' + res.objectives.length, 'movements completed', res.completed === res.objectives.length ? 'good' : 'bad') +
       tile(formatClock(res.elapsed), 'time used (limit ' + formatClock(res.limit) + ')', res.elapsed <= res.limit && res.status !== 'timeout' ? 'good' : 'bad') +
       tile(d.given, 'commands given (efficient: ' + d.efficient + ')', d.given <= d.efficient ? 'good' : d.given <= d.efficient + 5 ? 'warn' : 'bad') +
       tile(d.outside + ' / ' + res.boundaryBreaks, 'commands outside the cones / boundary breaks', d.outside || res.boundaryBreaks ? 'bad' : 'good') +
       tile(d.refused, 'commands refused', d.refused ? 'bad' : 'good') +
       tile(s.onTime === null ? '–' : s.onTime + '%', 'on the correct heel', s.onTime === null ? '' : s.onTime >= 90 ? 'good' : 'warn') + '</div>';
  h += '<h3>Drill card</h3><ul class="checklist">' + res.objectives.map(o => '<li class="' + (o.done ? 'ok' : 'no') + '">' +
       (o.done ? '✔ ' + esc(o.label) + ' <span class="na">' + formatClock(o.doneAt) + '</span>' : '✘ ' + esc(o.label)) + '</li>').join('') + '</ul>';
  h += '<h3>Debrief: where time and commands were lost</h3><ul class="tips">' + d.tips.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>';
  h += '<h3>Your order vs. an efficient order</h3><div class="order-cols"><div><b>Yours (' + d.given + ')</b><ol>' +
       d.yourOrder.map(c => '<li class="' + (!c.inArea ? 'out' : c.repeat ? 'rep' : '') + '">' + esc(c.text) +
         (!c.inArea ? ' (outside: did not count)' : '') + '</li>').join('') + '</ol></div>' +
       '<div><b>Efficient (' + d.efficient + ')</b><ol>' + d.efficientOrder.map(t => '<li>' + esc(t) + '</li>').join('') + '</ol></div></div>';
  h += '<h3>Why that order works</h3><ul class="tips">' + d.efficientNotes.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>';
  h += '<div class="sheet-actions"><button class="btn" id="resultsMenu">☰ Main menu</button>' +
       '<button class="btn primary" id="resultsAgain">↻ Again</button></div>';
  $('resultsSheet').innerHTML = h;
  $('resultsMenu').onclick = () => openScene('Menu');
  $('resultsAgain').onclick = () => openScene('DrillPad');
  showScreen('results');
}

// My stats: progress over time, best per mode, accuracy by command (stats.js; this device only)
function showStats() {
  const o = STATS.overview(), t = o.totals;
  const tile = (v, l, cls) => '<div class="tile ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
  const pct = v => v === null || v === undefined ? '–' : v + '%';
  let h = '<h2>My stats</h2><p class="sub">Saved in this browser on this computer only. No name or account.</p>';
  if (!t.sessions) {
    h += '<p class="sub">No sessions yet. Finish a Practice, FDE, Tanks or Live session and its results appear here.</p>';
  } else {
    h += '<div class="tiles">' + tile(t.sessions, 'sessions') + tile(t.commands, 'commands given') +
         tile(pct(t.accuracy), 'commands without a mistake', t.accuracy >= 90 ? 'good' : t.accuracy >= 70 ? 'warn' : 'bad') +
         tile(Math.round(t.seconds / 60) + ' min', 'time drilling') + '</div>';
    if (o.trend.length >= 2) {                           // accuracy over the last sessions, as a small line chart
      const W = 820, H = 120, n = o.trend.length;
      const pts = (k) => o.trend.map((e, i) => (i * (W - 20) / (n - 1) + 10).toFixed(1) + ',' + (H - 10 - (e[k] || 0) * (H - 20) / 100).toFixed(1)).join(' ');
      h += '<h3>Progress (last ' + n + ' sessions)</h3><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;background:#1a232e;border-radius:6px">' +
           [25, 50, 75, 100].map(v => '<line x1="10" x2="' + (W - 10) + '" y1="' + (H - 10 - v * (H - 20) / 100) + '" y2="' + (H - 10 - v * (H - 20) / 100) +
             '" stroke="rgba(255,255,255,0.08)"/>').join('') +
           '<polyline fill="none" stroke="#6be38a" stroke-width="3" points="' + pts('accuracy') + '"/>' +
           '<polyline fill="none" stroke="#4fa3ff" stroke-width="2" stroke-dasharray="6 5" points="' + pts('onTime') + '"/></svg>' +
           '<p class="sub"><span class="ok">━</span> without a mistake &nbsp; <span style="color:var(--accent)">╍</span> on the correct heel</p>';
    }
    if (o.best.length) h += '<h3>Best results</h3><table class="list"><tr><th>Mode</th><th>Record</th><th>Value</th><th>Date</th></tr>' +
      o.best.map(b => '<tr><td>' + esc(b.mode) + '</td><td>' + esc(b.label) + '</td><td><b>' + esc(b.label.includes('(s)') ? formatClock(b.value) : b.value) +
        '</b></td><td class="na">' + esc(b.date.slice(0, 10)) + '</td></tr>').join('') + '</table>';
    if (o.mostMissed.length) h += '<h3>Most-missed commands</h3>' + o.mostMissed.map(c => {
      const why = [c.wrongFoot && c.wrongFoot + ' wrong foot', c.off && c.off + ' off the beat', c.prepOff && c.prepOff + ' preparatory off',
                   c.sloppy && c.sloppy + ' sloppy wording', c.refused && c.refused + ' refused'].filter(Boolean).join(', ');
      const cmd = COMMANDS_BY_KEY[c.key];
      return '<div class="mistake"><b>' + esc(c.name) + '</b> — ' + c.mistakes + ' of ' + c.given + ' (' + esc(why) + ')' +
             (cmd ? '<div class="fix">✔ ' + esc(SCORING.howTo(cmd)) + '</div>' : '') + '</div>';
    }).join('');
    h += '<details><summary>Accuracy by command (' + o.byCommand.length + ')</summary><table class="list"><tr><th>Command</th><th>Given</th>' +
         '<th>Without a mistake</th><th>Wrong foot</th><th>Refused</th></tr>' + o.byCommand.map(c => '<tr><td>' + esc(c.name) + '</td><td>' + c.given +
         '</td><td class="' + (c.accuracy >= 90 ? 'ok' : c.accuracy >= 70 ? 'meh' : 'no') + '">' + pct(c.accuracy) + '</td><td>' + c.wrongFoot +
         '</td><td>' + c.refused + '</td></tr>').join('') + '</table></details>';
    h += '<details><summary>Recent sessions</summary><table class="list"><tr><th>Date</th><th>Mode</th><th>Session</th><th>Commands</th><th>Result</th></tr>' +
         o.recent.map(e => '<tr><td class="na">' + esc(e.date.slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(e.mode) + '</td><td>' + esc(e.title) +
           '</td><td>' + e.given + '</td><td>' + esc(e.liveScore !== undefined && e.liveScore !== null ? 'score ' + e.liveScore :
             e.fdeMovements !== undefined ? e.fdeMovements + '/20 in ' + formatClock(e.seconds) : e.tanksScore !== undefined ? e.tanksScore + ' flanked' :
             pct(e.accuracy) + ' clean') + '</td></tr>').join('') + '</table></details>';
  }
  h += '<div class="sheet-actions">' + (t.sessions ? '<button class="btn" id="statsClear">Delete my stats</button>' : '') +
       '<button class="btn primary" id="statsBack">◀ Back</button></div>';
  $('statsSheet').innerHTML = h;
  $('statsBack').onclick = () => showScreen('menu');
  if ($('statsClear')) $('statsClear').onclick = () => { if (confirm('Delete all saved stats on this computer?')) { STATS.clear(); showStats(); } };
  showScreen('stats');
}

// Live mission briefing (before the flight steps off)
function showBriefing(def, difficulty) {
  if (LINK.brief === '0') return;                                // ?brief=0: straight to the map (screenshots)
  let h = '<h2>' + esc(def.title) + '</h2><p class="sub">Live mission · ' + esc(difficulty.label) + ' · true-scale Auburn campus</p>';
  h += '<h3>Briefing</h3><ul class="tips">' + def.briefing.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>';
  h += '<h3>Objectives</h3><ol class="tips">' + def.objectives.map(o => '<li>' + esc(o.label) + '</li>').join('') + '</ol>';
  h += '<h3>Remember</h3><ul class="tips">' + (def.usesRoadGuards ? '<li>Road guards (more than 8 in the flight): halt before the intersection, <code>Road Guards, OUT</code>, march through, <code>Road Guards, IN</code>.</li>' : '') +
       '<li>Stairs: <code>Route Step, HARCH</code> first, <code>Flight, Ten-HUT</code> after.</li>' +
       '<li>Cadre: <code>SALUTE</code> and <code>Good morning, Captain Moore</code> (rank + last name). POC: <code>Good morning, Cadet Captain Reed</code>; ' +
       'a group of POC: <code>Good morning, gentlemen</code> / <code>ladies</code>. Civilians: <code>Pardon my flight please, Sir/Ma\'am</code>.</li>' +
       '<li>Score: 100 minus penalties (no road guards −15, obstacle −10, stairs at attention −5, missed greeting or salute −4, off route, refused or wrong-foot commands).</li></ul>';
  h += '<div class="sheet-actions"><button class="btn" id="briefingMenu">☰ Main menu</button><button class="btn primary" id="briefingStart">▶ Start</button></div>';
  $('briefingSheet').innerHTML = h;
  $('briefingMenu').onclick = () => openScene('Menu');
  $('briefingStart').onclick = () => { showScreen('play'); setTimeout(() => $('commandBox').focus(), 0); };
  showScreen('briefing');
}

// Live mission debrief with the score
function showLiveResults(res, statusText) {
  const L = res.live, s = res.summary;
  const tile = (v, l, cls) => '<div class="tile ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
  let h = '<h2>' + esc(res.title) + '</h2><p class="sub">Live mission · ' + esc(statusText) + ' · time ' + formatClock(res.elapsed) + '</p><div class="tiles">' +
          tile(res.status === 'complete' ? L.score : '–', 'score / 100' + (res.status === 'complete' ? '' : ' (mission not completed)'),
               res.status !== 'complete' ? 'bad' : L.score >= 90 ? 'good' : L.score >= 70 ? 'warn' : 'bad') +
          tile(res.completed + ' / ' + res.objectives.length, 'objectives', res.completed === res.objectives.length ? 'good' : 'bad') +
          tile(L.roadGuards.length, 'times road guards posted') +
          tile(L.courtesy.correct + ' / ' + (L.courtesy.total || 0), 'courtesies correct', L.courtesy.total && L.courtesy.correct < L.courtesy.total ? 'warn' : 'good') +
          tile(s.onTime === null ? '–' : s.onTime + '%', 'on the correct heel', s.onTime === null ? '' : s.onTime >= 90 ? 'good' : 'warn') +
          tile(s.given, 'commands given') + '</div>';
  h += '<h3>Points lost</h3>' + (L.breakdown.length ? '<table class="list"><tr><th>What</th><th>Times</th><th>Points</th></tr>' +
       L.breakdown.map(b => '<tr><td>' + esc(b.label) + '</td><td>' + b.count + '</td><td class="no">−' + b.points + '</td></tr>').join('') + '</table>'
       : '<p class="sub">None. Outstanding.</p>');
  h += '<h3>Objectives</h3><ul class="checklist">' + res.objectives.map(o => '<li class="' + (o.done ? 'ok' : 'no') + '">' + (o.done ? '✔ ' : '✘ ') +
       esc(o.label) + (o.done ? ' <span class="na">' + formatClock(o.doneAt) + '</span>' : '') + '</li>').join('') + '</ul>';
  const cr = (L.courtesy.results || []).filter(r => r.outcome !== 'correct');
  if (cr.length) h += '<h3>Courtesy to work on</h3>' + cr.map(r => '<div class="mistake"><b>' + esc(r.who) + '</b> — ' + esc(r.outcome.replace('-', ' ')) +
       (r.detail ? ': ' + esc(r.detail) : '') + '<div class="fix">✔ "' + esc(r.expected) + '"</div></div>').join('');
  const mistakes = s.mistakes.slice(-8);
  if (mistakes.length) h += '<h3>Commands to work on</h3>' + mistakes.map(r => '<div class="mistake"><b>' + esc(r.text.trim()) + '</b> — ' +
       esc(SCORING.problems(r).join('; ')) + '</div>').join('');
  h += '<div class="sheet-actions"><button class="btn" id="resultsMenu">☰ Main menu</button><button class="btn primary" id="resultsAgain">↻ Again</button></div>';
  $('resultsSheet').innerHTML = h;
  $('resultsMenu').onclick = () => openScene('Menu');
  $('resultsAgain').onclick = () => openScene('Campus');
  showScreen('results');
}

// "+0.12 s (late)" for a timing correction
function fmtOffset(v) { v = v || 0; return v === 0 ? 'none' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' s'; }

// Timing calibration result: save the correction for voice or typing
function showCalibrationResults(res) {
  const c = res.calibration;
  let h = '<h2>Timing calibration</h2>';
  if (!c) {
    h += '<p class="sub">Not finished: give HARCH on the right heel 8 times. Nothing was changed.</p>';
  } else {
    const key = c.kind === 'voice' ? 'timingOffsetVoice' : 'timingOffsetTyped';
    settings[key] = c.offset; saveSettings();
    h += '<p class="sub">' + (c.kind === 'voice' ? 'Voice' : 'Typing') + ': your beats arrived on average <b>' + Math.abs(c.offset).toFixed(2) + ' s ' +
         (c.offset >= 0 ? 'late' : 'early') + '</b>. From now on the game allows for this (saved on this computer).</p>';
    h += '<p class="sub">Beats: ' + c.beats.map(b => (b >= 0 ? '+' : '−') + Math.abs(b).toFixed(2)).join(', ') + ' s</p>' +
         '<p class="sub">Run it again any time (for example after changing microphone). The on-time window is ±' +
         DRILL.disorder.timingGraceSeconds.toFixed(2) + ' s or more.</p>';
  }
  h += '<div class="sheet-actions"><button class="btn" id="calReset">Reset both corrections</button><button class="btn" id="resultsMenu">☰ Main menu</button>' +
       '<button class="btn primary" id="resultsAgain">↻ Again</button></div>';
  $('resultsSheet').innerHTML = h;
  $('calReset').onclick = () => { settings.timingOffsetVoice = 0; settings.timingOffsetTyped = 0; saveSettings(); toast('Timing corrections reset to none', 'good'); };
  $('resultsMenu').onclick = () => openScene('Menu');
  $('resultsAgain').onclick = () => openScene('DrillPad');
  showScreen('results');
}

// Tanks results
function showTanksResults(res) {
  const t = res.tanks, s = res.summary;
  const tile = (v, l, cls) => '<div class="tile ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
  const head = t.status === 'won' ? 'Victory ✔ every wave cleared' : t.status === 'lost' ? 'Out of lives' : 'Game ended';
  let h = '<h2>Tanks</h2><p class="sub">' + head + ' · time ' + formatClock(t.time) + '</p><div class="tiles">' +
          tile(t.score, 'enemy flights flanked', t.score ? 'good' : '') +
          tile(t.wave + ' / ' + t.waves, 'wave reached', t.status === 'won' ? 'good' : '') +
          tile(t.lives + ' / ' + t.startLives, 'lives left', t.lives ? 'good' : 'bad') +
          tile(s.given, 'commands given') +
          tile(s.onTime === null ? '–' : s.onTime + '%', 'on the correct heel', s.onTime === null ? '' : s.onTime >= 90 ? 'good' : 'warn') +
          tile(s.refused, 'commands refused', s.refused ? 'bad' : 'good') + '</div>';
  if (t.livesLost.length) h += '<h3>Lives lost</h3><ul class="tips">' + t.livesLost.map(e => '<li>' + formatClock(e.time) + ' — ' + esc(e.reason) + '</li>').join('') + '</ul>';
  if (t.eliminated.length) h += '<h3>Flanked</h3><ul class="tips">' + t.eliminated.map(e => '<li>' + formatClock(e.time) + ' — ' + esc(e.name) + '</li>').join('') + '</ul>';
  h += '<h3>Tips</h3><ul class="tips"><li>Flanks (Right/Left Flank, HARCH) turn your whole front 90 degrees in one step: the fastest way to hit a flight passing beside you.</li>' +
       '<li>Column movements take about 8 steps to finish; start them early.</li><li>To the Rear gets your front away from an enemy front (no head-on).</li></ul>';
  h += '<div class="sheet-actions"><button class="btn" id="resultsMenu">☰ Main menu</button><button class="btn primary" id="resultsAgain">↻ Again</button></div>';
  $('resultsSheet').innerHTML = h;
  $('resultsMenu').onclick = () => openScene('Menu');
  $('resultsAgain').onclick = () => openScene('DrillPad');
  showScreen('results');
}

// The Practice card's choices, from scenarios.js
function buildPracticeChoices() {
  $('practiceChoices').innerHTML = '';
  Object.values(SCENARIOS).filter(d => d.mode === 'Practice').forEach(d => {
    const b = document.createElement('button');
    b.className = 'btn' + (d.id === 'practice' ? ' primary' : '');
    b.textContent = d.title;
    b.title = d.blurb || '';
    b.onclick = e => { e.stopPropagation(); currentScenario = d.id; openScene(d.map); };
    $('practiceChoices').appendChild(b);
  });
}

// The Live card: difficulty + free march + missions (scenarios.js, mode 'Live')
function buildLiveChoices() {
  const seg = $('liveDifficulty');
  seg.innerHTML = '';
  Object.keys(LIVE_DIFFICULTY).forEach(k => {
    const b = document.createElement('button');
    b.textContent = LIVE_DIFFICULTY[k].label;
    b.className = settings.liveDifficulty === k ? 'sel' : '';
    b.onclick = e => { e.stopPropagation(); settings.liveDifficulty = k; saveSettings(); buildLiveChoices(); };
    seg.appendChild(b);
  });
  const box = $('liveChoices');
  box.innerHTML = '';
  const add = (title, id, tip, primary) => {
    const b = document.createElement('button');
    b.className = 'btn' + (primary ? ' primary' : '');
    b.textContent = title; b.title = tip || '';
    b.onclick = e => { e.stopPropagation(); currentScenario = id; openScene('Campus'); };
    box.appendChild(b);
  };
  Object.values(SCENARIOS).filter(d => d.mode === 'Live').forEach((d, i) => add(d.title, d.id, d.blurb, i === 0));
  add('Free march', 'free', 'March anywhere on campus (no objectives)');
}

// The full command reference screen, from drill-rules.js
function buildReference() {
  const groups = [
    { title: 'At the halt', when: ['halt'] },
    { title: 'At the halt or marching', when: ['both'] },
    { title: 'While marching', when: ['marching'] },
    { title: 'After every halt', when: ['afterHalt'] },
  ];
  let html = '';
  groups.forEach(g => {
    const cmds = DRILL.commands.filter(c => g.when.includes(c.when));
    if (!cmds.length) return;
    html += '<h3>' + g.title + '</h3><table class="list"><tr><th>Command</th><th>Foot (marching)</th><th>How to give it / notes</th><th>DAFPAM</th></tr>';
    cmds.forEach(c => {
      const how = g.when.includes('halt') && g.when.length === 1 ? '' : SCORING.howTo(c);
      html += '<tr><td><code>' + esc(c.say) + '</code></td><td>' + (c.foot ? esc(c.foot) : '–') + '</td><td>' +
              esc([how, c.note && c.note[0].toUpperCase() + c.note.slice(1) + '.'].filter(Boolean).join(' ')) + '</td><td>' + esc(c.ref || '') + '</td></tr>';
    });
    html += '</table>';
  });
  $('referenceTable').innerHTML = html;
}

// ---------- Camera buttons ----------
let activeCamera = null;
function setActiveCamera(cam) {
  activeCamera = cam;
  cam.onChange = c => {
    $('zoomLabel').textContent = Math.round(c.targetZoom * 100) + '%';
    $('btnFollow').classList.toggle('on', c.follow);
  };
  cam.onChange(cam);
}

// ---------- The flight that typed/spoken commands go to ----------
let activeFlight = null;
function setActiveFlight(flight) {
  activeFlight = flight;
  if (flight) setTimeout(() => $('commandBox').focus(), 0);
}

// ---------- Messages ----------
// good: true (green ✔), false (red ✘), 'warn' (yellow ⚠: carried out, but sloppily) or 'info' (blue)
function showFeedback(message, good) {
  const log = $('log');
  [...log.children].forEach(m => m.classList.add('old'));
  const m = document.createElement('div');
  m.className = 'msg panel ' + (good === 'warn' ? 'warn' : good === 'info' ? 'info' : good ? 'good' : 'bad');
  m.textContent = message;
  log.appendChild(m);
  const keep = $('p-log').classList.contains('max') ? 10 : 4;          // maximized: more messages
  while (log.children.length > keep) log.removeChild(log.firstChild);
}

function showStatus(text) { $('status').textContent = text; }

function toast(message, kind) {
  const t = document.createElement('div');
  t.className = 'toast panel msg ' + (kind || '');
  t.textContent = message;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- Command reference, built from drill-rules.js ----------
function buildCommandList() {
  const groups = [
    { title: 'At the halt',      when: ['halt', 'both'],     marching: false },
    { title: 'While marching',   when: ['marching', 'both'], marching: true },
    { title: 'After every halt', when: ['afterHalt'],        marching: false },
  ];
  // Campus courtesy panel: who is waiting for a greeting / salute, and the tally so far
let activeCourtesy = null;          // CourtesyMonitor on the campus (courtesy.js)
let courtesyHudAt = 0;
function updateCourtesyHud(mon) {
  if (performance.now() - courtesyHudAt < 300) return;
  courtesyHudAt = performance.now();
  const s = mon.summary(), open = [...mon.open.values()].filter(it => !it.greeted || (mon.needsSalute(it.p) && !it.saluted));
  let h = '<div class="row"><b>Military courtesy</b><span class="na">' + (COURTESY.confirmed ? '' : 'greeting rules: placeholder') + '</span></div>';
  h += '<div class="stats">✔ ' + s.correct + ' · missed ' + s.missed + ' · wrong words ' + s.wrong + ' · no salute ' + s.noSalute + '</div>';
  open.forEach(it => {
    const officer = mon.needsSalute(it.p);
    h += '<div class="say">' + esc(personLabel(it.p)) + (officer && !it.saluted ? ' — salute (type SALUTE) and greet' : ' — greet') + '</div>';
  });
  $('objective').innerHTML = h;
  $('objective').classList.remove('hidden');
}

const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let html = '';
  groups.forEach(g => {
    html += '<p><b>' + g.title + '</b></p><ul>';
    DRILL.commands.filter(c => g.when.includes(c.when)).forEach(c => {
      const extras = [];
      if (g.marching && c.foot) extras.push(c.foot + ' foot');
      if (c.note && (g.marching || c.when !== 'both')) extras.push(c.note);
      html += '<li><code>' + esc(c.say) + '</code>' + (extras.length ? ' (' + esc(extras.join('; ')) + ')' : '') + '</li>';
    });
    html += '</ul>';
  });
  $('commandList').innerHTML = html;
}

// ---------- Settings screen, built from SETTING_OPTIONS (settings.js) ----------
function buildSettings() {
  const rows = $('settingsRows');
  rows.innerHTML = '';
  SETTING_OPTIONS.forEach(opt => {
    const row = document.createElement('div');
    row.className = 'setting';
    const label = document.createElement('label');
    label.textContent = opt.label;
    const seg = document.createElement('div');
    seg.className = 'seg';
    opt.values.forEach(v => {
      const b = document.createElement('button');
      b.textContent = opt.show(v);
      b.className = settings[opt.key] === v ? 'sel' : '';
      b.onclick = () => { settings[opt.key] = v; saveSettings(); buildSettings(); };
      seg.appendChild(b);
    });
    row.appendChild(label);
    row.appendChild(seg);
    rows.appendChild(row);
  });
}

// ---------- HUD panels: minimize, maximize, move (saved on this computer) ----------
const HUD_KEY = 'drillSimulator.hud.v1';
function hudLayout() { try { return JSON.parse(localStorage.getItem(HUD_KEY) || '{}'); } catch (e) { return {}; } }
function saveHudLayout(l) { try { localStorage.setItem(HUD_KEY, JSON.stringify(l)); } catch (e) { /* private window */ } }

function applyHudLayout() {
  const l = hudLayout();
  document.querySelectorAll('.hudp').forEach(p => {
    const st = l[p.dataset.panel] || {};
    p.classList.toggle('min', !!st.min);
    p.classList.toggle('max', !!st.max);
    p.classList.toggle('moved', st.x !== undefined);
    p.style.left = st.x !== undefined ? Math.min(st.x, window.innerWidth - 80) + 'px' : '';
    p.style.top = st.y !== undefined ? Math.min(st.y, window.innerHeight - 40) + 'px' : '';
    p.style.right = st.x !== undefined ? 'auto' : '';
    p.style.bottom = st.x !== undefined ? 'auto' : '';
    const b = p.querySelector('[data-act="max"]');
    if (b) b.textContent = st.max ? '⤡' : '⤢';
    const m = p.querySelector('[data-act="min"]');
    if (m) m.textContent = st.min ? '+' : '–';
  });
  $('minimapFrame').classList.toggle('hud-off', !!l.mapHidden);
}

function initHudPanels() {
  document.querySelectorAll('.hudp').forEach(p => {
    const head = document.createElement('div');
    head.className = 'ph';
    head.innerHTML = '<span>' + p.dataset.title + '</span><div class="pb">' +
      '<button data-act="min" title="Minimize / restore">–</button><button data-act="max" title="Maximize / normal size">⤢</button></div>';
    p.insertBefore(head, p.firstChild);
    head.querySelectorAll('button').forEach(btn => btn.onclick = e => {
      e.stopPropagation();
      const l = hudLayout(), st = l[p.dataset.panel] = l[p.dataset.panel] || {};
      if (btn.dataset.act === 'min') st.min = !st.min; else { st.max = !st.max; st.min = false; }
      saveHudLayout(l); applyHudLayout();
    });
    // Edit mode: drag a panel by its title
    head.addEventListener('pointerdown', e => {
      if (!document.body.classList.contains('hud-edit') || e.target.tagName === 'BUTTON') return;
      const r = p.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = ev => {
        p.classList.add('moved');
        p.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx)) + 'px';
        p.style.top = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - dy)) + 'px';
        p.style.right = 'auto'; p.style.bottom = 'auto';
      };
      const up = () => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
        const l = hudLayout(), st = l[p.dataset.panel] = l[p.dataset.panel] || {};
        if (p.classList.contains('moved')) { st.x = parseFloat(p.style.left); st.y = parseFloat(p.style.top); saveHudLayout(l); }
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
      e.preventDefault();
    });
  });
  $('btnHudEdit').onclick = () => {
    const on = !document.body.classList.contains('hud-edit');
    document.body.classList.toggle('hud-edit', on);
    $('btnHudEdit').textContent = on ? '✔ Done' : '✎ HUD';
    $('btnHudEdit').classList.toggle('on', on);
    $('btnHudReset').classList.toggle('hidden', !on);
    if (on) toast('Edit the HUD: drag panels by their title; – minimizes, ⤢ maximizes. Click Done when finished.', '');
  };
  $('btnHudReset').onclick = () => { saveHudLayout({}); applyHudLayout(); if (typeof activeScene !== 'undefined' && activeScene && activeScene.showMinimap) activeScene.showMinimap(true); };
  $('btnMap').onclick = () => {
    const l = hudLayout(); l.mapHidden = !l.mapHidden; saveHudLayout(l); applyHudLayout();
    if (activeScene && activeScene.showMinimap) activeScene.showMinimap(!l.mapHidden);
  };
  window.addEventListener('resize', applyHudLayout);
  applyHudLayout();
  if (new URLSearchParams(location.search).get('hudEdit') === '1') setTimeout(() => $('btnHudEdit').click(), 300);   // (screenshots)
}

// ---------- Wiring (called once by main.js) ----------
function wireUi() {
  buildCommandList();
  buildPracticeChoices();
  buildLiveChoices();
  initHudPanels();
  buildReference();
  if (LINK.scenario && SCENARIOS[LINK.scenario]) currentScenario = LINK.scenario;
  document.querySelectorAll('.card[data-open]').forEach(card => { card.onclick = () => openScene(card.dataset.open); });
  $('cardFde').onclick = () => { currentScenario = 'fde'; openScene('DrillPad'); };
  $('cardTanks').onclick = () => { currentScenario = 'tanks'; openScene('DrillPad'); };
  $('menuSettings').onclick = () => showScreen('settings');
  $('menuCommands').onclick = () => showScreen('reference');
  $('referenceBack').onclick = () => showScreen('menu');
  $('menuStats').onclick = () => showStats();
  $('btnFinish').onclick = () => { if (activeRun) activeRun.finish(); };
  $('btnTurn').onclick = () => { if (planningTurn) planningTurn(); };
  $('settingsBack').onclick = () => showScreen('menu');
  $('settingsDefaults').onclick = () => { settings = { ...DEFAULT_SETTINGS }; saveSettings(); buildSettings(); };

  $('btnMenu').onclick = () => openScene('Menu');
  $('btnRef').onclick = () => $('reference').classList.toggle('closed');
  $('btnZoomIn').onclick = () => activeCamera && activeCamera.zoomBy(1.25);
  $('btnZoomOut').onclick = () => activeCamera && activeCamera.zoomBy(0.8);
  $('btnFollow').onclick = () => activeCamera && activeCamera.toggleFollow();

  const box = $('commandBox');
  const submit = () => {
    unlockSound();   // browsers only allow sound after a key press or click
    if (activeFlight && box.value.trim()) routeCommand(box.value);
    box.value = '';
    box.focus();
  };
  box.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  $('sendBtn').onclick = submit;
  $('voiceBtn').onclick = () => { unlockSound(); voice.toggle(); box.focus(); };
  $('resetBtn').onclick = () => { if (activeFlight) activeFlight.reset(); box.focus(); };

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('hud').classList.contains('hidden') || !$('screen-results').classList.contains('hidden') ||
        !$('screen-briefing').classList.contains('hidden')) openScene('Menu');
    else if (!$('screen-settings').classList.contains('hidden') || !$('screen-reference').classList.contains('hidden') ||
             !$('screen-stats').classList.contains('hidden')) showScreen('menu');
  });
}
