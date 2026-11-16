// =====================================================================
//  main.js: starts the game (full window) and the on-screen controls
// =====================================================================

let game = null;

function startGame() {
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#0d1218',
    pixelArt: true,                                   // keep pixel art sharp when zoomed
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [MenuScene, DrillPadScene, CampusScene],   // the first one (Menu) opens first
  });
  wireUi();
  if (LINK.scene === 'Settings' || LINK.scene === 'Reference' || LINK.scene === 'Stats') {     // HTML screens (no map)
    const name = LINK.scene.toLowerCase(); LINK.scene = null; setTimeout(() => name === 'stats' ? showStats() : showScreen(name), 50);
  }
}

// Wait for the fonts so map labels are drawn in the right font (but never more than 1.5 s)
// (fonts only load when something asks for them, so ask for the ones the map text uses)
const fontsReady = document.fonts
  ? Promise.all(['700 64px "Pixelify Sans"', '800 60px Inter', '600 12px Inter', '400 14px Inter'].map(f => document.fonts.load(f).catch(() => null)))
  : Promise.resolve();
Promise.race([fontsReady, new Promise(r => setTimeout(r, 1500))]).then(startGame);
