import { state } from '../state.js';
import { riverCx, riverHalf } from '../world/layout.js';
import { audio } from '../audio.js';

// Carte de Lyon (touche M) : fleuves + joueur + points d'intérêt DÉCOUVERTS.
// Chaque POI (statue, basilique, traboules…) se révèle quand on s'en
// approche en jeu — la découverte est gardée en localStorage. Les POI non
// trouvés ne sont pas affichés : à toi d'explorer, gone.

const LS_KEY = 'vibevps_pois';
const DISCOVER_R = 26; // distance de découverte (mètres)

export function createPoiMap(ctx, { getPlayer, getOthers, onToast, onPing }) {
  let found = new Set();
  try {
    found = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));
  } catch { /* stockage vierge */ }
  const save = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify([...found])); } catch { /* plein */ }
  };

  // --- Overlay + canvas ---
  const overlay = document.createElement('div');
  overlay.id = 'map-overlay';
  overlay.className = 'hidden';
  overlay.innerHTML = `
    <div id="map-frame">
      <div id="map-title">🗺️ CARTE DE LYON <span id="map-count"></span>
        <span id="map-zoom-btns"><button id="map-zo">−</button><button id="map-zi">+</button></span>
      </div>
      <canvas id="map-canvas"></canvas>
      <div id="map-hint">Explore la ville pour révéler les points d'intérêt · touche la carte pour donner rendez-vous · molette ou +/− pour zoomer · M ou Échap pour fermer</div>
    </div>`;
  document.body.appendChild(overlay);
  const canvas = overlay.querySelector('#map-canvas');
  const countEl = overlay.querySelector('#map-count');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) toggle(false); });
  // Toucher/cliquer la carte : rendez-vous pour tous les joueurs (📍)
  let view = null, downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!view || !onPing || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) return;
    const r = canvas.getBoundingClientRect();
    const k = view.half / (view.size / 2);
    onPing(view.cx0 + (e.clientX - r.left - view.size / 2) * k, view.cz0 + (e.clientY - r.top - view.size / 2) * k);
    draw();
  });

  // --- Zoom : molette, boutons +/− et pincement tactile — centré joueur ---
  let zoom = 1; // 1 = toute la ville → 8 = quartier
  function setZoom(z) {
    zoom = Math.max(1, Math.min(8, z));
    if (open) draw();
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.3 : 1 / 1.3));
  }, { passive: false });
  overlay.querySelector('#map-zi').addEventListener('click', () => setZoom(zoom * 1.5));
  overlay.querySelector('#map-zo').addEventListener('click', () => setZoom(zoom / 1.5));
  let pinchDist = 0;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchDist > 0) {
      e.preventDefault();
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setZoom(zoom * (d / pinchDist));
      pinchDist = d;
    }
  }, { passive: false });

  let buildings = null; // emprises au sol, calculées au premier affichage
  let open = false;
  function toggle(force) {
    const show = force ?? !open;
    if (show === open) return;
    open = show;
    overlay.classList.toggle('hidden', !open);
    state.overlayOpen = open;
    if (open) {
      document.exitPointerLock?.();
      draw();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !state.chatOpen) {
      if (open) toggle(false);
      else if (!state.overlayOpen) toggle(true);
    }
    if (e.code === 'Escape' && open) toggle(false);
  });

  function draw() {
    const B = (ctx.worldBound ?? 140) + 10;
    const size = Math.min(window.innerWidth, window.innerHeight) * 0.72;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    // Fenêtre de vue : toute la ville à zoom 1, centrée sur le joueur ensuite
    const pv = getPlayer();
    const half = B / zoom;
    const clampC = (v) => Math.max(-B + half, Math.min(B - half, v));
    const cx0 = zoom > 1 && pv ? clampC(pv.x) : 0;
    const cz0 = zoom > 1 && pv ? clampC(pv.z) : 0;
    const sx = (x) => size / 2 + ((x - cx0) / half) * (size / 2);
    view = { size, cx0, cz0, half };
    const sz = (z) => size / 2 + ((z - cz0) / half) * (size / 2);

    // Fond parchemin sombre + trame
    g.fillStyle = '#101820';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = 'rgba(120, 160, 190, 0.08)';
    g.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      g.beginPath(); g.moveTo((size / 8) * i, 0); g.lineTo((size / 8) * i, size); g.stroke();
      g.beginPath(); g.moveTo(0, (size / 8) * i); g.lineTo(size, (size / 8) * i); g.stroke();
    }

    // Bâti : emprise des colliders assez hauts pour être des immeubles
    // (filtrés une fois — le décor est figé). Dessine les rues en creux.
    if (!buildings) {
      buildings = [];
      for (const b of ctx.colliders ?? []) {
        if (b.maxY - b.minY < 2.5) continue; // bancs, bornes, quais
        if ((b.maxX - b.minX) * (b.maxZ - b.minZ) < 2) continue; // poteaux, troncs
        buildings.push(b);
      }
    }
    g.fillStyle = 'rgba(150, 170, 195, 0.22)';
    for (const b of buildings) {
      if (b.maxX < cx0 - half || b.minX > cx0 + half || b.maxZ < cz0 - half || b.minZ > cz0 + half) continue;
      const x0 = sx(b.minX), z0 = sz(b.minZ);
      g.fillRect(x0, z0, Math.max(1, sx(b.maxX) - x0), Math.max(1, sz(b.maxZ) - z0));
    }

    // Fleuves (mêmes courbes que le monde 3D)
    g.fillStyle = '#1a86c4';
    for (const band of [...(ctx.waterBands ?? []), ...(ctx.waterExtensions ?? [])]) {
      const zLo = Math.max(band.zMin ?? -B, -B);
      const zHi = Math.min(band.zMax ?? B, B);
      const half = riverHalf(band);
      g.beginPath();
      for (let z = zLo; z <= zHi; z += 10) {
        const px = sx(riverCx(band, z) - half);
        z === zLo ? g.moveTo(px, sz(z)) : g.lineTo(px, sz(z));
      }
      for (let z = zHi; z >= zLo; z -= 10) {
        g.lineTo(sx(riverCx(band, z) + half), sz(z));
      }
      g.closePath();
      g.fill();
    }

    // Rose des vents minimaliste
    g.fillStyle = 'rgba(220, 235, 245, 0.75)';
    g.font = '600 13px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('N', size - 24, 22);
    g.beginPath();
    g.moveTo(size - 24, 28); g.lineTo(size - 28, 38); g.lineTo(size - 20, 38);
    g.closePath();
    g.fill();

    // POI découverts : pastille + emoji + nom (étiquette alternée haut/bas
    // pour limiter les chevauchements entre lieux voisins)
    let n = 0;
    let flip = false;
    for (const poi of ctx.pois ?? []) {
      if (!found.has(poi.id)) continue;
      n++;
      flip = !flip;
      const px = sx(poi.x), pz = sz(poi.z);
      g.fillStyle = 'rgba(10, 16, 22, 0.72)';
      g.beginPath();
      g.arc(px, pz, 11, 0, Math.PI * 2);
      g.fill();
      g.font = '13px system-ui, sans-serif';
      g.fillText(poi.emoji, px, pz + 4.5);
      g.font = '600 10px system-ui, sans-serif';
      g.fillStyle = '#cfe3f2';
      g.fillText(poi.nom, px, pz + (flip ? 22 : -16));
    }
    countEl.textContent = `· ${n} / ${(ctx.pois ?? []).length} lieux découverts`;

    // Repères dynamiques (mission en cours, rendez-vous des joueurs…) :
    // toujours affichés, même hors des lieux découverts
    for (const m of ctx.mapMarks ?? []) {
      if (m.hidden) continue;
      const px = sx(m.x), pz = sz(m.z);
      g.strokeStyle = m.color ?? '#ffd34d';
      g.lineWidth = 2.5;
      g.fillStyle = 'rgba(10, 16, 22, 0.85)';
      g.beginPath();
      g.arc(px, pz, 13, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.font = '15px system-ui, sans-serif';
      g.fillText(m.emoji ?? '📍', px, pz + 5);
      if (m.label) {
        g.font = '700 11px system-ui, sans-serif';
        g.fillStyle = m.color ?? '#ffd34d';
        g.fillText(m.label, px, pz - 18);
      }
    }

    // Les autres joueurs : pastille à leur couleur + pseudo
    g.font = '600 10px system-ui, sans-serif';
    for (const o of getOthers?.() ?? []) {
      const px = sx(o.x), pz = sz(o.z);
      if (px < -10 || pz < -10 || px > size + 10 || pz > size + 10) continue;
      g.fillStyle = o.color;
      g.strokeStyle = '#0a1016';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px, pz, 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#ffffff';
      g.fillText(o.name, px, pz - 9);
    }

    // Le joueur : flèche orientée selon le regard
    const p = getPlayer();
    if (p) {
      const px = sx(p.x), pz = sz(p.z);
      g.save();
      g.translate(px, pz);
      g.rotate(-(p.yaw ?? 0)); // yaw 0 = nord (-z) = haut de la carte
      g.fillStyle = '#ff3df0';
      g.beginPath();
      g.moveTo(0, -8); g.lineTo(-5.5, 6); g.lineTo(0, 2.5); g.lineTo(5.5, 6);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  // --- Découverte par proximité (tick léger : 1re frame puis 1 sur 10) ---
  let frame = 0;
  ctx.updatables.push(() => {
    if (frame++ % 10) return;
    const p = getPlayer();
    if (!p) return;
    for (const poi of ctx.pois ?? []) {
      if (found.has(poi.id)) continue;
      if (Math.abs(p.x - poi.x) > DISCOVER_R || Math.abs(p.z - poi.z) > DISCOVER_R) continue;
      found.add(poi.id);
      save();
      audio.reward();
      onToast?.(`📍 ${poi.emoji} ${poi.nom} — ajouté à ta carte ! (M)`);
    }
    if (open) draw();
  });

  return { toggle };
}
