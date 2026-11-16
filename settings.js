// =====================================================================
//  settings.js: the options on the Settings screen.
//  Choices are saved in the browser so they stay after a reload.
// =====================================================================

// Drill pad sizes, in marching steps (1 step = 24 inches)
const PAD_SIZES = {
  small:  { label: 'Small (30 × 20 steps)',  w: 30, h: 20 },
  medium: { label: 'Medium (48 × 30 steps)', w: 48, h: 30 },
  large:  { label: 'Large (80 × 50 steps)',  w: 80, h: 50 },
  huge:   { label: 'Huge (120 × 75 steps)',  w: 120, h: 75 },
};

// Each option: what it's called, the choices, and how to show each choice.
const SETTING_OPTIONS = [
  { key: 'cadence', label: 'Cadence (steps per minute)', values: [30, 45, 60, 90, 120],
    show: v => v === 120 ? '120 (regulation)' : v + ' (training)' },
  { key: 'elements', label: 'Number of elements', values: [2, 3, 4],
    show: v => String(v) },
  { key: 'elementSize', label: 'Cadets per element', values: [3, 4, 5, 6, 7, 8],
    show: v => String(v) },
  { key: 'padSize', label: 'Drill pad size', values: Object.keys(PAD_SIZES),
    show: v => PAD_SIZES[v].label },
  { key: 'campusStart', label: 'Campus starting point', values: ['lowder', 'drillfield'],
    show: v => v === 'lowder' ? 'Lowder / Horton-Hargrave' : 'Max Adams Morris Drill Field' },
  { key: 'disorder', label: 'Disorder (cadets drifting)', values: ['off', 'low', 'normal', 'high'],
    show: v => v[0].toUpperCase() + v.slice(1) },
  { key: 'cdrSide', label: "Commander's side (danger side)", values: ['left', 'right'],
    show: v => v === 'left' ? 'Left' : 'Right' },
  { key: 'metronome', label: 'Cadence metronome', values: ['on', 'off'],
    show: v => v === 'on' ? 'Shown' : 'Hidden' },
  { key: 'voiceEngine', label: 'Voice engine', values: ['vosk', 'chrome'],
    show: v => v === 'vosk' ? 'Offline (Vosk)' : 'Chrome (online)' },
  { key: 'voiceDelay', label: 'Voice delay estimate', values: [0, 0.25, 0.5, 0.75, 1],
    show: v => v + ' s' },
  { key: 'tick', label: 'Tick sound on each step', values: ['off', 'on'],
    show: v => v === 'on' ? 'On' : 'Off' },
  { key: 'npcFlights', label: 'Other flights on campus (computer-controlled)', values: [0, 1, 2, 3, 4],
    show: v => v === 0 ? 'None' : String(v) },
  { key: 'campusPeople', label: 'People on campus (greet and salute)', values: ['on', 'off'],
    show: v => v === 'on' ? 'Shown' : 'None' },
];

const DEFAULT_SETTINGS = {
  cadence: 60,          // slower than regulation so cadets have time to type
  elements: 3,
  elementSize: 5,
  padSize: 'medium',
  campusStart: 'lowder',
  npcFlights: 3,
  campusPeople: 'on',
  disorder: 'normal',
  cdrSide: 'left',
  metronome: 'on',
  tick: 'off',
  voiceEngine: 'vosk',  // offline recognizer with exact word timing
  voiceDelay: 0.5,      // seconds between speaking a word and the computer hearing it
};

// How strongly disorder builds up for each choice
const DISORDER_LEVELS = { off: 0, low: 0.5, normal: 1, high: 1.5 };

let settings = loadSettings();

function loadSettings() {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const saved = JSON.parse(localStorage.getItem('drillSimSettings') || '{}');
    SETTING_OPTIONS.forEach(o => { if (o.values.includes(saved[o.key])) s[o.key] = saved[o.key]; });
  } catch (e) { /* storage not available: use defaults */ }
  return s;
}

function saveSettings() {
  try { localStorage.setItem('drillSimSettings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
}
