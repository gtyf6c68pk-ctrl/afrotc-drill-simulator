// =====================================================================
//  world-painter.js: SHARED helpers for painting a map in the pixel-art style.
//  A map is painted ONCE (when it opens) into big picture "chunks" that the game then just
//  shows; one pixel of the art covers ART_PX map units (4 units = about 5 inches), so the
//  Kenney tiles look like crisp, blocky pixel art ("old school"), while the lighting and
//  shadows added here are soft ("new school").
//    const images = PAINT.chunks(scene, layer, width, height, 'name', (ctx, x0, y0, x1, y1) => {...});
//  Inside the callback, draw with normal canvas calls in MAP UNITS.
// =====================================================================

const ART_PX = 4;           // map units per art pixel
const CHUNK_PX = 1024;      // chunk size in art pixels

const PAINT = {
  // A repeating texture made from one Kenney tile (or block of tiles): [col, row, w, h]
  pattern(ctx, [col, row, w, h]) {
    const c = document.createElement('canvas');
    c.width = w * 16; c.height = h * 16;
    c.getContext('2d').drawImage(KENNEY_TILES, col * 16, row * 16, c.width, c.height, 0, 0, c.width, c.height);
    const pat = ctx.createPattern(c, 'repeat');
    pat.setTransform(new DOMMatrix().scale(ART_PX));   // one art pixel = ART_PX map units
    return pat;
  },

  tracePoly(ctx, flat) {
    ctx.beginPath();
    ctx.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
    ctx.closePath();
  },

  traceLine(ctx, flat) {
    ctx.beginPath();
    ctx.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
  },

  // One Kenney tile drawn at (x, y), size dw x dh, optionally rotated
  sprite(ctx, [col, row, w, h], x, y, dw, dh, angle) {
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.drawImage(KENNEY_TILES, col * 16, row * 16, w * 16, h * 16, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  },

  // Does a bounding box (plus padding) touch the area x0..x1, y0..y1?
  touches(box, x0, y0, x1, y1, pad) {
    return box.x1 + pad >= x0 && box.x0 - pad <= x1 && box.y1 + pad >= y0 && box.y0 - pad <= y1;
  },

  // ---------- Lighting (the "new school" part) ----------
  // Sun from the north-west: shadows fall to the south-east, longer for taller things.
  SHADOW_DIR: { x: 0.55, y: 0.85 },

  // A building's shadow on the ground: the outline swept toward the south-east by its height
  buildingShadow(ctx, flat, heightUnits) {
    const dx = PAINT.SHADOW_DIR.x * heightUnits, dy = PAINT.SHADOW_DIR.y * heightUnits;
    ctx.fillStyle = 'rgba(10, 20, 30, 0.30)';
    const n = flat.length / 2;
    for (let i = 0; i < n; i++) {                       // one quad per wall
      const j = (i + 1) % n;
      const ax = flat[2 * i], ay = flat[2 * i + 1], bx = flat[2 * j], by = flat[2 * j + 1];
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(bx + dx, by + dy); ctx.lineTo(ax + dx, ay + dy);
      ctx.closePath(); ctx.fill();
    }
    ctx.save(); ctx.translate(dx, dy); PAINT.tracePoly(ctx, flat); ctx.fill(); ctx.restore();
  },

  // Soft darkening where walls meet the ground ("ambient occlusion")
  baseShade(ctx, flat, widthUnits) {
    PAINT.tracePoly(ctx, flat);
    ctx.lineJoin = 'round';
    ctx.lineWidth = widthUnits; ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)'; ctx.stroke();
  },

  // Paint a map into chunks. paintFn(ctx, x0, y0, x1, y1) draws in map units.
  // Returns the chunk images (added to `layer` if given).
  chunks(scene, layer, W, H, prefix, paintFn) {
    const made = [];
    for (let cy = 0; cy * CHUNK_PX * ART_PX < H; cy++) {
      for (let cx = 0; cx * CHUNK_PX * ART_PX < W; cx++) {
        const x0 = cx * CHUNK_PX * ART_PX, y0 = cy * CHUNK_PX * ART_PX;
        const cw = Math.min(CHUNK_PX, Math.ceil((W - x0) / ART_PX)) + 1;   // +1 pixel overlap: no seams
        const ch = Math.min(CHUNK_PX, Math.ceil((H - y0) / ART_PX)) + 1;
        const x1 = x0 + cw * ART_PX, y1 = y0 + ch * ART_PX;
        const key = prefix + '_chunk_' + cx + '_' + cy;
        if (scene.textures.exists(key)) scene.textures.remove(key);
        const tex = scene.textures.createCanvas(key, cw, ch);
        const ctx = tex.getContext();
        ctx.imageSmoothingEnabled = false;
        ctx.setTransform(1 / ART_PX, 0, 0, 1 / ART_PX, -x0 / ART_PX, -y0 / ART_PX);   // draw in map units
        paintFn(ctx, x0, y0, x1, y1);
        tex.refresh();
        tex.setFilter(Phaser.Textures.FilterMode.NEAREST);   // keep the pixel art sharp
        const img = scene.add.image(x0, y0, key).setOrigin(0).setScale(ART_PX);
        if (layer) layer.add(img);
        made.push(img);
      }
    }
    return made;
  },
};
