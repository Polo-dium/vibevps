import { state } from './state.js';

// Capture d'écran stylée en un clic : la frame est re-rendue puis composée
// avec un bandeau « LYON ARCADE » (pseudo, niveau, date) prêt à partager.
export function createCapture({ renderer, scene, camera, onToast }) {
  let busy = false;

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

  return { take };
}
