// =====================================================================
//  flight-view.js: DRAWS a FlightLogic with Phaser (2D, top-down).
//  All the rules live in flight-logic.js; this file only turns positions into pictures.
//    const view = new FlightView(scene, flight, layer);   // layer is optional
//    view.sync(dt);   // call every frame after flight.update(dt)
//
//  Each person is a small, BLOCKY (pixel-art) top-down figure in OCPs (camouflage): boots,
//  swinging arms, camo shoulders and a patrol cap whose brim points the way they face, with a
//  soft shadow on the ground. Turns are smooth (the picture glides to the new direction).
//  Arms and boots move in time with the cadence: the left boot is forward when the left heel strikes.
// =====================================================================

// OCP (Operational Camouflage Pattern) colors
const OCP = {
  base: 0xa59a77,                                          // sand-tan background
  blotches: [0x7b7350, 0x5e5140, 0xc6ba95, 0x8a8a62],      // olive, brown, light sand, green-tan
  dark: 0x7d7457,                                          // cap brim / sleeve shading
  light: 0xbdb28e,                                         // sunlit edge (sun from the north-west)
  boot: 0x6b5536,                                          // coyote-brown boots
  skin: 0xe0b48a,
};
const ROLE_OUTLINE = { leader: 0xffd166, commander: 0xffffff };   // element leaders gold, commander white
const PX = 1.5;   // size of one "pixel" block of a cadet, in map units

class FlightView {
  constructor(scene, flight, layer) {
    this.scene = scene;
    this.flight = flight;
    this.layer = layer || null;
    this.sprites = new Map();   // person -> { box, shadow, leftBoot, rightBoot, leftArm, rightArm, offset, angle }
    this.generation = -1;
    this.sync(1);
  }

  // Rebuild the pictures when the flight is reset, then move and animate every picture.
  // dt = seconds since the last frame (used to glide smoothly through turns).
  sync(dt) {
    if (dt === undefined) dt = 1;
    const rebuilt = this.generation !== this.flight.generation;
    if (rebuilt) this.rebuild();
    const info = this.flight.footInfo();        // null at the halt
    const now = this.scene.time.now / 1000;
    const k = 1 - Math.exp(-dt * 16);           // turn smoothing (a quarter turn takes ~0.15 s)

    this.sprites.forEach((s, p) => {
      const x = p.x + p.off.x, y = p.y + p.off.y;
      s.box.setPosition(x, y);
      s.shadow.setPosition(x + 2.2, y + 3.4);
      const target = (p.walkAngle !== null ? p.walkAngle : p.dir * Math.PI / 4) + p.rot;
      if (s.angle === null || rebuilt) s.angle = target;
      else s.angle += Phaser.Math.Angle.Wrap(target - s.angle) * k;
      s.box.setRotation(s.angle);

      // How far the boots/arms reach, and where in the stride this person is
      let stride = 0, phase = 0, armsAtWaist = false;
      if (p.walkAngle !== null) {                  // guide/commander walking to a new post
        stride = 1; phase = now * 2;
      } else if (info) {                           // marching: everyone in step with the cadence
        phase = info.progress + (info.routeStep ? s.offset : 0);   // route step: out of step
        stride = info.markTime ? 0.25 : info.halfStep ? 0.5 : info.doubleTime ? 1.25 : 1;
        if (this.flight.haltAt !== null) stride = 0;   // halt, count two: trailing foot alongside
        armsAtWaist = info.doubleTime;
        if (info.sideStep) stride = 0.25;          // Right/Left Step: feet close together, arms at the sides
      }
      // +1 = left boot fully forward (left heel strike on odd counts), -1 = right boot forward.
      // Snapped to whole pixel blocks for the blocky look.
      const legs = -Math.cos(Math.PI * phase) * stride;
      const snap = v => Math.round(v / (PX / 2)) * (PX / 2);
      s.leftBoot.y = snap(-legs * 5);
      s.rightBoot.y = snap(legs * 5);
      // At the halt: parade rest (heels 12 in apart, hands behind the back, 3.3.1.1) and present arms
      // (right hand up to the cap brim, 3.7). The commander keeps the position of attention.
      const posture = !info && p.kind !== 'commander' ? this.flight.posture : 'attention';
      const spread = posture === 'paradeRest' ? 1.6 * PX : 0;
      s.leftBoot.x = s.base.lb - spread; s.rightBoot.x = s.base.rb + spread;
      s.leftArm.x = s.base.la; s.rightArm.x = s.base.ra;
      if (s.flag) s.flag.setRotation(0);
      if (posture === 'paradeRest') {
        s.leftArm.y = 3; s.rightArm.y = 3;
        s.leftArm.x = s.base.la + 1.5 * PX; s.rightArm.x = s.base.ra - 1.5 * PX;
      } else if (posture === 'presentArms') {
        s.leftArm.y = 0;
        if (s.flag) { s.rightArm.y = 0; s.flag.setRotation(0.7); }   // guidon: the flag is dipped forward
        else { s.rightArm.y = -6; s.rightArm.x = s.base.ra - 2.5 * PX; }
      } else if (armsAtWaist) {                    // double time: forearms horizontal at the waist
        s.leftArm.y = -3; s.rightArm.y = -3;
      } else if (info && info.sideStep) {          // side step: arms stay at the sides (3.14.1)
        s.leftArm.y = 0; s.rightArm.y = 0;
      } else {                                     // arms swing opposite to the legs
        s.leftArm.y = snap(legs * 3);
        s.rightArm.y = snap(-legs * 3);
      }
    });
  }

  rebuild() {
    this.sprites.forEach(s => { s.box.destroy(); s.shadow.destroy(); });
    this.sprites.clear();
    this.flight.everyone().forEach((p, i) => this.sprites.set(p, this.makePerson(p.kind, i)));
    this.generation = this.flight.generation;
  }

  // One person, facing "up" (the container is rotated to their direction). Drawn from
  // square blocks of PX units: a block at grid (gx, gy), w x h blocks.
  makePerson(kind, seed) {
    const add = () => this.scene.add.graphics();
    const rand = mulberry(seed * 7919 + 17);    // same camo pattern every time for this person
    const block = (g, color, gx, gy, w, h, alpha) =>
      g.fillStyle(color, alpha === undefined ? 1 : alpha).fillRect(gx * PX, gy * PX, (w || 1) * PX, (h || 1) * PX);
    const camo = () => OCP.blotches[Math.floor(rand() * 4)];

    // Soft shadow on the ground (not rotated; the sun is always north-west)
    const shadow = add();
    shadow.fillStyle(0x0a141e, 0.16).fillEllipse(0, 0, 24, 14);
    shadow.fillStyle(0x0a141e, 0.16).fillEllipse(0, 0, 18, 9);
    shadow.setDepth(9);

    // Boots (under everything): 2 x 4 blocks with a darker heel
    const boot = gx => { const g = add(); block(g, OCP.boot, -1, -2, 2, 4); block(g, 0x4d3c26, -1, 1, 2, 1); return g.setX(gx * PX); };
    const leftBoot = boot(-2.2), rightBoot = boot(2.2);

    // Arms: OCP sleeve (2 x 5 blocks) with a hand at the end
    const arm = gx => {
      const g = add();
      block(g, OCP.dark, -1, -2, 2, 5);
      block(g, camo(), -1, rand() < 0.5 ? -1 : 0, 1, 2);
      block(g, OCP.skin, -1, -3, 2, 1);
      return g.setX(gx * PX);
    };
    const leftArm = arm(-6.5), rightArm = arm(6.5);

    // Shoulders / back in OCP camo: 12 x 6 blocks with the corners cut off
    const body = add();
    const outline = ROLE_OUTLINE[kind] || 0x2b281f;   // dark pixel-art outline; gold/white for leaders/commander
    block(body, outline, -6, -4, 12, 8); block(body, outline, -7, -3, 14, 6);
    block(body, OCP.base, -5, -3, 10, 6); block(body, OCP.base, -6, -2, 12, 4);
    for (let i = 0; i < 10; i++) block(body, camo(), -6 + Math.floor(rand() * 11), -3 + Math.floor(rand() * 5), 1 + (rand() < 0.4 ? 1 : 0), 1);
    block(body, OCP.light, -5, -3, 10, 1, 0.55);  // sunlit top edge
    block(body, 0x000000, -5, 2, 10, 1, 0.18);     // shaded bottom edge

    // Patrol cap seen from above, brim pointing forward
    const head = add();
    block(head, 0x2b281f, -3, -6, 6, 9); block(head, 0x2b281f, -4, -4, 8, 6);   // outline
    block(head, 0x5a5240, -2, -6, 4, 2);           // brim
    block(head, 0x857a5c, -3, -4, 6, 5); block(head, 0x857a5c, -2, -4, 4, 6);   // crown
    block(head, camo(), -2, -1, 1, 1); block(head, camo(), 1, -2, 1, 1); block(head, camo(), 0, 1, 1, 1);
    block(head, OCP.light, -2, -4, 4, 1, 0.5);
    block(head, 0xffffff, -0.5, -8, 1, 1, 0.6);   // small "facing" marker

    const parts = [leftBoot, rightBoot, leftArm, rightArm, body, head];
    let flag = null;
    if (kind === 'guide') {                       // the guidon: red pennant on a pole (blocky)
      flag = add();
      block(flag, 0x3b2a1a, 7, -14, 1, 16);
      block(flag, 0xd62828, 8, -14, 6, 2); block(flag, 0xd62828, 8, -12, 4, 2); block(flag, 0xd62828, 8, -10, 2, 1);
      block(flag, 0xff5a4a, 8, -14, 6, 1, 0.8);
      block(flag, 0xd9b44a, 7, -15, 1, 1);        // finial
      parts.push(flag);
    }

    const box = this.scene.add.container(0, 0, parts).setDepth(10);
    if (this.layer) { this.layer.add(shadow); this.layer.add(box); }   // maps with several cameras keep people in a layer
    return { box, shadow, leftBoot, rightBoot, leftArm, rightArm, flag, offset: rand() * 2, angle: null,
             base: { lb: leftBoot.x, rb: rightBoot.x, la: leftArm.x, ra: rightArm.x } };
  }
}

// Small repeatable random number generator (so each person's camo stays the same)
function mulberry(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
