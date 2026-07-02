import { state, apiFetch } from '../state.js';
import { IS_TOUCH } from '../player/controls.js';
import { ACHIEVEMENTS, levelOf, xpForLevel } from '../progress.js';
import { PAINT_COLORS, COLOR_MIN_LEVEL } from '../tags/spray.js';
import { audio } from '../audio.js';

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
    <div id="hud-xp">
      <span id="xp-level">NIV 1</span>
      <div id="xp-bar"><div id="xp-fill"></div></div>
    </div>
    <div id="levelbanner" class="hidden"></div>
    <div id="mic-indicator" class="hidden">🎤 EN DIRECT</div>
    <div id="chatfeed"></div>
    <div id="chatbox" class="hidden"><input type="text" id="chatinput" maxlength="120" placeholder="Message de proximité… (Entrée pour envoyer)"></div>
    <div id="killbanner" class="hidden"></div>
    <div id="hitmarker" class="hidden">✕</div>
    <div id="deathscreen" class="hidden">
      <div id="death-title"></div>
      <div id="death-sub">Retour à Bellecour…</div>
    </div>
    <div id="tagmode-hint" class="hidden"></div>
    <div id="help">
      ZQSD bouger (sprint auto) · Espace saut · E interagir · clic tirer<br>
      F bombe de peinture (clic = graffiti, molette = couleur) · G poser ton tag<br>
      T éditeur de tags · 1 arme · R recharger · L classements · P admin
    </div>`;
  document.body.appendChild(hud);
  const vignette = document.createElement('div');
  vignette.id = 'vignette';
  document.body.appendChild(vignette);

  const hpEl = hud.querySelector('#hud-hp');
  const crosshairEl = hud.querySelector('#crosshair');
  const killbannerEl = hud.querySelector('#killbanner');
  const tagHintEl = hud.querySelector('#tagmode-hint');
  const chatfeedEl = hud.querySelector('#chatfeed');
  const chatboxEl = hud.querySelector('#chatbox');
  const chatinputEl = hud.querySelector('#chatinput');
  let vignetteTimer = null;
  let killbannerTimer = null;
  let chatSend = null;

  function onChatSend(fn) { chatSend = fn; }

  const micEl = hud.querySelector('#mic-indicator');
  function setMicState(on) {
    micEl.classList.toggle('hidden', !on);
    document.getElementById('tb-mic')?.classList.toggle('on', on);
  }

  function addChatLine(name, text, mine = false) {
    const line = document.createElement('div');
    line.className = 'chatline';
    line.innerHTML = `<b style="color:${mine ? 'var(--neon)' : '#ffd56b'}">${escapeHtml(name)}</b> ${escapeHtml(text)}`;
    chatfeedEl.appendChild(line);
    while (chatfeedEl.children.length > 6) chatfeedEl.firstChild.remove();
    setTimeout(() => {
      line.style.opacity = '0';
      setTimeout(() => line.remove(), 600);
    }, 9000);
  }

  function openChat() {
    if (state.overlayOpen) return;
    chatboxEl.classList.remove('hidden');
    state.chatOpen = true;
    state.overlayOpen = true; // bloque déplacements/tir pendant la saisie
    document.exitPointerLock?.();
    setTimeout(() => chatinputEl.focus(), 30);
  }
  function closeChat() {
    chatboxEl.classList.add('hidden');
    chatinputEl.value = '';
    state.chatOpen = false;
    state.overlayOpen = false;
  }
  chatinputEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = chatinputEl.value.trim();
      if (text && chatSend) {
        chatSend(text);
        addChatLine(state.auth?.name ?? 'moi', text, true);
      }
      closeChat();
    } else if (e.key === 'Escape') {
      closeChat();
    }
  });

  // --- XP, niveaux, confettis ---
  const xpLevelEl = hud.querySelector('#xp-level');
  const xpFillEl = hud.querySelector('#xp-fill');
  const levelBannerEl = hud.querySelector('#levelbanner');
  let levelBannerTimer = null;

  function spawnConfetti(n = 36) {
    const colors = ['#ff3df0', '#00ffd5', '#ffe14d', '#ff5252', '#4da6ff', '#4dff6a'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = `${8 + Math.random() * 84}vw`;
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = `${Math.random() * 0.4}s`;
      c.style.animationDuration = `${1.4 + Math.random() * 1.2}s`;
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 3200);
    }
  }

  function setXp(xp, { silent = false } = {}) {
    const prevLevel = state.level ?? 1;
    state.xp = xp;
    state.level = levelOf(xp);
    const cur = xpForLevel(state.level);
    const next = xpForLevel(state.level + 1);
    xpLevelEl.textContent = `NIV ${state.level}`;
    xpFillEl.style.width = `${Math.round(((xp - cur) / (next - cur)) * 100)}%`;
    if (!silent && state.level > prevLevel) {
      levelBannerEl.textContent = `⭐ NIVEAU ${state.level} !`;
      levelBannerEl.classList.remove('hidden');
      levelBannerEl.style.animation = 'none';
      void levelBannerEl.offsetWidth;
      levelBannerEl.style.animation = '';
      clearTimeout(levelBannerTimer);
      levelBannerTimer = setTimeout(() => levelBannerEl.classList.add('hidden'), 2600);
      spawnConfetti(44);
      audio.levelUp();
      navigator.vibrate?.([30, 30, 60]);
      // Couleur de bombe débloquée à ce niveau ?
      const newColors = PAINT_COLORS.filter((_, i) => COLOR_MIN_LEVEL[i] === state.level);
      if (newColors.length > 0) {
        toast(`🌈 Nouvelle couleur de bombe débloquée ! (molette ou bouton 🌈)`);
      }
    }
  }

  function achievementUnlocked(a) {
    toast(`🏆 Succès débloqué : ${a.icon} ${a.name} — ${a.desc}`);
    spawnConfetti(24);
    audio.trophy();
  }

  // Hitmarker : croix furtive au centre quand un tir touche
  const hitmarkerEl = hud.querySelector('#hitmarker');
  let hitmarkerTimer = null;
  function hitmarker() {
    hitmarkerEl.classList.remove('hidden');
    clearTimeout(hitmarkerTimer);
    hitmarkerTimer = setTimeout(() => hitmarkerEl.classList.add('hidden'), 110);
  }

  // Écran de mort : voile rouge sombre + nom du tueur, disparaît tout seul
  const deathEl = hud.querySelector('#deathscreen');
  let deathTimer = null;
  function deathScreen(byName) {
    deathEl.querySelector('#death-title').textContent = `💀 Abattu par ${byName}`;
    deathEl.classList.remove('hidden');
    deathEl.style.opacity = '1';
    clearTimeout(deathTimer);
    deathTimer = setTimeout(() => {
      deathEl.style.opacity = '0';
      setTimeout(() => deathEl.classList.add('hidden'), 450);
    }, 1600);
  }

  function killBanner(text) {
    killbannerEl.textContent = text;
    killbannerEl.classList.remove('hidden');
    killbannerEl.style.animation = 'none';
    void killbannerEl.offsetWidth; // relance l'animation CSS
    killbannerEl.style.animation = '';
    clearTimeout(killbannerTimer);
    killbannerTimer = setTimeout(() => killbannerEl.classList.add('hidden'), 1900);
  }

  function setTagMode(paintColor) {
    if (paintColor) {
      crosshairEl.style.background = paintColor;
      crosshairEl.style.width = '12px';
      crosshairEl.style.height = '12px';
      crosshairEl.style.margin = '-6px';
      tagHintEl.textContent = `🎨 Mode bombe — clic : graffiti à main levée · G : poser ton tag · molette : couleur`;
      tagHintEl.style.borderColor = paintColor;
      tagHintEl.classList.remove('hidden');
    } else {
      crosshairEl.style.background = 'rgba(255, 255, 255, 0.9)';
      crosshairEl.style.width = '6px';
      crosshairEl.style.height = '6px';
      crosshairEl.style.margin = '-3px';
      tagHintEl.classList.add('hidden');
    }
  }

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
    } else if (IS_TOUCH) {
      // Sur tactile : pas de touche E, on invite à toucher directement.
      promptEl.innerHTML = '<b>▶ JOUER</b> ' + text.replace(/^[A-Z1-9]+ — /, '');
      promptEl.classList.remove('hidden');
    } else {
      promptEl.innerHTML = text.replace(/^([A-Z1-9]+) — /, '<b>[$1]</b> ');
      promptEl.classList.remove('hidden');
    }
  }
  function onPromptTap(handler) {
    promptEl.addEventListener('touchstart', (e) => { e.preventDefault(); handler(); }, { passive: false });
    promptEl.addEventListener('click', () => handler());
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
        const me = await apiFetch('/me');
        state.isAdmin = Boolean(me.admin);
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
      <h2 style="margin-top:16px;">🏆 SUCCÈS</h2>
      <div id="ach-grid"></div>
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

  // Instance de progression (branchée par main.js) pour l'état des succès
  let progressRef = null;
  function bindProgress(p) { progressRef = p; }

  function renderAchievements() {
    const grid = lbOverlay.querySelector('#ach-grid');
    grid.innerHTML = ACHIEVEMENTS.map((a) => {
      const ok = progressRef?.isUnlocked(a.id);
      return `<div class="ach${ok ? ' unlocked' : ''}" title="${escapeHtml(a.desc)}">
        <span class="ach-icon">${ok ? a.icon : '🔒'}</span>
        <div><b>${escapeHtml(a.name)}</b><br><span class="ach-desc">${escapeHtml(a.desc)}</span></div>
      </div>`;
    }).join('');
  }

  function toggleLeaderboards(force) {
    const show = force ?? lbOverlay.classList.contains('hidden');
    if (show) {
      renderLeaderboards();
      renderAchievements();
      // Rafraîchit depuis le serveur puis met à jour l'affichage
      progressRef?.refresh().then(() => renderAchievements());
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

  // --- Panneau admin (touche P) ---
  const adminOverlay = document.createElement('div');
  adminOverlay.className = 'overlay hidden';
  adminOverlay.innerHTML = `
    <div class="panel" style="width:480px;">
      <h2>ADMINISTRATION</h2>
      <div id="admin-login">
        <p class="sub">Entre la clé admin du serveur (variable ADMIN_KEY).</p>
        <input type="text" id="admin-key" placeholder="Clé admin">
        <div class="err" id="admin-err"></div>
        <button id="admin-go">SE CONNECTER</button>
      </div>
      <div id="admin-tools" class="hidden">
        <p class="sub">Mode modération actif.<br>
        En jeu : vise un graffiti et appuie sur <b style="color:var(--neon)">X</b> pour le supprimer.</p>
        <div class="err" id="admin-err2"></div>
        <button id="admin-clear" style="background:linear-gradient(135deg,#ff5252,#b0413e);color:#fff;">
          🗑 SUPPRIMER TOUS LES TAGS
        </button>
      </div>
      <div style="margin-top:14px; text-align:right;">
        <button class="ghost" id="admin-close">Fermer (Échap)</button>
      </div>
    </div>`;
  document.body.appendChild(adminOverlay);
  adminOverlay.querySelector('#admin-close').onclick = () => toggleAdmin(false);
  adminOverlay.querySelector('#admin-go').onclick = async () => {
    const errEl = adminOverlay.querySelector('#admin-err');
    errEl.textContent = '';
    try {
      await apiFetch('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ key: adminOverlay.querySelector('#admin-key').value }),
      });
      state.isAdmin = true;
      refreshAdminPanel();
      toast('Mode admin activé. Vise un tag et appuie sur X pour le supprimer.');
    } catch (err) {
      errEl.textContent = err.message;
    }
  };
  adminOverlay.querySelector('#admin-clear').onclick = async () => {
    const errEl = adminOverlay.querySelector('#admin-err2');
    errEl.textContent = '';
    if (!confirm('Supprimer TOUS les tags de la ville ? (irréversible)')) return;
    try {
      const res = await apiFetch('/tags', { method: 'DELETE' });
      toast(`${res.deleted} tag(s) supprimé(s).`);
      toggleAdmin(false);
    } catch (err) {
      errEl.textContent = err.message;
    }
  };

  function refreshAdminPanel() {
    adminOverlay.querySelector('#admin-login').classList.toggle('hidden', state.isAdmin);
    adminOverlay.querySelector('#admin-tools').classList.toggle('hidden', !state.isAdmin);
  }

  function toggleAdmin(force) {
    const show = force ?? adminOverlay.classList.contains('hidden');
    if (show) {
      refreshAdminPanel();
      adminOverlay.classList.remove('hidden');
      state.overlayOpen = true;
      document.exitPointerLock?.();
      if (!state.isAdmin) {
        setTimeout(() => adminOverlay.querySelector('#admin-key').focus(), 50);
      }
    } else {
      adminOverlay.classList.add('hidden');
      state.overlayOpen = false;
    }
  }

  function closeTopOverlay() {
    if (!creatorOverlay.classList.contains('hidden')) { closeCreator(); return true; }
    if (!lbOverlay.classList.contains('hidden')) { toggleLeaderboards(false); return true; }
    if (!adminOverlay.classList.contains('hidden')) { toggleAdmin(false); return true; }
    return false;
  }

  return {
    ensureAuth, toast, setPrompt, onPromptTap, setInfo, setRange, setAmmo,
    setHp, damageFlash, killBanner, setTagMode, hitmarker, deathScreen,
    setXp, spawnConfetti, achievementUnlocked, bindProgress,
    toggleLeaderboards, openCreator, toggleAdmin, closeTopOverlay,
    openChat, onChatSend, addChatLine, setMicState,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
