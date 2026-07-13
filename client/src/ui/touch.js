import { state } from '../state.js';

// Contrôles tactiles : joystick gauche (déplacement), glisser à droite (regard),
// boutons d'action. Activé uniquement sur écran tactile.
export function createTouchControls({
  controls, weapon, spray, tagEditor, ui, voice, capture, emote,
  jetpack, rcPlane, interact, map, radio, invite, quality,
}) {
  const root = document.createElement('div');
  root.id = 'touch-ui';
  root.innerHTML = `
    <div id="joy-base"><div id="joy-knob"></div></div>
    <div class="plane-stick" id="plane-stick-left">
      <span class="plane-stick-label plane-stick-top">GAZ +</span>
      <span class="plane-stick-label plane-stick-bottom">GAZ −</span>
      <span class="plane-stick-label plane-stick-left-label">LACET</span>
      <div class="plane-stick-knob"></div>
    </div>
    <div class="plane-stick" id="plane-stick-right">
      <span class="plane-stick-label plane-stick-top">PIQUÉ</span>
      <span class="plane-stick-label plane-stick-bottom">CABRÉ</span>
      <span class="plane-stick-label plane-stick-right-label">ROULIS</span>
      <div class="plane-stick-knob"></div>
    </div>
    <div id="plane-instruments">GAZ 0% · 0 km/h · ALT 0 m</div>
    <button class="tbtn tbtn-fire plane-fire plane-fire-left" id="tb-fire-left">TIR</button>
    <button class="tbtn plane-bomb" id="tb-bomb">BOMBE</button>
    <button class="tbtn plane-exit" id="tb-exit-plane">SAUTER</button>
    <button class="tbtn plane-camera" id="tb-camera">CAM</button>
    <div class="touch-top" id="touch-top">
      <button class="tbtn tbtn-small" id="tb-menu">☰</button>
      <div id="touch-menu" class="hidden">
        <div class="touch-menu-shell">
          <header class="touch-menu-head">
            <div><strong>LYON ARCADE</strong><span id="menu-player"></span></div>
            <button id="tb-menu-close" aria-label="Fermer le menu">×</button>
          </header>
          <nav class="touch-menu-tabs" aria-label="Pages du menu">
            <button class="menu-tab active" data-menu-tab="inventory">INVENTAIRE</button>
            <button class="menu-tab" data-menu-tab="actions">ACTIONS</button>
            <button class="menu-tab" data-menu-tab="settings">RÉGLAGES</button>
          </nav>
          <div class="touch-menu-content">
            <section class="menu-page" data-menu-page="inventory">
              <div class="menu-page-title"><strong>ÉQUIPEMENT TROUVÉ</strong><span>Choisis un objet pour l’utiliser</span></div>
              <div id="menu-inventory" class="inventory-grid"></div>
            </section>
            <section class="menu-page hidden" data-menu-page="actions">
              <div class="menu-page-title"><strong>ACTIONS RAPIDES</strong><span>Les outils de ton téléphone</span></div>
              <div class="menu-action-grid">
                <button id="tb-map"><b>🗺️</b><span>Carte</span></button>
                <button id="tb-chat"><b>💬</b><span>Chat</span></button>
                <button id="tb-photo"><b>📸</b><span>Photo</span></button>
                <button id="tb-tag"><b>🎨</b><span>Créer un tag</span></button>
                <button id="tb-color"><b>🌈</b><span>Couleur spray</span></button>
                <button id="tb-radio"><b>📻</b><span>Radio</span></button>
                <button id="tb-gun"><b>🔫</b><span>Arme en main</span></button>
                <button id="tb-arme"><b>🔁</b><span>Arme suivante</span></button>
                <button id="tb-lb"><b>🏆</b><span>Classements</span></button>
              </div>
            </section>
            <section class="menu-page hidden" data-menu-page="settings">
              <div class="menu-page-title"><strong>RÉGLAGES</strong><span>Son, amis et affichage</span></div>
              <div class="settings-list">
                <div class="setting-row">
                  <div><b>🎤 Micro de proximité</b><small>Les joueurs proches peuvent t’entendre</small></div>
                  <button id="tb-mic">ACTIVER</button>
                </div>
                <div class="setting-row">
                  <div><b>👥 Inviter des amis</b><small>Partage un lien qui les fait apparaître près de toi</small></div>
                  <button id="tb-invite">PARTAGER</button>
                </div>
                <div class="setting-row setting-resolution">
                  <div><b>🖥️ Résolution</b><small>Plus bas = plus fluide, plus haut = plus net</small></div>
                  <div class="quality-choices">
                    <button data-quality="bas">BAS</button>
                    <button data-quality="moyen">MOYEN</button>
                    <button data-quality="eleve">ÉLEVÉ</button>
                  </div>
                </div>
                <div class="setting-row">
                  <div><b>⛶ Plein écran</b><small>Verrouille aussi l’affichage en paysage</small></div>
                  <button id="tb-fs">BASCULER</button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
    <div class="touch-actions" id="touch-actions">
      <button class="tbtn" id="tb-emote">😜</button>
      <button class="tbtn" id="tb-stamp">🖼</button>
      <button class="tbtn" id="tb-spray">TAG</button>
      <button class="tbtn" id="tb-use">E</button>
      <button class="tbtn" id="tb-jump">SAUT</button>
      <button class="tbtn tbtn-fire" id="tb-fire">TIR</button>
    </div>`;
  document.body.appendChild(root);

  const joyBase = root.querySelector('#joy-base');
  const joyKnob = root.querySelector('#joy-knob');
  const JOY_R = 55;
  const planeLeft = root.querySelector('#plane-stick-left');
  const planeRight = root.querySelector('#plane-stick-right');
  const planeLeftKnob = planeLeft.querySelector('.plane-stick-knob');
  const planeRightKnob = planeRight.querySelector('.plane-stick-knob');
  const planeInstruments = root.querySelector('#plane-instruments');

  let joyTouchId = null;
  let joyOrigin = null;
  let lookTouchId = null;
  let lookLast = null;
  // Le doigt posé sur TIR sert aussi à viser : glisser tout en tirant
  let fireTouchId = null;
  let fireLast = null;
  let planeLeftId = null;
  let planeRightId = null;
  const planeAxes = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };

  function planeMode() { return Boolean(controls.vehicle?.plane); }

  function stickOrigin(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function movePlaneStick(t, el, knob, side) {
    const o = stickOrigin(el);
    let dx = t.clientX - o.x, dy = t.clientY - o.y;
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (side === 'left') {
      planeAxes.throttle = -dy / JOY_R;
      planeAxes.yaw = dx / JOY_R;
    } else {
      // Sur l'écran, dy est positif vers le bas. Le moteur Three.js utilise
      // un tangage positif pour lever le nez : tirer le manche vers soi
      // (vers CABRÉ) doit donc envoyer une valeur positive, sans inversion.
      planeAxes.pitch = dy / JOY_R;
      planeAxes.roll = dx / JOY_R;
    }
    controls.setTouchPlane(planeAxes.throttle, planeAxes.yaw, planeAxes.pitch, planeAxes.roll);
  }

  function resetPlaneStick(side) {
    if (side === 'left') {
      planeLeftId = null;
      planeAxes.throttle = planeAxes.yaw = 0;
      planeLeftKnob.style.transform = 'translate(0px, 0px)';
    } else {
      planeRightId = null;
      planeAxes.pitch = planeAxes.roll = 0;
      planeRightKnob.style.transform = 'translate(0px, 0px)';
    }
    controls.setTouchPlane(planeAxes.throttle, planeAxes.yaw, planeAxes.pitch, planeAxes.roll);
  }

  function isButton(target) {
    return target.closest?.('.tbtn');
  }

  document.addEventListener('touchstart', (e) => {
    if (state.overlayOpen) return;
    for (const t of e.changedTouches) {
      if (isButton(t.target)) continue;
      if (planeMode()) {
        if (t.clientX < window.innerWidth / 2 && planeLeftId === null) {
          planeLeftId = t.identifier;
          movePlaneStick(t, planeLeft, planeLeftKnob, 'left');
        } else if (planeRightId === null) {
          planeRightId = t.identifier;
          movePlaneStick(t, planeRight, planeRightKnob, 'right');
        }
        continue;
      }
      if (t.clientX < window.innerWidth * 0.45 && joyTouchId === null) {
        joyTouchId = t.identifier;
        joyOrigin = { x: t.clientX, y: t.clientY };
        joyBase.style.left = `${t.clientX - 65}px`;
        joyBase.style.top = `${t.clientY - 65}px`;
        joyBase.style.display = 'block';
        joyKnob.style.transform = 'translate(0px, 0px)';
      } else if (lookTouchId === null) {
        lookTouchId = t.identifier;
        lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === planeLeftId) {
        movePlaneStick(t, planeLeft, planeLeftKnob, 'left');
      } else if (t.identifier === planeRightId) {
        movePlaneStick(t, planeRight, planeRightKnob, 'right');
      } else if (t.identifier === joyTouchId && joyOrigin) {
        let dx = t.clientX - joyOrigin.x;
        let dy = t.clientY - joyOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > JOY_R) {
          dx = (dx / len) * JOY_R;
          dy = (dy / len) * JOY_R;
        }
        joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        controls.setTouchMove(-dy / JOY_R, dx / JOY_R);
      } else if (t.identifier === lookTouchId && lookLast) {
        controls.addLook((t.clientX - lookLast.x) * 2.4, (t.clientY - lookLast.y) * 2.4);
        lookLast = { x: t.clientX, y: t.clientY };
      } else if (t.identifier === fireTouchId && fireLast) {
        // Visée pendant le tir : le glisser du pouce déplace la caméra
        if (!planeMode()) {
          controls.addLook((t.clientX - fireLast.x) * 2.4, (t.clientY - fireLast.y) * 2.4);
        }
        fireLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: true });

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === planeLeftId) resetPlaneStick('left');
      if (t.identifier === planeRightId) resetPlaneStick('right');
      if (t.identifier === joyTouchId) {
        joyTouchId = null;
        joyOrigin = null;
        joyBase.style.display = 'none';
        controls.setTouchMove(0, 0);
      }
      if (t.identifier === lookTouchId) {
        lookTouchId = null;
        lookLast = null;
      }
    }
  }
  document.addEventListener('touchend', endTouch, { passive: true });
  document.addEventListener('touchcancel', endTouch, { passive: true });

  // Le cockpit tactile apparaît/disparaît automatiquement à l'entrée/sortie
  // de l'avion. Dans ce mode, tous les gros boutons d'action sauf TIR sont
  // masqués pour libérer les deux pouces.
  let wasPlane = false;
  function syncPlaneUi() {
    const isPlane = planeMode();
    const isJet = Boolean(controls.vehicle?.jet);
    const isRc = Boolean(controls.vehicle?.rcPlane);
    root.classList.toggle('plane-mode', isPlane);
    root.classList.toggle('jet-mode', isJet);
    root.classList.toggle('rc-mode', isRc);
    // Le grand prompt HUD est remplacé par le petit bouton SAUTER du cockpit.
    document.body.classList.toggle('aircraft-touch-mode', isPlane);
    if (wasPlane && !isPlane) {
      resetPlaneStick('left');
      resetPlaneStick('right');
    }
    wasPlane = isPlane;
    if (isPlane) {
      const f = controls.flightTelemetry;
      if (f) {
        const cameraMode = isRc ? ` · ${controls.vehicle?.thirdPerson ? 'POURSUITE' : 'FPV'}` : '';
        planeInstruments.textContent =
          `GAZ ${Math.round(f.throttle * 100)}% · ${Math.round(f.speed * 3.6)} km/h · ALT ${Math.round(f.altitude)} m${cameraMode}`;
      }
    }
    requestAnimationFrame(syncPlaneUi);
  }
  syncPlaneUi();

  // Boutons
  const bind = (id, onDown, onUp) => {
    const el = root.querySelector(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); }, { passive: false });
    if (onUp) {
      el.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); }, { passive: false });
      el.addEventListener('touchcancel', () => onUp(), { passive: true });
    }
  };

  // Menu ☰ : panneau semi-transparent à pages. Tant qu'il est ouvert, les
  // gestes de pilotage sont bloqués par state.overlayOpen.
  const menu = root.querySelector('#touch-menu');
  const inventoryGrid = root.querySelector('#menu-inventory');

  function renderInventory() {
    const specialItems = [
      {
        id: 'jetpack', emoji: '🚀', title: 'Jetpack',
        found: state.hasJetpack, active: controls.flying,
        hint: 'À trouver à la pointe de la Confluence',
        action: controls.flying ? 'RANGER' : 'UTILISER',
      },
      {
        id: 'rc-plane', emoji: '📡', title: 'Avion RC',
        found: state.hasRcPlane, active: Boolean(controls.vehicle?.rcPlane),
        hint: 'À trouver sur le tarmac de l’aéroport',
        action: controls.vehicle?.rcPlane ? 'RANGER' : 'PILOTER',
      },
      {
        id: 'radio', emoji: '📻', title: 'Radio portable',
        found: state.hasRadio, active: state.boombox > 0,
        hint: 'À récupérer devant la salle d’arcade',
        action: state.boombox > 0 ? 'CHANGER' : 'UTILISER',
      },
    ];
    const weapons = weapon.inventory.map((item) => ({
      id: `weapon:${item.id}`, emoji: item.emoji, title: item.nom,
      found: true, active: item.equipped,
      hint: item.id === 'ak' ? 'Équipement de départ' : 'Ramassée dans la ville',
      action: item.equipped ? 'ÉQUIPÉE' : 'ÉQUIPER',
    }));
    inventoryGrid.innerHTML = [...specialItems, ...weapons].map((item) => `
      <article class="inventory-card${item.found ? '' : ' locked'}${item.active ? ' active' : ''}">
        <span class="inventory-icon">${item.found ? item.emoji : '🔒'}</span>
        <div class="inventory-copy">
          <b>${item.title}</b>
          <small>${item.active ? 'En cours d’utilisation' : item.hint}</small>
        </div>
        ${item.found
          ? `<button data-inventory-action="${item.id}">${item.action}</button>`
          : '<span class="inventory-locked">NON TROUVÉ</span>'}
      </article>
    `).join('');
  }

  function renderSettings() {
    root.querySelector('#menu-player').textContent = state.auth?.name ? `JOUEUR · ${state.auth.name}` : '';
    const mic = root.querySelector('#tb-mic');
    const micOn = Boolean(voice?.isOn?.());
    mic.textContent = micOn ? 'COUPER' : 'ACTIVER';
    mic.classList.toggle('active', micOn);
    for (const btn of root.querySelectorAll('[data-quality]')) {
      btn.classList.toggle('active', btn.dataset.quality === quality?.level);
    }
  }

  function showMenuPage(name) {
    for (const tab of root.querySelectorAll('[data-menu-tab]')) {
      tab.classList.toggle('active', tab.dataset.menuTab === name);
    }
    for (const page of root.querySelectorAll('[data-menu-page]')) {
      page.classList.toggle('hidden', page.dataset.menuPage !== name);
    }
    if (name === 'inventory') renderInventory();
    if (name === 'settings') renderSettings();
  }

  function setMenuOpen(open) {
    if (open && state.overlayOpen) return;
    menu.classList.toggle('hidden', !open);
    state.overlayOpen = open;
    if (open) {
      document.exitPointerLock?.();
      showMenuPage('inventory');
      renderSettings();
    }
  }
  const closeMenu = () => setMenuOpen(false);
  const closeThen = (fn) => () => { closeMenu(); fn?.(); };

  bind('#tb-menu', () => setMenuOpen(true));
  bind('#tb-menu-close', closeMenu);
  menu.addEventListener('touchstart', (e) => {
    if (e.target === menu) { e.preventDefault(); closeMenu(); }
  }, { passive: false });
  for (const tab of root.querySelectorAll('[data-menu-tab]')) {
    tab.addEventListener('touchstart', (e) => {
      e.preventDefault();
      showMenuPage(tab.dataset.menuTab);
    }, { passive: false });
  }
  inventoryGrid.addEventListener('touchstart', (e) => {
    const button = e.target.closest?.('[data-inventory-action]');
    if (!button) return;
    e.preventDefault();
    const id = button.dataset.inventoryAction;
    closeMenu();
    if (id === 'jetpack') jetpack?.();
    else if (id === 'rc-plane') rcPlane?.();
    else if (id === 'radio') radio?.();
    else if (id.startsWith('weapon:')) weapon.equip(id.slice(7));
  }, { passive: false });

  let emoteIdx = 0;
  bind('#tb-emote', () => emote?.(emoteIdx++ % 3)); // fait défiler les emotes
  // SAUT : en vol (jetpack ou avion) le maintien = poussée, sinon saut simple
  bind('#tb-jump',
    () => {
      if (controls.flying || controls.vehicle?.plane) controls.setTouchThrust(true);
      else controls.jump();
    },
    () => controls.setTouchThrust(false));
  bind('#tb-use', () => interact());
  bind('#tb-spray', () => spray.toggleMode()); // mode bombe de peinture
  bind('#tb-stamp', () => spray.stampTag());
  bind('#tb-color', closeThen(() => spray.cycleColor(1)));
  bind('#tb-gun', closeThen(() => weapon.toggle()));
  bind('#tb-map', closeThen(() => map?.()));
  bind('#tb-arme', closeThen(() => weapon.cycle())); // change d'arme (celles ramassées)
  bind('#tb-radio', closeThen(() => radio?.())); // enceinte portable (morceau suivant)
  bind('#tb-tag', closeThen(() => tagEditor.open()));
  bind('#tb-chat', closeThen(() => ui.openChat()));
  bind('#tb-photo', closeThen(() => capture?.toggleMode())); // mode photo : zoom + 📸
  bind('#tb-lb', closeThen(() => ui.toggleLeaderboards()));
  bind('#tb-mic', () => {
    Promise.resolve(voice?.toggleMic()).finally(() => setTimeout(renderSettings, 50));
  });
  bind('#tb-invite', () => invite?.());
  for (const button of root.querySelectorAll('[data-quality]')) {
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      quality?.set(button.dataset.quality);
      renderSettings();
      ui.toast(`🖥️ Résolution : ${quality?.label}`);
    }, { passive: false });
  }
  bind('#tb-fs', () => {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el).catch(() => {});
      if (screen.orientation?.lock) screen.orientation.lock('landscape').catch(() => {});
    }
  });
  // À pied, TIR équipe l'arme si besoin. Dans un avion, les deux boutons
  // commandent uniquement les mitrailleuses de bord : aucune arme ni aucun
  // bras ne ressort devant la caméra.
  const fireButtons = [root.querySelector('#tb-fire'), root.querySelector('#tb-fire-left')];
  for (const fireBtn of fireButtons) fireBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    fireTouchId = t.identifier;
    fireLast = { x: t.clientX, y: t.clientY };
    if (planeMode()) {
      controls.setPlaneTrigger(true);
    } else if (state.tagMode) {
      spray.setPaint(true);
    } else {
      if (!state.weaponEquipped) weapon.toggle(true);
      weapon.setTrigger(true);
    }
  }, { passive: false });
  const fireEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== fireTouchId) continue;
      fireTouchId = null;
      fireLast = null;
      controls.setPlaneTrigger(false);
      spray.setPaint(false);
      weapon.setTrigger(false);
    }
  };
  for (const fireBtn of fireButtons) {
    fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); fireEnd(e); }, { passive: false });
    fireBtn.addEventListener('touchcancel', fireEnd, { passive: true });
  }
  bind('#tb-bomb', () => controls.dropPlaneBomb());
  bind('#tb-exit-plane', () => {
    if (controls.vehicle?.rcPlane) rcPlane?.();
    else interact();
  });
  bind('#tb-camera', () => {
    const thirdPerson = controls.togglePlaneCamera();
    ui.toast(thirdPerson ? '📷 Caméra poursuite' : '📷 Caméra embarquée');
  });
}
