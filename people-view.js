// =====================================================================
//  people-view.js: DRAWS the campus people of a PeopleSim (courtesy.js) with Phaser.
//  Blocky top-down figures like the cadets: civilians in everyday clothes (students carry
//  backpacks), POC cadets and cadre in OCPs. POC/cadre carry a rank tag (placeholder for drawn
//  insignia, see CLAUDE.md "Waiting on the user"); their name appears when they're close to
//  your flight commander. A ring shows who is waiting for your greeting.
// =====================================================================

const PEOPLE_COLORS = {
  shirts: [0xd9534f, 0x5bc0de, 0xf0ad4e, 0x5cb85c, 0x9b59b6, 0xecf0f1, 0x34495e, 0xe67e22, 0xf6e58d],
  skin: [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac],
  hair: [0x2c1b10, 0x5a3825, 0xb68b4c, 0x111111, 0x8a8a8a],
};

class PeopleView {
  constructor(scene, sim, layer) {
    this.scene = scene;
    this.sim = sim;
    this.layer = layer || null;
    this.items = new Map();
    sim.people.forEach(p => this.items.set(p, this.make(p)));
  }

  make(p) {
    const rnd = mulberry(p.seed);
    const pick = list => list[Math.floor(rnd() * list.length)];
    const g = this.scene.add.graphics(), B = 1.8;
    const block = (c, x, y, w, h) => g.fillStyle(c, 1).fillRect(x * B, y * B, w * B, h * B);
    const uniform = p.kind !== 'civilian';
    const shirt = uniform ? OCP.base : pick(PEOPLE_COLORS.shirts);
    block(0x2b281f, -5, -3, 10, 6);                         // outline
    block(shirt, -4, -2, 8, 4);                             // shoulders
    if (uniform) { block(OCP.blotches[0], -3, -2, 2, 1); block(OCP.blotches[1], 1, 0, 2, 1); }
    if (p.sub === 'student') block(pick([0x1f3a93, 0x2c3e50, 0x8e44ad, 0x16a085]), -3, 2, 6, 2);   // backpack
    block(uniform ? 0x857a5c : pick(PEOPLE_COLORS.hair), -2, -2, 4, 4);   // head / patrol cap
    if (uniform) block(0x5a5240, -2, -4, 4, 2);             // cap brim (faces the walking direction)
    const shadow = this.scene.add.ellipse(1.5, 2.5, 18, 10, 0x0a141e, 0.22);
    const box = this.scene.add.container(p.x, p.y, [shadow, g]).setDepth(9);
    const ring = this.scene.add.circle(0, 0, 14).setStrokeStyle(2, 0xffd166, 0.9).setVisible(false);
    box.addAt(ring, 0);
    let tag = null, badge = null;
    if (p.person) {
      badge = this.makeInsignia(p.person.rank);             // the rank tab with its insignia, above them
      if (this.layer) this.layer.add(badge);
      tag = this.scene.add.text(p.x, p.y, '', { fontFamily: 'Inter, sans-serif', fontStyle: '800', fontSize: '13px',
        color: p.kind === 'cadre' ? '#ffd166' : '#ffffff', stroke: '#10161e', strokeThickness: 4 }).setOrigin(0.5, 1).setDepth(12);
      if (this.layer) this.layer.add(tag);
    }
    if (this.layer) this.layer.add(box);
    return { box, g, ring, tag, badge };
  }

  // A small rank tab (COURTESY.insignia): black with silver marks for POC, OCP tan with dark marks
  // for cadre. Drawn in map units, centered at (0, 0).
  makeInsignia(rank) {
    const I = COURTESY.insignia[rank] || { tab: 'cadet' };
    const g = this.scene.add.graphics().setDepth(12);
    const W = 26, H = 16, cadet = I.tab === 'cadet';
    g.fillStyle(0x10161e, 0.9).fillRect(-W / 2 - 1.5, -H / 2 - 1.5, W + 3, H + 3);              // outline
    g.fillStyle(cadet ? 0x1b1b1b : 0xa59a77, 1).fillRect(-W / 2, -H / 2, W, H);                 // tab
    const mark = cadet ? 0xd9dde2 : 0x3b3326;
    g.fillStyle(mark, 1);
    if (I.stripes) for (let i = 0; i < I.stripes; i++) g.fillRect(-9, -H / 2 + 3 + i * 4, 18, 2.4);
    if (I.diamonds) for (let i = 0; i < I.diamonds; i++) {
      const cx = (i - (I.diamonds - 1) / 2) * 7.5;
      g.fillTriangle(cx - 3.2, 0, cx, -4.5, cx + 3.2, 0); g.fillTriangle(cx - 3.2, 0, cx, 4.5, cx + 3.2, 0);
    }
    if (I.bars) for (let i = 0; i < I.bars; i++) g.fillRect(-5 + i * 6 - (I.bars - 1) * 0.5, -5, 3, 10);
    if (I.leaf) {                                            // oak leaf: a leaf shape with a stem
      g.fillEllipse(0, -1, 9, 11); g.fillRect(-0.7, 3, 1.4, 4);
      g.fillStyle(cadet ? 0x1b1b1b : 0xa59a77, 1).fillRect(-0.4, -5, 0.8, 7);
    }
    if (I.eagle) { g.fillTriangle(-9, -2, 0, 3, 9, -2); g.fillCircle(0, -3, 2); }
    return g;
  }

  // commander: the player's flight commander (names show when close); waiting: Set of person ids
  // the courtesy monitor is waiting on
  sync(commander, waiting) {
    const M = CAMPUS.pxPerMeter, near = COURTESY.people.showNameMeters * M;
    this.items.forEach((it, p) => {
      it.box.setPosition(p.x, p.y);
      it.g.setRotation(p.angle);
      it.g.y = p.moving ? Math.sin(p.step / 6) * 0.6 : 0;          // a little bob while walking
      it.ring.setVisible(!!(waiting && waiting.has(p.id)));
      if (it.tag) {                                       // insignia always; the name when they're close
        const close = commander && Math.hypot(commander.x - p.x, commander.y - p.y) < near;
        it.badge.setPosition(p.x, p.y - 20);
        it.tag.setText(close ? p.person.display : '').setPosition(p.x, p.y - 30);
      }
    });
  }
}
