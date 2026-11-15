// =====================================================================
//  metronome.js: SHARED left foot / right foot cadence indicator.
//  Any map can add one:   this.metronome = new FootMetronome(flight, cadence);
//  and call   this.metronome.update(dt)   every frame.
//
//  - The needle swings like a metronome: it reaches the LEFT side exactly
//    as the left heel strikes, and the RIGHT side as the right heel strikes.
//  - The matching foot lights up on each heel strike (and ticks, if sound is on).
//  - The cadence count (HUT, TOOP, THREEP, FOURP) is shown. Counts one and
//    three fall on the left foot (DAFPAM 3.10.1).
// =====================================================================

// ---------- Tick sound ----------
let audioCtx = null;
function unlockSound() {
  if (settings.tick !== 'on') return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { audioCtx = null; }
}
function playTick(foot) {
  if (settings.tick !== 'on' || !audioCtx) return;
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.frequency.value = foot === 'left' ? 1000 : 700;   // left foot = higher tick
  gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.07);
}

// ---------- The indicator (drawn into the HUD's <canvas id="metronome">) ----------
// Pixel style: a blocky needle swinging between two blocky footprints.
class FootMetronome {
  constructor(flight, cadence) {
    this.flight = flight;
    this.cadence = cadence;
    this.flash = { left: 0, right: 0 };   // 1 = just struck, fades to 0
    this.lastSteps = 0;
    this.canvas = typeof document !== 'undefined' ? document.getElementById('metronome') : null;
    if (this.canvas) {
      this.canvas.style.display = settings.metronome === 'off' ? 'none' : '';
      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
      this.canvas.width = 200 * dpr; this.canvas.height = 84 * dpr;
      this.ctx = this.canvas.getContext('2d');
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = false;
    }
  }

  update(dt) {
    const info = this.flight.footInfo();
    const inStep = info && !info.routeStep;   // at route step there is no cadence

    // Light up (and tick) the foot that just struck
    if (inStep && info.stepsTaken > this.lastSteps && info.lastFoot) {
      this.flash[info.lastFoot] = 1;
      playTick(info.lastFoot);
    }
    this.lastSteps = info ? info.stepsTaken : 0;
    this.flash.left  = Math.max(0, this.flash.left  - dt * 3);
    this.flash.right = Math.max(0, this.flash.right - dt * 3);
    if (!this.ctx || settings.metronome === 'off') return;

    // Needle: +1 = right side, -1 = left side. Starts on the right (the left foot is about to swing).
    const swing = inStep ? info.swing : 0;
    let count, countColor;
    if (!info) { count = 'HALTED'; countColor = '#93a1b0'; }
    else if (info.routeStep) { count = info.routeLabel; countColor = '#93a1b0'; }
    else if (!info.word) { count = 'LEFT'; countColor = '#e8edf2'; }
    else { count = info.word; countColor = '#ffd166'; }
    const mode = !info ? '' : info.halting ? 'HALTING' : info.changingStep ? 'CHANGE STEP'
               : info.markTime ? 'MARK TIME' : info.sideStep ? 'SIDE STEP' : info.doubleTime ? 'DOUBLE TIME'
               : info.halfStep ? 'HALF STEP' : '';
    this.draw(swing, (info ? info.cadence : this.cadence) + '/min', mode, count, countColor);
  }

  draw(swing, title, mode, count, countColor) {
    const c = this.ctx, W = 200, H = 84, P = 3;   // P = size of one "pixel" block
    c.clearRect(0, 0, W, H);
    c.font = '600 12px Inter, sans-serif';
    c.textBaseline = 'top';
    c.fillStyle = '#93a1b0'; c.textAlign = 'left'; c.fillText(title, 9, 7);
    c.fillStyle = '#ff9f43'; c.textAlign = 'right'; c.fillText(mode, W - 9, 7);

    this.drawFoot(28, 40, 'left');
    this.drawFoot(W - 28, 40, 'right');
    c.font = '600 12px Inter, sans-serif'; c.textAlign = 'center';
    c.fillStyle = '#93a1b0';
    c.fillText('L', 28, 66); c.fillText('R', W - 28, 66);

    // Arc of blocks + needle made of blocks, pivot at the bottom
    const px = W / 2, py = 60, len = 36, maxA = Math.PI / 5;
    c.fillStyle = 'rgba(255,255,255,0.14)';
    for (let a = -maxA; a <= maxA + 1e-6; a += maxA / 6) {
      const x = px + Math.sin(a) * (len + 6), y = py - Math.cos(a) * (len + 6);
      c.fillRect(Math.round(x / P) * P - 1, Math.round(y / P) * P - 1, 2, 2);
    }
    const ang = swing * maxA;
    c.fillStyle = '#e8edf2';
    for (let r = 0; r <= len; r += P) {
      const x = px + Math.sin(ang) * r, y = py - Math.cos(ang) * r;
      c.fillRect(Math.round(x / P) * P - 1, Math.round(y / P) * P - 1, P, P);
    }
    const tx = Math.round((px + Math.sin(ang) * len) / P) * P, ty = Math.round((py - Math.cos(ang) * len) / P) * P;
    c.fillStyle = '#ffd166'; c.fillRect(tx - 4, ty - 4, 8, 8);
    c.fillStyle = '#556170'; c.fillRect(px - 4, py - 2, 8, 6);

    c.font = '800 15px Inter, sans-serif';
    c.fillStyle = countColor; c.fillText(count, px, 67);
  }

  // A blocky footprint: dim at rest, bright green on a heel strike
  drawFoot(cx, cy, side) {
    const c = this.ctx, lit = this.flash[side];
    const mix = (a, b) => Math.round(a + (b - a) * lit);
    c.fillStyle = 'rgb(' + mix(0x3a, 0x6b) + ',' + mix(0x46, 0xe3) + ',' + mix(0x56, 0x8a) + ')';
    const s = side === 'left' ? 1 : -1, B = 3;
    // rows of blocks (x offset, width in blocks) from toes to heel
    const rows = [[1, 1], [0, 3], [-1, 4], [-1, 4], [-1, 4], [-1, 3], [0, 2], [-1, 3], [-1, 3], [-1, 3]];
    rows.forEach(([ox, w], i) => {
      const x0 = s > 0 ? cx + ox * B - B : cx - (ox + w) * B + B;
      if (i === 0) c.fillRect(s > 0 ? cx + B : cx - 2 * B, cy - 14, B, B);   // big toe toward the inside
      c.fillRect(x0, cy - 14 + (i + 1) * B * 0.8 | 0, w * B, B);
    });
  }
}
