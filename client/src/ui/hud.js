import { state, apiFetch } from '../state.js';

export function createUi() {
  // --- HUD permanent ---
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.innerHTML = `
    <div id="crosshair"></div>
    <div id="prompt" class="hidden"></div>
    <div id="hud-info"></div>
    <div id="hud-range" class="hidden"></div>
    <div id="hud-ammo" class="hidden"></div>
    <div id="toasts"></div>
    <div id="hud-hp">❤ 100</div>
    <div id="help">
      ZQSD bouger (sprint auto) · Espace saut · E interagir · clic tirer<br>
      F sprayer un tag · T éditeur de tags · 1 arme · R recharger · L classements
    </div>`;
  document.body.appendChild(hud);
  const vignette = document.createElement('div');
  vignette.id = 'vignette';
  document.body.appendChild(vignette);

  const hpEl = hud.querySelector('#hud-hp');
  let vignetteTimer = null;

  function setHp(hp) {
    hpEl.textContent = `❤ ${Math.max(0, hp)}`;
  }

  function damageFlash(strong = false) {
    vignette.style.opacity = strong ? '1' : '0.7';
    clearTimeout(vignetteTimer);
    vignetteTimer = setTimeout(() => { vignette.style.opacity = '0'; }, strong ? 500 : 180);
  }

  const promptEl = hud.querySelector('#prompt');
  const infoEl = hud.querySelector('#hud-info');
  const rangeEl = hud.querySelector('#hud-range');
  const ammoEl = hud.querySelector('#hud-ammo');
  const toastsEl = hud.querySelector('#toasts');

  function setPrompt(text) {
    if (!text) {
      promptEl.classList.add('hidden');
    } else {
      promptEl.innerHTML = text.replace(/^([A-Z1-9]+) — /, '<b>[$1]</b> ');
      promptEl.classList.remove('hidden');
    }
  }

  function setInfo({ fps, players, pos }) {
    infoEl.textContent =
      `LYON ARCADE — ${state.auth?.name ?? ''}\n` +
      `${players + 1} joueur(s) en ligne · ${fps} fps\n` +
      `x ${pos.x.toFixed(0)}  z ${pos.z.toFixed(0)}`;
    infoEl.style.whiteSpace = 'pre';
  }

  function setRange(session) {
    if (!session) {
      rangeEl.classList.add('hidden');
      return;
    }
    rangeEl.classList.remove('hidden');
    const acc = session.shots > 0 ? Math.round((session.hits / session.shots) * 100) : 100;
    rangeEl.innerHTML =
      `⏱ ${Math.ceil(session.timeLeft)}s — SCORE ${session.score}<br>` +
      `<span style="font-size:13px;">touches ${session.hits} / tirs ${session.shots} · précision ${acc}%</span>`;
  }

  function setAmmo(ammo, reloading, visible) {
    if (!visible) {
      ammoEl.classList.add('hidden');
      return;
    }
    ammoEl.classList.remove('hidden');
    ammoEl.textContent = reloading ? 'RECHARGE…' : `${ammo} / 30`;
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    toastsEl.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.4s';
      setTimeout(() => el.remove(), 450);
    }, 4200);
  }

  // --- Écran de pseudo ---
  async function ensureAuth() {
    const saved = localStorage.getItem('vibevps_auth');
    if (saved) {
      try {
        state.auth = JSON.parse(saved);
        await apiFetch('/me');
        return state.auth;
      } catch {
        state.auth = null;
        localStorage.removeItem('vibevps_auth');
      }
    }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = `
        <div class="panel" style="text-align:center;">
          <h1>LYON ARCADE</h1>
          <p class="sub">Une ville à explorer, des bornes à jouer, des murs à taguer.</p>
          <input type="text" id="name-input" placeholder="Ton pseudo" maxlength="16" autofocus>
          <div class="err" id="name-err"></div>
          <button id="name-go">ENTRER DANS LA VILLE</button>
        </div>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#name-input');
      const err = overlay.querySelector('#name-err');
      const go = async () => {
        err.textContent = '';
        try {
          const auth = await apiFetch('/register', {
            method: 'POST',
            body: JSON.stringify({ name: input.value }),
          });
          state.auth = auth;
          localStorage.setItem('vibevps_auth', JSON.stringify(auth));
          overlay.remove();
          resolve(auth);
        } catch (e) {
          err.textContent = e.message;
        }
      };
      overlay.querySelector('#name-go').onclick = go;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      setTimeout(() => input.focus(), 50);
    });
  }

  // --- Panneau des classements (L) ---
  const lbOverlay = document.createElement('div');
  lbOverlay.className = 'overlay hidden';
  lbOverlay.innerHTML = `
    <div class="panel" style="width:900px;">
      <h2>CLASSEMENTS</h2>
      <div id="lb-grid"></div>
      <div style="margin-top:14px; text-align:right;">
        <button class="ghost" id="lb-close">Fermer (Échap ou L)</button>
      </div>
    </div>`;
  document.body.appendChild(lbOverlay);
  lbOverlay.querySelector('#lb-close').onclick = () => toggleLeaderboards(false);

  function renderLeaderboards() {
    const grid = lbOverlay.querySelector('#lb-grid');
    grid.innerHTML = '';
    for (const game of state.games) {
      const rows = state.leaderboards[game.id] ?? [];
      const card = document.createElement('div');
      card.className = 'lb-card';
      const isRange = game.id === 'shooting-range';
      card.innerHTML =
        `<h4>${escapeHtml(game.title)}</h4>` +
        (game.creator ? `<div style="color:#7f9ab0;font-size:11px;">par ${escapeHtml(game.creator)}</div>` : '') +
        (rows.length === 0
          ? '<div style="color:#5d7385;">aucun score</div>'
          : rows.map((r, i) => {
              const me = r.name === state.auth?.name ? ' style="color:var(--neon);"' : '';
              const acc = isRange && r.accuracy != null ? ` · ${r.accuracy}%` : '';
              return `<div${me}>${i + 1}. ${escapeHtml(r.name)} — ${r.score}${acc}</div>`;
            }).join(''));
      grid.appendChild(card);
    }
  }

  function toggleLeaderboards(force) {
    const show = force ?? lbOverlay.classList.contains('hidden');
    if (show) {
      renderLeaderboards();
      lbOverlay.classList.remove('hidden');
      state.overlayOpen = true;
      document.exitPointerLock?.();
    } else {
      lbOverlay.classList.add('hidden');
      state.overlayOpen = false;
    }
    return show;
  }

  // --- Créateur de borne IA ---
  const creatorOverlay = document.createElement('div');
  creatorOverlay.className = 'overlay hidden';
  creatorOverlay.innerHTML = `
    <div class="panel" style="width:560px;">
      <h2>CRÉER UNE BORNE (IA)</h2>
      <p class="sub">Décris ton mini-jeu : une IA (Claude Sonnet) va coder une vraie borne
      jouable, qui apparaîtra dans la salle pour tout le monde, avec son classement.</p>
      <input type="text" id="creator-title" placeholder="Nom de la borne (ex: FROG RIVER)" maxlength="32">
      <textarea id="creator-prompt" placeholder="Décris le gameplay… (ex: une grenouille traverse la Saône en sautant sur des péniches qui défilent, +10 points par traversée, de plus en plus vite)" maxlength="2000"></textarea>
      <div class="err" id="creator-err"></div>
      <div id="loading-bar" class="hidden">▚ GÉNÉRATION DU JEU EN COURS… (30 s à 2 min)</div>
      <div style="display:flex; gap:10px; margin-top:10px;">
        <button id="creator-go">GÉNÉRER LA BORNE</button>
        <button class="ghost" id="creator-close">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(creatorOverlay);

  const creatorErr = creatorOverlay.querySelector('#creator-err');
  const creatorLoad = creatorOverlay.querySelector('#loading-bar');
  const creatorGo = creatorOverlay.querySelector('#creator-go');

  function openCreator() {
    creatorOverlay.classList.remove('hidden');
    state.overlayOpen = true;
    document.exitPointerLock?.();
    setTimeout(() => creatorOverlay.querySelector('#creator-title').focus(), 50);
  }
  function closeCreator() {
    if (creatorGo.disabled) return; // pas pendant une génération
    creatorOverlay.classList.add('hidden');
    state.overlayOpen = false;
  }
  creatorOverlay.querySelector('#creator-close').onclick = closeCreator;
  creatorGo.onclick = async () => {
    creatorErr.textContent = '';
    const title = creatorOverlay.querySelector('#creator-title').value.trim();
    const prompt = creatorOverlay.querySelector('#creator-prompt').value.trim();
    creatorGo.disabled = true;
    creatorLoad.classList.remove('hidden');
    try {
      const res = await apiFetch('/games', {
        method: 'POST',
        body: JSON.stringify({ title, prompt }),
      });
      toast(`Borne « ${res.game.title} » créée ! Elle est dans la salle.`);
      creatorOverlay.querySelector('#creator-title').value = '';
      creatorOverlay.querySelector('#creator-prompt').value = '';
      creatorGo.disabled = false;
      creatorLoad.classList.add('hidden');
      closeCreator();
    } catch (err) {
      creatorErr.textContent = err.message;
      creatorGo.disabled = false;
      creatorLoad.classList.add('hidden');
    }
  };

  function closeTopOverlay() {
    if (!creatorOverlay.classList.contains('hidden')) { closeCreator(); return true; }
    if (!lbOverlay.classList.contains('hidden')) { toggleLeaderboards(false); return true; }
    return false;
  }

  return {
    ensureAuth, toast, setPrompt, setInfo, setRange, setAmmo,
    setHp, damageFlash,
    toggleLeaderboards, openCreator, closeTopOverlay,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
