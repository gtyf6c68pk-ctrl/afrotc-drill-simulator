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
//   scene:    Menu, DrillPad, Campus or Settings
//   start:    campus starting point (lowder / drillfield) for this visit only
//   zoom:     starting zoom (e.g. 0.4)
//   commands: commands to give right away, separated by |  (used by tools/screenshot.sh)
//   at:       look at this spot instead of following the flight, in meters from the map's top-left (e.g. at=520,210)
//   advance:  fast-forward the simulation this many seconds when the map opens (screenshots;
//             headless Chrome doesn't run the game's frame loop, so time has to be stepped by hand)
// Handy for sharing a direct link and for the automated screenshots.
const LINK = (() => {
  const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  return { scene: q.get('scene'), start: q.get('start'), zoom: q.get('zoom') ? Number(q.get('zoom')) : null,
           commands: q.get('commands') ? q.get('commands').split('|') : [],
           advance: q.get('advance') ? Number(q.get('advance')) : 0,
           at: q.get('at') ? q.get('at').split(',').map(Number) : null };
})();

// Give the commands from the page address (once, the first time a map opens). Call it at the
// END of a map's create(). With ?advance=N the simulation is stepped N seconds right away
// (commands 1.2 s apart) and the picture refreshed; otherwise commands use the game clock.
function giveLinkCommands(scene, flight) {
  const list = LINK.commands, advance = LINK.advance;
  LINK.commands = []; LINK.advance = 0;
  if (!advance) {
    list.forEach((c, i) => scene.time.delayedCall(300 + i * 1200, () => flight.giveCommand(c)));
    return;
  }
  const step = s => { for (let i = 0; i < s * 60; i++) { flight.update(1 / 60); if (scene.metronome) scene.metronome.update(1 / 60); } };
  let used = 0;
  list.forEach(c => { flight.giveCommand(c); step(1.2); used += 1.2; });
  step(Math.max(0, advance - used));
  if (scene.flightView) scene.flightView.sync(1);
  if (scene.camera) scene.camera.update(1, true);
  if (scene.update) scene.update(0, 16);   // one normal frame, so the per-frame code is exercised too
}

const $ = id => document.getElementById(id);

// ---------- Screens ----------
function showScreen(name) {
  $('screen-menu').classList.toggle('hidden', name !== 'menu');
  $('screen-settings').classList.toggle('hidden', name !== 'settings');
  $('hud').classList.toggle('hidden', name !== 'play');
  if (name !== 'play') { $('minimapFrame').classList.add('hidden'); $('reference').classList.add('closed'); }
  if (name === 'settings') buildSettings();
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
  showScreen('play');
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
// good: true (green ✔), false (red ✘), or 'warn' (yellow ⚠: carried out, but sloppily)
function showFeedback(message, good) {
  const log = $('log');
  [...log.children].forEach(m => m.classList.add('old'));
  const m = document.createElement('div');
  m.className = 'msg panel ' + (good === 'warn' ? 'warn' : good ? 'good' : 'bad');
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
  document.querySelectorAll('.card[data-open]').forEach(card => { card.onclick = () => openScene(card.dataset.open); });
  $('menuSettings').onclick = () => showScreen('settings');
  $('menuCommands').onclick = () => { openScene('DrillPad'); setTimeout(() => $('reference').classList.remove('closed'), 100); };
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
    if (activeFlight && box.value.trim()) activeFlight.giveCommand(box.value);
    box.value = '';
    box.focus();
  };
  box.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  $('sendBtn').onclick = submit;
  $('voiceBtn').onclick = () => { unlockSound(); voice.toggle(); box.focus(); };
  $('resetBtn').onclick = () => { if (activeFlight) activeFlight.reset(); box.focus(); };

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('hud').classList.contains('hidden')) openScene('Menu');
    else if (!$('screen-settings').classList.contains('hidden')) showScreen('menu');
  });
}
