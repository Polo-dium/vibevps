import { state } from '../state.js';
import { riverCx, riverHalf } from '../world/layout.js';
import { audio } from '../audio.js';

// Carte de Lyon (touche M) : fleuves + joueur + points d'intérêt DÉCOUVERTS.
// Chaque POI (statue, basilique, traboules…) se révèle quand on s'en
// approche en jeu — la découverte est gardée en localStorage. Les POI non
// trouvés ne sont pas affichés : à toi d'explorer, gone.

const LS_KEY = 'vibevps_pois';
const DISCOVER_R = 26; // distance de découverte (mètres)

export function createPoiMap(ctx, { getPlayer, onToast }) {
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
      <div id="map-hint">Explore la ville pour révéler les points d'intérêt · molette ou +/− pour zoomer · M ou Échap pour fermer</div>
    </div>`;
  document.body.appendChild(overlay);
  const canvas = overlay.querySelector('#map-canvas');
  const countEl = overlay.querySelector('#map-count');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) toggle(false); });

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
