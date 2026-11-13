import * as THREE from 'three';
import { state } from '../state.js';
import { ARENA, BASES, CONSOLE, MEDS, PORTAL } from '../../../shared/arena-layout.js';

// MATCHS DE L'ARÈNE — côté client. Le serveur (server/src/arena.js) simule
// les bots et arbitre tout ; ici on ne fait qu'AFFICHER et RÉGLER :
//  - bandeau de partie (mode, chrono, scores), fil des éliminations,
//    tableau des scores (Tab, ou entre deux manches)
//  - équipes : maillots rouges/bleus, noms des adversaires masqués
//  - drapeaux de la capture (2 maillages), arme imposée (snipers, couteaux)
//  - console de match près du portail (mode, bots, difficulté, enchaînement)
//  - tableau des meilleurs du mode, au-dessus du portail (canvas → texture)

const OX = ARENA.OFFSET;
export const MODE_LABELS = {
  ffa: 'Mêlée générale',
  tdm: 'Match à mort par équipes',
  ctf: 'Capture du drapeau',
  zone: 'Zone à tenir',
  sniper: 'Snipers',
  couteau: 'Couteaux',
};
const MODE_GOALS = {
  ffa: 'Chacun pour soi', tdm: 'Rouges contre Bleus', ctf: 'Ramène leur drapeau à ta base', zone: 'Reste dans le cercle',
  sniper: 'Une balle, un gone', couteau: 'Au corps à corps',
};
const DIFF_LABELS = ['Facile', 'Normal', 'Difficile', 'Réaliste'];
// Couleurs RELATIVES : le rouge, c'est toujours l'adversaire ; le bleu, ton
// équipe — quelle que soit l'équipe (0 ou 1) où le serveur t'a mis. En
// mêlée générale, tout le monde est rouge.
const FOE_CSS = '#ff5a4d', ALLY_CSS = '#5b9bff';
const WPN_ICON = { 1: '🔫', 2: '🔨', 3: '💥', 4: '🌀', 5: '🚀', 6: '🔫', 7: '🏏', 8: '🎯', 9: '🔪', 10: '💣', 11: '🥖' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function createArenaMatch(ctx, { ui, net, remotes, weapon, controls, audio, getMyId }) {
  let snap = null;      // dernier état reçu
  let top = { mode: 'ffa', rows: [] };
  let myTeam = -1;
  let loadoutMode = null;
  let boardHeld = false;
  let revealUntil = 0; // drone-pigeon actif jusqu'à cet instant

  // --- DOM ---------------------------------------------------------------------
  const root = document.createElement('div');
  root.id = 'arena-ui';
  root.className = 'hidden';
  root.innerHTML = `
    <div id="arena-hud">
      <div id="arena-mode"></div>
      <div id="arena-score"></div>
      <div id="arena-sub"></div>
    </div>
    <div id="arena-feed"></div>
    <div id="arena-banner" class="hidden"></div>
    <div id="arena-board" class="hidden"></div>`;
  document.body.appendChild(root);
  const $ = (sel) => root.querySelector(sel);
  const modeEl = $('#arena-mode'), scoreEl = $('#arena-score'), subEl = $('#arena-sub');
  const feedEl = $('#arena-feed'), bannerEl = $('#arena-banner'), boardEl = $('#arena-board');

  let bannerTimer = null;
  function banner(html, ms = 2600) {
    bannerEl.innerHTML = html;
    bannerEl.classList.remove('hidden');
    bannerEl.style.animation = 'none';
    void bannerEl.offsetWidth;
    bannerEl.style.animation = '';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.add('hidden'), ms);
  }
  const isAlly = (team) => team >= 0 && team === myTeam;
  const css = (team) => (isAlly(team) ? ALLY_CSS : FOE_CSS);
  const nameHtml = (name, team) => `<b style="color:${css(team)}">${esc(name)}</b>`;
  function feed(html) {
    const line = document.createElement('div');
    line.innerHTML = html;
    feedEl.appendChild(line);
    while (feedEl.children.length > 5) feedEl.firstChild.remove();
    setTimeout(() => line.remove(), 6000);
  }

  function renderHud() {
    if (!snap) return;
    const me = snap.b.find((r) => r[0] === getMyId());
    modeEl.textContent = `${MODE_LABELS[snap.mode] ?? snap.mode} · ${snap.st === 'play' ? mmss(snap.left) : 'manche terminée'}`;
    if (snap.teams) {
      const flag = (t) => (snap.f ? ['', ' ⚑', ' ⚐'][snap.f[t][0]] : '');
      const mine = Math.max(0, myTeam), theirs = 1 - mine;
      scoreEl.innerHTML =
        `<span style="color:${ALLY_CSS}">TON ÉQUIPE${flag(mine)} <b>${snap.sc[mine]}</b></span>` +
        `<i>${snap.lim}</i>` +
        `<span style="color:${FOE_CSS}"><b>${snap.sc[theirs]}</b> ADVERSAIRES${flag(theirs)}</span>`;
      if (snap.z) {
        const o = snap.z[3];
        const who = o === 2 ? '<b style="color:#f0b648">contestée</b>'
          : o < 0 ? 'libre' : isAlly(o) ? `<b style="color:${ALLY_CSS}">à ton équipe</b>` : `<b style="color:${FOE_CSS}">aux adversaires</b>`;
        subEl.innerHTML = `Zone ${who} · elle bouge dans ${snap.z[4]} s`;
      } else {
        subEl.innerHTML = `Alliés en <b style="color:${ALLY_CSS}">bleu</b>, ennemis en <b style="color:${FOE_CSS}">rouge</b> · ${me ? `${me[3]} élim.` : ''}`;
      }
    } else {
      const ranked = [...snap.b].sort((a, b) => b[3] - a[3] || a[4] - b[4]);
      const lead = ranked[0];
      const rank = me ? ranked.indexOf(me) + 1 : 0;
      scoreEl.innerHTML = `<span><b>${me ? me[3] : 0}</b> TOI</span><i>${snap.lim}</i><span>${esc(lead?.[1] ?? '—')} <b>${lead?.[3] ?? 0}</b></span>`;
      subEl.textContent = rank ? `${rank}${rank === 1 ? 'er' : 'e'} sur ${ranked.length} · ${MODE_GOALS[snap.mode]}` : '';
    }
  }

  function renderBoard() {
    const show = snap && (boardHeld || snap.st === 'inter');
    boardEl.classList.toggle('hidden', !show);
    if (!show) return;
    const myId = getMyId();
    const rows = [...snap.b].sort((a, b) => (b[3] + b[6] * 3) - (a[3] + a[6] * 3) || a[4] - b[4]);
    const line = (r) => `<tr class="${r[0] === myId ? 'me' : ''}">
      <td>${esc(r[1])}</td><td>${r[3]}</td><td>${r[4]}</td>${snap.mode === 'ctf' ? `<td>${r[6]}</td>` : ''}</tr>`;
    const head = `<tr><th>Gone</th><th>Élim.</th><th>Morts</th>${snap.mode === 'ctf' ? '<th>⚑</th>' : ''}</tr>`;
    let body;
    if (snap.teams) {
      const mine = Math.max(0, myTeam);
      body = [mine, 1 - mine].map((t) => `
        <table class="t${t}"><caption style="color:${css(t)}">${isAlly(t) ? 'TON ÉQUIPE' : 'ADVERSAIRES'} — ${snap.sc[t]}</caption>
        ${head}${rows.filter((r) => r[2] === t).map(line).join('')}</table>`).join('');
    } else {
      body = `<table>${head}${rows.map(line).join('')}</table>`;
    }
    let title = MODE_LABELS[snap.mode];
    let foot = 'Tab : tableau des scores';
    if (snap.st === 'inter') {
      const w = snap.win;
      title = !w || w.draw ? 'Égalité !'
        : w.team != null ? (isAlly(w.team) ? `<span style="color:${ALLY_CSS}">Victoire de ton équipe !</span>` : `<span style="color:${FOE_CSS}">Les adversaires l'emportent</span>`)
          : `${esc(w.name)} remporte la manche`;
      foot = `Prochaine manche : <b>${MODE_LABELS[snap.next] ?? ''}</b> dans ${snap.left} s`;
    }
    boardEl.innerHTML = `<h3>${title}</h3><div class="arena-tables">${body}</div><p>${foot}</p>`;
  }

  // --- Équipes, noms, arme imposée -------------------------------------------------
  function applyTeams() {
    const myId = getMyId();
    myTeam = snap.b.find((r) => r[0] === myId)?.[2] ?? -1;
    for (const [id, , team] of snap.b) {
      if (id === myId) continue;
      const foe = !snap.teams || team !== myTeam;
      // drone-pigeon (série de 3) : les noms des ennemis s'affichent — et on
      // les voit à travers les murs — pendant 12 s
      remotes.setTeam(id, foe ? 0 : 1, foe && performance.now() > revealUntil); // 0 = rouge (ennemi), 1 = bleu (allié)
    }
  }
  function applyLoadout() {
    const want = ctx.inHiFi && snap ? snap.mode : null;
    if (want === loadoutMode) return;
    loadoutMode = want;
    if (want === 'sniper') weapon.setLoadout(['sniper']);
    else if (want === 'couteau') weapon.setLoadout(['couteau']);
    else weapon.setLoadout(null);
  }

  // --- Drapeaux (capture) ---------------------------------------------------------
  const flags = BASES.map((b, t) => {
    const color = 0xffffff;
    const base = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.5, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    base.rotation.x = -Math.PI / 2;
    base.position.set(OX + b.x, 0.09, b.z);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 6), new THREE.MeshLambertMaterial({ color: 0xd9d9d9 }));
    pole.position.y = 1.6;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8, 6, 1), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    cloth.position.set(0.67, 2.75, 0);
    g.add(pole, cloth);
    g.position.copy(base.position);
    for (const o of [base, pole, cloth]) o.userData.noShadow = true;
    base.visible = g.visible = false;
    ctx.scene.add(base, g);
    return { base, g, cloth, target: new THREE.Vector3().copy(base.position) };
  });
  function updateFlags(dt) {
    const on = Boolean(ctx.inHiFi && snap?.f);
    const t = performance.now() / 1000;
    flags.forEach((fl, i) => {
      fl.base.visible = fl.g.visible = on;
      if (!on) return;
      const hex = isAlly(i) ? 0x2f76f0 : 0xe23a2e; // le sien en bleu, l'autre en rouge
      fl.base.material.color.setHex(hex);
      fl.cloth.material.color.setHex(hex);
      const [st, x, z, by] = snap.f[i];
      let y = 0.05;
      if (st === 1 && by) {
        // porté : suit le porteur image par image (sur son dos)
        const p = by === getMyId() ? controls.position : remotes.getPos(by);
        if (p) { fl.target.set(p.x, p.y + 0.15, p.z); y = null; }
      }
      if (y != null) fl.target.set(OX + x, y, z);
      fl.g.position.lerp(fl.target, Math.min(1, dt * 14));
      // l'étoffe ondule (6 colonnes de sommets)
      const pos = fl.cloth.geometry.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const u = (pos.getX(k) + 0.65) / 1.3;
        pos.setZ(k, Math.sin(t * 5 + u * 5 + i) * 0.12 * u);
      }
      pos.needsUpdate = true;
      fl.g.rotation.y = Math.sin(t * 0.7 + i) * 0.25;
    });
  }

  // --- Zone à tenir : cercle au sol + voile lumineux, à la couleur de qui la tient ---
  const zoneMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3.2, 40, 1, true), zoneMat);
  const zoneRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
  }));
  zoneRing.rotation.x = -Math.PI / 2;
  for (const o of [zoneWall, zoneRing]) { o.visible = false; o.userData.noShadow = true; ctx.scene.add(o); }
  function updateZone() {
    const on = Boolean(ctx.inHiFi && snap?.z && snap.st === 'play');
    zoneWall.visible = zoneRing.visible = on;
    if (!on) return;
    const [x, z, r, owner] = snap.z;
    zoneWall.position.set(OX + x, 1.65, z);
    zoneWall.scale.set(r, 1, r);
    zoneRing.position.set(OX + x, 0.1, z);
    zoneRing.scale.set(r, r, 1);
    const hex = owner === 2 ? 0xf0b648 : owner < 0 ? 0xffffff : isAlly(owner) ? 0x2f76f0 : 0xe23a2e;
    zoneMat.color.setHex(hex);
    zoneRing.material.color.setHex(hex);
    zoneMat.opacity = 0.16 + 0.06 * Math.sin(performance.now() / 300);
  }

  // --- Rosettes de soin : caisse blanche à croix verte qui tourne, halo additif ---
  const medGeo = new THREE.BoxGeometry(0.62, 0.42, 0.42);
  const medMat = new THREE.MeshLambertMaterial({ color: 0xf2f0e8 });
  const crossMat = new THREE.MeshBasicMaterial({ color: 0x35d06a });
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x35d06a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const meds = MEDS.map(([x, z]) => {
    const g = new THREE.Group();
    g.name = 'rosette';
    const caisse = new THREE.Mesh(medGeo, medMat);
    g.add(caisse);
    for (const [w, h] of [[0.3, 0.1], [0.1, 0.3]]) {
      for (const sz of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.PlaneGeometry(w, h), crossMat);
        c.position.z = sz * 0.212;
        if (sz < 0) c.rotation.y = Math.PI;
        g.add(c);
      }
    }
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 24), haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(OX + x, 0.09, z);
    halo.userData.noShadow = true;
    g.position.set(OX + x, 0.75, z);
    g.visible = halo.visible = false;
    ctx.scene.add(g, halo);
    return { g, halo, gone: 0 };
  });
  function updateMeds(now) {
    const on = Boolean(ctx.inHiFi && snap?.m && snap.st === 'play');
    meds.forEach((m, i) => {
      // `gone` : ramassage annoncé à l'instant, sans attendre l'instantané (1/s)
      const vis = on && snap.m[i] === 1 && now > m.gone;
      m.g.visible = m.halo.visible = vis;
      if (!vis) return;
      m.g.rotation.y = now / 700 + i;
      m.g.position.y = 0.75 + 0.08 * Math.sin(now / 420 + i);
    });
    haloMat.opacity = 0.28 + 0.12 * Math.sin(now / 300);
  }

  // --- Bases au sol : bleu = la tienne, rouge = celle d'en face (modes par équipes) ---
  const baseMats = BASES.map(() => new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  const basePads = BASES.map((b, i) => {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(13, 34), baseMats[i]);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(OX + b.x, 0.07, b.z);
    pad.visible = false;
    pad.userData.noShadow = true;
    ctx.scene.add(pad);
    return pad;
  });
  function updateBases() {
    const on = Boolean(ctx.inHiFi && snap?.teams && myTeam >= 0);
    basePads.forEach((pad, i) => {
      pad.visible = on;
      if (on) baseMats[i].color.setHex(isAlly(i) ? 0x2f76f0 : 0xe23a2e);
    });
  }

  // --- Tableau des meilleurs, au-dessus du portail ---------------------------------
  const lbCanvas = document.createElement('canvas');
  lbCanvas.width = 1024; lbCanvas.height = 512;
  const lbTex = new THREE.CanvasTexture(lbCanvas);
  lbTex.colorSpace = THREE.SRGBColorSpace;
  lbTex.anisotropy = 4;
  {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ map: lbTex }));
    board.position.set(OX + PORTAL.x, 8.6, PORTAL.z + 0.3);
    board.rotation.y = Math.PI; // face à la place
    const frame = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.4, 0.2), new THREE.MeshLambertMaterial({ color: 0x1d2025 }));
    frame.position.set(OX + PORTAL.x, 8.6, PORTAL.z + 0.42);
    const legs = [-3.6, 3.6].map((dx) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 6.4, 8), new THREE.MeshLambertMaterial({ color: 0x3a3f47 }));
      leg.position.set(OX + PORTAL.x + dx, 3.2, PORTAL.z + 0.45);
      return leg;
    });
    board.userData.noShadow = true;
    ctx.scene.add(board, frame, ...legs);
  }
  function drawTop() {
    const g = lbCanvas.getContext('2d');
    const W = lbCanvas.width, H = lbCanvas.height;
    g.fillStyle = '#0c0e11';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#f0b648';
    g.fillRect(0, 0, W, 10);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = '700 34px "Arial Narrow", Arial, sans-serif';
    g.fillStyle = 'rgba(238,241,238,0.65)';
    g.fillText('LES MEILLEURS GONES', 36, 48);
    g.font = '900 70px "Arial Narrow", Arial, sans-serif';
    g.fillStyle = '#f0b648';
    g.fillText((MODE_LABELS[top.mode] ?? '').toUpperCase(), 34, 116, W - 68);
    g.fillStyle = 'rgba(238,241,238,0.25)';
    g.fillRect(36, 160, W - 72, 3);
    const rows = top.rows.slice(0, 5);
    if (!rows.length) {
      g.font = '700 54px "Arial Narrow", Arial, sans-serif';
      g.fillStyle = 'rgba(238,241,238,0.8)';
      g.fillText('La place est à prendre !', 36, 300);
    }
    rows.forEach(([name, score], i) => {
      const y = 204 + i * 62;
      g.font = '900 54px "Arial Narrow", Arial, sans-serif';
      g.fillStyle = i === 0 ? '#f0b648' : 'rgba(238,241,238,0.5)';
      g.textAlign = 'left';
      g.fillText(String(i + 1), 40, y);
      g.fillStyle = i === 0 ? '#ffffff' : '#dfe3df';
      g.fillText(String(name).slice(0, 16), 110, y);
      g.textAlign = 'right';
      g.fillStyle = '#f0b648';
      g.fillText(String(score), W - 44, y);
    });
    lbTex.needsUpdate = true;
  }
  drawTop();

  // --- Console de match --------------------------------------------------------------
  const overlay = document.createElement('div');
  overlay.className = 'overlay hidden';
  overlay.id = 'arena-console';
  document.body.appendChild(overlay);
  const form = { mode: 'ffa', bots: 4, diff: 1, chain: 'rotation' };
  function renderConsole() {
    const opt = (key, value, label) =>
      `<button type="button" class="${form[key] === value ? 'on' : ''}" data-k="${key}" data-v="${value}">${label}</button>`;
    overlay.innerHTML = `
      <div class="panel" id="arena-console-panel">
        <h2>🎮 Console de match</h2>
        <p class="sub">Les réglages valent pour tous les gones de l'arène. Un joueur qui arrive prend la place d'un bot.</p>
        <label>Mode de jeu</label>
        <div class="arena-opts">${Object.entries(MODE_LABELS).map(([k, l]) => opt('mode', k, l)).join('')}</div>
        <label>Bots : <b>${form.bots}</b></label>
        <input type="range" min="1" max="10" step="1" value="${form.bots}" id="arena-bots">
        <label>Difficulté</label>
        <div class="arena-opts">${DIFF_LABELS.map((l, i) => opt('diff', i, l)).join('')}</div>
        <label>Fin de manche</label>
        <div class="arena-opts">
          ${opt('chain', 'rotation', 'Enchaîner les modes')}${opt('chain', 'meme', 'Rejouer le même mode')}
        </div>
        <div class="arena-actions">
          <button type="button" id="arena-go">▶ Lancer maintenant</button>
          <button type="button" class="ghost" id="arena-next">Appliquer à la prochaine manche</button>
          <button type="button" class="ghost" id="arena-close">Fermer</button>
        </div>
      </div>`;
    overlay.querySelectorAll('[data-k]').forEach((btn) => {
      btn.onclick = () => {
        const k = btn.dataset.k;
        form[k] = k === 'diff' ? Number(btn.dataset.v) : btn.dataset.v;
        renderConsole();
      };
    });
    overlay.querySelector('#arena-bots').oninput = (e) => {
      form.bots = Number(e.target.value);
      e.target.previousElementSibling.querySelector('b').textContent = form.bots;
    };
    overlay.querySelector('#arena-go').onclick = () => { net.send({ t: 'arenaCfg', ...form, go: 1 }); toggleConsole(false); };
    overlay.querySelector('#arena-next').onclick = () => {
      net.send({ t: 'arenaCfg', ...form });
      ui.toast(`🎮 Prochaine manche : ${MODE_LABELS[form.mode]} · ${form.bots} bot(s) · ${DIFF_LABELS[form.diff]}`);
      toggleConsole(false);
    };
    overlay.querySelector('#arena-close').onclick = () => toggleConsole(false);
  }
  function toggleConsole(show) {
    if (show) {
      if (snap?.cfg) Object.assign(form, { mode: snap.cfg.next ?? snap.mode, bots: snap.cfg.bots, diff: snap.cfg.diff, chain: snap.cfg.chain });
      renderConsole();
      overlay.classList.remove('hidden');
      state.overlayOpen = true;
      document.exitPointerLock?.();
    } else if (!overlay.classList.contains('hidden')) {
      overlay.classList.add('hidden');
      state.overlayOpen = false;
    }
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) toggleConsole(false); });
  ctx.interactables.push({
    x: OX + CONSOLE.x, z: CONSOLE.z, r: 2.6,
    label: '🎮 E — Console de match (mode, bots, difficulté)',
    action: () => toggleConsole(true),
  });

  // --- Tableau des scores : Tab maintenu (ou toucher le bandeau sur mobile) --------
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') toggleConsole(false);
    if (e.code !== 'Tab' || !ctx.inHiFi) return;
    e.preventDefault();
    if (!boardHeld) { boardHeld = true; renderBoard(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Tab') return;
    boardHeld = false;
    renderBoard();
  });
  root.querySelector('#arena-hud').addEventListener('click', () => { boardHeld = !boardHeld; renderBoard(); });

  // --- Réseau ---------------------------------------------------------------------------
  net.on('arena', (msg) => {
    const first = !snap || snap.mode !== msg.mode || (snap.st === 'inter' && msg.st === 'play');
    const ended = snap?.st === 'play' && msg.st === 'inter';
    snap = msg;
    applyTeams();
    applyLoadout();
    renderHud();
    renderBoard();
    if (first && msg.st === 'play' && ctx.inHiFi) {
      banner(`<small>${esc(MODE_GOALS[msg.mode])}</small>${esc(MODE_LABELS[msg.mode])}<small>premier à ${msg.lim}</small>`, 3200);
      audio?.announce?.(MODE_LABELS[msg.mode]);
    }
    if (ended) audio?.reward?.();
  });
  net.on('arenaTop', (msg) => { top = msg; drawTop(); });
  net.on('arenaSpawn', (msg) => {
    if (!ctx.inHiFi) return;
    ctx.stopKillcam?.(); // nouvelle manche : le rejeu s'efface
    controls.teleport(msg.p[0], msg.p[1], msg.p[2], msg.ry);
    ui.setHp(100);
  });
  net.on('akill', (msg) => {
    if (!ctx.inHiFi) return;
    if (msg.tk) {
      feed(`🤡 ${nameHtml(msg.byName, msg.bt)} a descendu son collègue ${nameHtml(msg.vName, msg.vt)}`);
      return;
    }
    const who = msg.by ? `${nameHtml(msg.byName, msg.bt)} <i>${WPN_ICON[msg.w] ?? '☠'}</i> ` : '<i>🥖</i> ';
    feed(who + nameHtml(msg.vName, msg.vt));
  });
  net.on('aevt', (msg) => {
    if (!ctx.inHiFi) return;
    const whose = msg.team != null
      ? (isAlly(msg.team) ? `<b style="color:${ALLY_CSS}">TON drapeau</b>` : `<b style="color:${FOE_CSS}">le drapeau ennemi</b>`)
      : '';
    if (msg.k === 'take') feed(`⚑ ${esc(msg.name)} a pris ${whose}`);
    else if (msg.k === 'drop') feed(`⚐ ${whose} est à terre`);
    else if (msg.k === 'back') feed(`↩ ${whose} est rentré à la base`);
    else if (msg.k === 'cap') {
      banner(`<small>${esc(msg.name)}</small>Drapeau capturé<small>${isAlly(msg.team) ? 'point pour ton équipe' : 'point pour les adversaires'}</small>`);
      audio?.reward?.();
    } else if (msg.k === 'zone') {
      feed('◎ La zone se déplace !');
    } else if (msg.k === 'med') {
      if (meds[msg.i]) meds[msg.i].gone = performance.now() + 1500;
      if (msg.id === getMyId()) {
        feed('🥓 Rosette avalée : +50 PV');
        audio?.reward?.();
      }
    } else if (msg.k === 'streak') {
      // SÉRIES D'ÉLIMINATIONS : 3 = drone-pigeon, 5 = frappe de quenelles, 7 = armure de canut
      const mine = msg.id === getMyId();
      const what = { 3: ['🕊️', 'Drone-pigeon', 'ennemis repérés pendant 12 s'], 5: ['🥖', 'Frappe de quenelles', 'ça tombe sur les adversaires'], 7: ['🛡', 'Armure de canut', '100 points d\'armure'] }[msg.n];
      if (!what) return;
      feed(`${what[0]} ${esc(msg.name)} : ${what[1].toLowerCase()} (${msg.n} d'affilée)`);
      if (mine) {
        banner(`<small>${msg.n} éliminations d'affilée</small>${what[0]} ${what[1]}<small>${what[2]}</small>`, 3200);
        audio?.announce?.(what[1]);
        if (msg.n === 3) {
          revealUntil = performance.now() + 12000;
          if (snap) applyTeams();
          setTimeout(() => { if (snap) applyTeams(); }, 12100);
        }
      } else if (msg.n === 5) {
        banner('<small>frappe de quenelles en approche</small>À couvert !<small>fuis les cercles rouges</small>', 2600);
      }
    } else if (msg.k === 'tk') {
      // tir ami : la quenelle du karma s'abat sur le traître
      if (msg.id === getMyId()) {
        banner('<small>on ne tire pas sur les collègues, gone !</small>Quenelle du karma<small>−50 PV · −1 élimination</small>', 3200);
        audio?.announce?.('Traître !');
        ui.damageFlash(true);
      }
    } else if (msg.k === 'cfg') feed(`🎮 ${esc(msg.name)} a relancé la partie`);
  });

  // --- Boucle : visibilité selon qu'on est dans l'arène ou non ----------------------
  let wasIn = false;
  ctx.updatables.push((dt) => {
    const inside = Boolean(ctx.inHiFi);
    if (inside !== wasIn) {
      wasIn = inside;
      root.classList.toggle('hidden', !inside);
      document.body.classList.toggle('in-arena', inside);
      if (!inside) {
        snap = null;
        boardHeld = false;
        feedEl.innerHTML = '';
        boardEl.classList.add('hidden');
        toggleConsole(false);
        remotes.resetTeams();
        applyLoadout();
      } else {
        modeEl.textContent = 'Arène de Bellecour';
        scoreEl.textContent = '';
        subEl.textContent = 'la partie démarre…';
      }
    }
    updateFlags(dt);
    updateZone();
    updateMeds(performance.now());
    updateBases();
  });

  return { get snap() { return snap; }, openConsole: () => toggleConsole(true) };
}
