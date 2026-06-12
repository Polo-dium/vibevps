import { state, apiFetch } from '../state.js';

const COLORS = ['#ffffff', '#ff3df0', '#00ffd5', '#ffe14d', '#ff5252', '#4da6ff', '#4dff6a', '#ff9d3d', '#b44dff', '#111111'];
const SIZE = 512;

export function createTagEditor({ onToast, onOpenChange }) {
  const root = document.createElement('div');
  root.className = 'overlay hidden';
  root.innerHTML = `
    <div class="panel" style="width:920px; display:flex; gap:20px;">
      <div>
        <h2>ÉDITEUR DE TAG</h2>
        <canvas id="tag-editor-canvas" width="${SIZE}" height="${SIZE}" style="width:440px;height:440px;"></canvas>
      </div>
      <div style="flex:1; display:flex; flex-direction:column;">
        <div class="tag-tools" id="tag-palette"></div>
        <div class="tag-tools">
          <label style="font-size:13px;">Taille</label>
          <input type="range" id="tag-brush" min="4" max="60" value="18" style="flex:1;">
          <button class="ghost" id="tag-eraser">Gomme</button>
          <button class="ghost" id="tag-undo">Annuler</button>
          <button class="ghost" id="tag-clear">Vider</button>
        </div>
        <input type="text" id="tag-name" placeholder="Nom du tag" maxlength="24">
        <div class="err" id="tag-err"></div>
        <div class="tag-tools">
          <button id="tag-save">Sauvegarder &amp; équiper</button>
          <button class="ghost" id="tag-close">Fermer (Échap)</button>
        </div>
        <h2 style="font-size:15px; margin-top:14px;">MES TAGS <span style="color:#7f9ab0;font-size:12px;">(clic = équiper, F pour sprayer)</span></h2>
        <div class="tag-lib" id="tag-lib"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const canvas = root.querySelector('#tag-editor-canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const palette = root.querySelector('#tag-palette');
  const lib = root.querySelector('#tag-lib');
  const errEl = root.querySelector('#tag-err');

  let color = COLORS[1];
  let brush = 18;
  let eraser = false;
  let drawing = false;
  let last = null;
  const undoStack = [];

  // Palette
  for (const c of COLORS) {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (c === color ? ' active' : '');
    sw.style.background = c;
    sw.onclick = () => {
      color = c;
      eraser = false;
      palette.querySelectorAll('.swatch').forEach((el) => el.classList.remove('active'));
      sw.classList.add('active');
    };
    palette.appendChild(sw);
  }

  root.querySelector('#tag-brush').oninput = (e) => { brush = Number(e.target.value); };
  root.querySelector('#tag-eraser').onclick = () => { eraser = !eraser; };
  root.querySelector('#tag-clear').onclick = () => { pushUndo(); g.clearRect(0, 0, SIZE, SIZE); };
  root.querySelector('#tag-undo').onclick = popUndo;
  root.querySelector('#tag-close').onclick = close;

  function pushUndo() {
    undoStack.push(g.getImageData(0, 0, SIZE, SIZE));
    if (undoStack.length > 25) undoStack.shift();
  }
  function popUndo() {
    const img = undoStack.pop();
    if (img) g.putImageData(img, 0, 0);
  }

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * SIZE,
      y: ((e.clientY - r.top) / r.height) * SIZE,
    };
  }
  function strokeTo(p) {
    g.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    g.strokeStyle = color;
    g.lineWidth = brush;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(last.x, last.y);
    g.lineTo(p.x, p.y);
    g.stroke();
    last = p;
  }
  canvas.addEventListener('pointerdown', (e) => {
    pushUndo();
    drawing = true;
    last = canvasPos(e);
    strokeTo({ x: last.x + 0.01, y: last.y });
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => { if (drawing) strokeTo(canvasPos(e)); });
  canvas.addEventListener('pointerup', () => { drawing = false; });

  // Sauvegarde
  root.querySelector('#tag-save').onclick = async () => {
    errEl.textContent = '';
    const name = root.querySelector('#tag-name').value.trim() || 'tag';
    const data = exportPng();
    if (!data) { errEl.textContent = 'Le tag est vide.'; return; }
    try {
      const saved = await apiFetch('/tag-images', {
        method: 'POST',
        body: JSON.stringify({ name, data }),
      });
      state.activeTagImage = saved.data;
      renderLibItem(saved, true);
      onToast(`Tag « ${name} » sauvegardé et équipé. Appuie sur F devant un mur !`);
    } catch (err) {
      errEl.textContent = err.message;
    }
  };

  function exportPng() {
    // Réduit à 256px pour limiter le poids, vérifie qu'il y a du contenu
    const out = document.createElement('canvas');
    out.width = 256;
    out.height = 256;
    const og = out.getContext('2d');
    og.drawImage(canvas, 0, 0, 256, 256);
    const pixels = og.getImageData(0, 0, 256, 256).data;
    let hasContent = false;
    for (let i = 3; i < pixels.length; i += 16) {
      if (pixels[i] > 10) { hasContent = true; break; }
    }
    return hasContent ? out.toDataURL('image/png') : null;
  }

  function renderLibItem(img, makeActive = false) {
    const el = document.createElement('img');
    el.src = img.data;
    el.title = img.name;
    el.onclick = () => {
      state.activeTagImage = img.data;
      lib.querySelectorAll('img').forEach((i) => i.classList.remove('active'));
      el.classList.add('active');
    };
    lib.prepend(el);
    if (makeActive) {
      lib.querySelectorAll('img').forEach((i) => i.classList.remove('active'));
      el.classList.add('active');
    }
  }

  async function loadLibrary() {
    lib.innerHTML = '';
    for (const preset of makePresets()) renderLibItem(preset);
    try {
      const { images } = await apiFetch('/tag-images');
      for (const img of [...images].reverse()) renderLibItem(img);
    } catch { /* hors-ligne : presets seulement */ }
    // Équipe le premier par défaut si rien d'actif
    if (!state.activeTagImage) {
      const first = lib.querySelector('img');
      if (first) first.click();
    }
  }

  function open() {
    root.classList.remove('hidden');
    state.overlayOpen = true;
    onOpenChange?.(true);
    if (lib.childElementCount === 0) loadLibrary();
  }
  function close() {
    root.classList.add('hidden');
    state.overlayOpen = false;
    onOpenChange?.(false);
  }

  return { open, close, loadLibrary, isOpen: () => !root.classList.contains('hidden') };
}

// Tags prédéfinis générés localement
function makePresets() {
  const presets = [];
  const make = (draw, name) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    draw(ctx);
    presets.push({ name, data: c.toDataURL('image/png') });
  };

  make((ctx) => {
    ctx.font = 'bold 72px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00ffd5';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#00ffd5';
    ctx.fillText('LYON', 128, 110);
    ctx.fillStyle = '#ff3df0';
    ctx.shadowColor = '#ff3df0';
    ctx.font = 'bold 46px "Courier New", monospace';
    ctx.fillText('VIBES', 128, 175);
  }, 'LYON VIBES');

  make((ctx) => {
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 12;
    ctx.shadowColor = '#ffe14d';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(128, 128, 88, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(95, 100, 12, 0, Math.PI * 2);
    ctx.arc(161, 100, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe14d';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(128, 140, 50, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();
  }, 'Smiley');

  make((ctx) => {
    // Petit lion stylisé (emblème de Lyon)
    ctx.font = 'bold 150px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff5252';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ff5252';
    ctx.fillText('🦁', 128, 128);
  }, 'Lion');

  return presets;
}
