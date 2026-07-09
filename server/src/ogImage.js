import { deflateSync } from 'node:zlib';

// Vignette de partage (og:image) 100 % générée : dans l'esprit « zéro asset
// externe » du jeu, on dessine à la main (rectangles/cercles/texte pixel)
// sur un buffer RGBA, puis on encode nous-mêmes en PNG (zlib est natif à
// Node, pas besoin de sharp/canvas). Générée UNE FOIS au démarrage du
// serveur et mise en cache : coût nul ensuite.

const W = 1200, H = 630;

// --- Buffer RGBA + primitives -------------------------------------------
function makeCanvas(w, h) {
  const data = new Uint8Array(w * h * 4);
  return {
    w, h, data,
    setPixel(x, y, r, g, b, a = 255) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    },
    fillRect(x, y, rw, rh, [r, g, b, a = 255]) {
      const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(w, Math.floor(x + rw)), y1 = Math.min(h, Math.floor(y + rh));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.setPixel(xx, yy, r, g, b, a);
    },
    fillCircle(cx, cy, rad, [r, g, b, a = 255]) {
      const x0 = Math.max(0, Math.floor(cx - rad)), y0 = Math.max(0, Math.floor(cy - rad));
      const x1 = Math.min(w, Math.ceil(cx + rad)), y1 = Math.min(h, Math.ceil(cy + rad));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const dx = xx - cx, dy = yy - cy;
        if (dx * dx + dy * dy <= rad * rad) this.setPixel(xx, yy, r, g, b, a);
      }
    },
    strokeCircle(cx, cy, rad, thick, [r, g, b, a = 255]) {
      const x0 = Math.max(0, Math.floor(cx - rad - thick)), y0 = Math.max(0, Math.floor(cy - rad - thick));
      const x1 = Math.min(w, Math.ceil(cx + rad + thick)), y1 = Math.min(h, Math.ceil(cy + rad + thick));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const dx = xx - cx, dy = yy - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= rad + thick / 2 && d >= rad - thick / 2) this.setPixel(xx, yy, r, g, b, a);
      }
    },
    vGradient(y0, y1, c0, c1) {
      const yy0 = Math.max(0, Math.floor(y0)), yy1 = Math.min(h, Math.ceil(y1));
      for (let yy = yy0; yy < yy1; yy++) {
        const t = (yy - y0) / (y1 - y0);
        const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
        const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
        const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
        for (let xx = 0; xx < w; xx++) this.setPixel(xx, yy, r, g, b, 255);
      }
    },
  };
}

// --- Police pixel 5×7 (majuscules + espace + !), dessinée à la main -------
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

function drawText(canvas, text, x, y, scale, color) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '#') canvas.fillRect(cx + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cx += 6 * scale; // 5 colonnes + 1 d'espacement
  }
  return cx - x; // largeur totale dessinée
}
function textWidth(text, scale) {
  return text.length * 6 * scale;
}

// Petit générateur déterministe (même image à chaque démarrage)
function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function draw() {
  const c = makeCanvas(W, H);
  // Ciel nocturne néon, dégradé du haut (bleu nuit) vers le bas (violet)
  c.vGradient(0, H, [10, 12, 26], [26, 14, 40]);
  // Halo lunaire discret en haut à droite
  c.fillCircle(1020, 110, 130, [40, 40, 70, 255]);
  c.fillCircle(1020, 110, 60, [70, 70, 110, 255]);

  // Skyline low-poly (silhouette déterministe : bâtiments + le Crayon)
  const rand = makeRand(42);
  const baseY = H - 170;
  let x = -20;
  while (x < W + 20) {
    const bw = 46 + rand() * 60;
    const bh = 60 + rand() * 190;
    c.fillRect(x, baseY - bh, bw, bh + 200, [14, 18, 34, 255]);
    x += bw + 6 + rand() * 10;
  }
  // Tour « le Crayon » (silhouette conique), légèrement à droite
  const crayonX = 940, crayonBaseY = baseY - 150, crayonH = 230;
  c.fillRect(crayonX - 22, crayonBaseY - crayonH + 40, 44, crayonH, [18, 22, 40, 255]);
  for (let i = 0; i < 40; i++) {
    c.fillRect(crayonX - 22 + i * 1.1, crayonBaseY - crayonH + 40 - i * 3.4, 44 - i * 1.1 * 2, 3, [18, 22, 40, 255]);
  }
  // Grande roue (silhouette anneau) à gauche
  c.strokeCircle(150, baseY - 40, 95, 7, [14, 18, 34, 255]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    c.fillRect(150 + Math.cos(a) * 95 - 3, baseY - 40 + Math.sin(a) * 95 - 3, 6, 6, [14, 18, 34, 255]);
  }

  // Bande sol
  c.fillRect(0, baseY + 30, W, H - baseY - 30, [8, 9, 18, 255]);

  // Titre néon « LYON ARCADE » centré, deux tons, avec halo (rects plus
  // grands et translucides derrière, façon glow)
  const scale = 15;
  const lyon = 'LYON', arcade = 'ARCADE';
  const gap = 4 * scale;
  const totalW = textWidth(lyon, scale) - scale + gap + textWidth(arcade, scale) - scale;
  const startX = (W - totalW) / 2;
  const titleY = 150;
  const CYAN = [0, 255, 213, 255], MAGENTA = [255, 61, 240, 255];
  // Halo (couche élargie, faible alpha, dessinée avant le texte net)
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2]]) {
    drawText(c, lyon, startX + dx, titleY + dy, scale, [...CYAN.slice(0, 3), 40]);
    drawText(c, arcade, startX + textWidth(lyon, scale) - scale + gap + dx, titleY + dy, scale, [...MAGENTA.slice(0, 3), 40]);
  }
  const lyonW = drawText(c, lyon, startX, titleY, scale, CYAN);
  drawText(c, arcade, startX + lyonW - scale + gap, titleY, scale, MAGENTA);

  // Sous-titre (largeur vérifiée pour tenir dans les 1200 px avec marge)
  const sub = 'LYON EN LOW POLY MULTIJOUEUR ENTRE POTES';
  const subScale = 4;
  drawText(c, sub, (W - textWidth(sub, subScale)) / 2, 290, subScale, [232, 240, 248, 255]);

  // Bandeau bas : accroche + adresse
  const foot = 'VIENS JOUER AVEC MOI !';
  const footScale = 6;
  drawText(c, foot, (W - textWidth(foot, footScale)) / 2, H - 90, footScale, [255, 213, 107, 255]);

  return c;
}

// --- Encodage PNG minimal (signature + IHDR + IDAT + IEND) ---------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}
function encodePNG({ w, h, data }) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const dest = y * (stride + 1);
    raw[dest] = 0; // filtre "none"
    raw.set(data.subarray(y * stride, y * stride + stride), dest + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // couleur : RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let cached = null;
export function getOgImage() {
  if (!cached) cached = encodePNG(draw());
  return cached;
}
