import { state } from './state.js';

// Capture d'écran stylée : la frame est re-rendue puis composée avec un
// bandeau « LYON ARCADE » (pseudo, niveau, date) prêt à partager.
// Le MODE PHOTO (touche C ou bouton 📸) ajoute le zoom : molette ou +/−,
// clic ou C pour déclencher, Échap ou ✕ pour sortir.
export function createCapture({ renderer, scene, camera, onToast }) {
  let busy = false;
  let modeOn = false;
  let zoom = 1;

  // Barre du mode photo : [−] [📸] [+] [✕]
  const bar = document.createElement('div');
  bar.id = 'photo-bar';
  bar.className = 'hidden';
  bar.innerHTML = `
    <button id="ph-zo">−</button>
    <button id="ph-shot">📸</button>
    <button id="ph-zi">+</button>
    <button id="ph-close">✕</button>
    <div id="ph-hint">molette ou +/− : zoom · clic, C ou 📸 : photo · Échap : quitter</div>`;
  document.body.appendChild(bar);
  const bind = (id, fn) => {
    const el = bar.querySelector(id);
    el.addEventListener('click', fn);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
  };
  bind('#ph-zi', () => setZoom(zoom * 1.3));
  bind('#ph-zo', () => setZoom(zoom / 1.3));
  bind('#ph-shot', () => take());
  bind('#ph-close', () => toggleMode(false));

  function setZoom(z) {
    zoom = Math.max(1, Math.min(6, z));
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }

  function toggleMode(force) {
    modeOn = force ?? !modeOn;
    state.photoMode = modeOn;
    bar.classList.toggle('hidden', !modeOn);
    if (!modeOn) setZoom(1); // on repart en champ normal
  }

  // Zoom à la molette pendant le mode photo (hors overlays)
  window.addEventListener('wheel', (e) => {
    if (!modeOn || state.overlayOpen || state.tagMode) return;
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && modeOn && !state.overlayOpen) toggleMode(false);
  });
  // Clic gauche = déclencheur (le tir est coupé en mode photo, voir weapon.js)
  window.addEventListener('mousedown', (e) => {
    if (modeOn && e.button === 0 && state.pointerLocked && !state.overlayOpen && !state.tagMode) take();
  });

  async function take() {
    if (busy) return;
    busy = true;
    try {
      // Re-rend la frame juste avant la lecture : pas besoin de
      // preserveDrawingBuffer tant que toDataURL suit le render.
      renderer.render(scene, camera);
      const src = renderer.domElement;
      const canvas = document.createElement('canvas');
      canvas.width = src.width;
      canvas.height = src.height;
      const g = canvas.getContext('2d');
      g.drawImage(src, 0, 0);

      // Bandeau dégradé en bas
      const bh = Math.max(54, Math.round(canvas.height * 0.09));
      const grad = g.createLinearGradient(0, canvas.height - bh * 1.8, 0, canvas.height);
      grad.addColorStop(0, 'rgba(6, 8, 18, 0)');
      grad.addColorStop(0.55, 'rgba(6, 8, 18, 0.75)');
      grad.addColorStop(1, 'rgba(6, 8, 18, 0.92)');
      g.fillStyle = grad;
      g.fillRect(0, canvas.height - bh * 1.8, canvas.width, bh * 1.8);

      const pad = Math.round(bh * 0.35);
      const baseY = canvas.height - pad;
      // Titre néon
      g.font = `900 ${Math.round(bh * 0.52)}px "Courier New", monospace`;
      g.textBaseline = 'alphabetic';
      g.shadowColor = '#00ffd5';
      g.shadowBlur = 18;
      g.fillStyle = '#00ffd5';
      g.fillText('LYON ARCADE', pad, baseY);
      g.shadowBlur = 0;
      // Pseudo + niveau + date, alignés à droite
      const info = `${state.auth?.name ?? 'gone'} · NIV ${state.level ?? 1} · ${new Date().toLocaleDateString('fr-FR')}`;
      g.font = `600 ${Math.round(bh * 0.3)}px "Segoe UI", sans-serif`;
      g.fillStyle = '#e8f0f8';
      g.textAlign = 'right';
      g.fillText(info, canvas.width - pad, baseY);
      g.textAlign = 'left';

      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('capture vide');
      const file = new File([blob], `lyon-arcade-${Date.now()}.png`, { type: 'image/png' });

      // Partage natif si possible (mobile), sinon téléchargement direct
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'LYON ARCADE',
          text: 'Mon Lyon en low-poly 🎮 — viens taguer Bellecour !',
        });
        onToast('📸 Capture partagée !');
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        onToast('📸 Capture enregistrée !');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') onToast('Capture impossible : ' + err.message);
    } finally {
      busy = false;
    }
  }

  return { take, toggleMode, get modeOn() { return modeOn; } };
}
