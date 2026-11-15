// =====================================================================
//  menu-scene.js: the main menu's background (the menu itself is in index.html / ui.js):
//  pixel-art grass with a flight marking time in step, dimmed behind the mode cards.
// =====================================================================

class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    // A link straight to a screen (see LINK in ui.js) skips the menu once
    if (LINK.scene && LINK.scene !== 'Menu' && LINK.scene !== 'Settings') {
      const s = LINK.scene; LINK.scene = null; this.scene.start(s); return;
    }
    setActiveFlight(null);
    showScreen('menu');

    const W = 4000, H = 3000;
    if (KENNEY_TILES.complete && KENNEY_TILES.naturalWidth > 0) {
      PAINT.chunks(this, null, W, H, 'menu', (ctx, x0, y0, x1, y1) => {
        ctx.fillStyle = PAINT.pattern(ctx, CAMPUS_TILES.grass);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      });
    }
    // A flight marking time in the middle (it ignores commands: it's just scenery)
    this.flight = new FlightLogic({ bounds: { x0: 0, y0: 0, x1: W, y1: H }, start: { x: W / 2, y: H / 2 },
                                    cadence: settings.cadence, disorder: 0 });
    this.flight.giveCommand('Mark Time, HARCH');
    this.flightView = new FlightView(this, this.flight);
    const cam = this.cameras.main;
    cam.setZoom(2.2);
    cam.centerOn(W / 2, H / 2 + 40);
    this.add.rectangle(0, 0, W, H, 0x0d1218, 0.62).setOrigin(0).setDepth(50);   // dim behind the cards
  }

  update(time, deltaMs) {
    this.flight.update(deltaMs / 1000);
    this.flightView.sync(deltaMs / 1000);
  }
}
