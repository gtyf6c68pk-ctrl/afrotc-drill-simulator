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
           seed: q.get('seed') ? Number(q.get('seed')) : null };
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
    const card = '<h4>Drill card</h4><ol>' + run.objectives.map(o => '<li class="' + (o.done ? 'done' : '') + '">' + esc(o.label) + '</li>').join('') + '</ol>';
    if ($('drillCard').innerHTML !== card) $('drillCard').innerHTML = card;
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

const esc = t => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// The results / debrief screen
function showResults(res) {
  lastResults = res;
  const s = res.summary;
  const pct = v => v === null ? '–' : v + '%';
  const tile = (v, l, cls) => '<div class="tile ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
  const grade = (v, good, ok) => v === null ? '' : v >= good ? 'good' : v >= ok ? 'warn' : 'bad';
  const statusText = { complete: 'Complete ✔', timeout: 'Time is up', finished: 'Session finished', running: '',
                       'reported-out': 'Reported out' }[res.status] || res.status;
  if (res.debrief) { showFdeResults(res, statusText); return; }
  if (res.tanks) { showTanksResults(res); return; }
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
  while (log.children.length > 4) log.removeChild(log.firstChild);
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

// ---------- Wiring (called once by main.js) ----------
function wireUi() {
  buildCommandList();
  buildPracticeChoices();
  buildReference();
  if (LINK.scenario && SCENARIOS[LINK.scenario]) currentScenario = LINK.scenario;
  document.querySelectorAll('.card[data-open]').forEach(card => { card.onclick = () => openScene(card.dataset.open); });
  $('cardFde').onclick = () => { currentScenario = 'fde'; openScene('DrillPad'); };
  $('cardTanks').onclick = () => { currentScenario = 'tanks'; openScene('DrillPad'); };
  $('menuSettings').onclick = () => showScreen('settings');
  $('menuCommands').onclick = () => showScreen('reference');
  $('referenceBack').onclick = () => showScreen('menu');
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
    if (!$('hud').classList.contains('hidden') || !$('screen-results').classList.contains('hidden')) openScene('Menu');
    else if (!$('screen-settings').classList.contains('hidden') || !$('screen-reference').classList.contains('hidden')) showScreen('menu');
  });
}
