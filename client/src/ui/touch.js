import { state } from '../state.js';

// Contrôles tactiles : joystick gauche (déplacement), glisser à droite (regard),
// boutons d'action. Activé uniquement sur écran tactile.
export function createTouchControls({ controls, weapon, spray, tagEditor, ui, voice, capture, emote, jetpack, interact, map, radio }) {
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
    <div class="touch-top" id="touch-top">
      <button class="tbtn tbtn-small" id="tb-menu">☰</button>
      <div id="touch-menu" class="hidden">
        <button class="tbtn tbtn-small" id="tb-gun">🔫</button>
        <button class="tbtn tbtn-small" id="tb-tag">🎨</button>
        <button class="tbtn tbtn-small" id="tb-color">🌈</button>
        <button class="tbtn tbtn-small" id="tb-chat">💬</button>
        <button class="tbtn tbtn-small" id="tb-mic">🎤</button>
        <button class="tbtn tbtn-small" id="tb-photo">📸</button>
        <button class="tbtn tbtn-small" id="tb-jet">🚀</button>
        <button class="tbtn tbtn-small" id="tb-map">🗺️</button>
        <button class="tbtn tbtn-small" id="tb-arme">🔁</button>
        <button class="tbtn tbtn-small" id="tb-radio">📻</button>
        <button class="tbtn tbtn-small" id="tb-lb">🏆</button>
        <button class="tbtn tbtn-small" id="tb-fs">⛶</button>
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
      // Comme un vrai manche : tirer vers soi (bas) fait cabrer.
      planeAxes.pitch = -dy / JOY_R;
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
    root.classList.toggle('plane-mode', isPlane);
    root.classList.toggle('jet-mode', Boolean(controls.vehicle?.jet));
    if (wasPlane && !isPlane) {
      resetPlaneStick('left');
      resetPlaneStick('right');
    }
    wasPlane = isPlane;
    if (isPlane) {
      const f = controls.flightTelemetry;
      if (f) {
        planeInstruments.textContent =
          `GAZ ${Math.round(f.throttle * 100)}% · ${Math.round(f.speed * 3.6)} km/h · ALT ${Math.round(f.altitude)} m`;
      }
    }
    requestAnimationFrame(syncPlaneUi);
  }
  syncPlaneUi();

  // Boutons
  const bind = (id, onDown, onUp) => {
    const el = root.querySelector(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); }, { passive: false });
    if (onUp) {
      el.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); }, { passive: false });
      el.addEventListener('touchcancel', () => onUp(), { passive: true });
    }
  };

  // Menu ☰ : replie/déplie la rangée de boutons du haut (dégage la vue)
  const menu = root.querySelector('#touch-menu');
  bind('#tb-menu', () => menu.classList.toggle('hidden'));

  let emoteIdx = 0;
  bind('#tb-emote', () => emote?.(emoteIdx++ % 3)); // fait défiler les emotes
  bind('#tb-jet', () => jetpack?.());
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
  bind('#tb-color', () => spray.cycleColor(1));
  bind('#tb-gun', () => weapon.toggle());
  bind('#tb-map', () => map?.());
  bind('#tb-arme', () => weapon.cycle()); // change d'arme (celles ramassées)
  bind('#tb-radio', () => radio?.()); // enceinte portable (morceau suivant)
  bind('#tb-tag', () => tagEditor.open());
  bind('#tb-chat', () => ui.openChat());
  bind('#tb-mic', () => voice?.toggleMic());
  bind('#tb-photo', () => capture?.toggleMode()); // mode photo : zoom + 📸
  bind('#tb-lb', () => ui.toggleLeaderboards());
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
}
