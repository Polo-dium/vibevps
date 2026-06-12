import { state } from '../state.js';

// Contrôles tactiles : joystick gauche (déplacement), glisser à droite (regard),
// boutons d'action. Activé uniquement sur écran tactile.
export function createTouchControls({ controls, weapon, spray, tagEditor, ui, interact }) {
  const root = document.createElement('div');
  root.id = 'touch-ui';
  root.innerHTML = `
    <div id="joy-base"><div id="joy-knob"></div></div>
    <div class="touch-col" id="touch-actions">
      <button class="tbtn tbtn-small" id="tb-tag">🎨</button>
      <button class="tbtn tbtn-small" id="tb-lb">🏆</button>
      <button class="tbtn tbtn-small" id="tb-color">🌈</button>
      <button class="tbtn tbtn-small" id="tb-gun">🔫</button>
      <button class="tbtn" id="tb-spray">TAG</button>
      <button class="tbtn" id="tb-stamp">🖼</button>
      <button class="tbtn" id="tb-use">E</button>
      <button class="tbtn" id="tb-jump">SAUT</button>
      <button class="tbtn tbtn-fire" id="tb-fire">TIR</button>
    </div>`;
  document.body.appendChild(root);

  const joyBase = root.querySelector('#joy-base');
  const joyKnob = root.querySelector('#joy-knob');
  const JOY_R = 55;

  let joyTouchId = null;
  let joyOrigin = null;
  let lookTouchId = null;
  let lookLast = null;

  function isButton(target) {
    return target.closest?.('.tbtn');
  }

  document.addEventListener('touchstart', (e) => {
    if (state.overlayOpen) return;
    for (const t of e.changedTouches) {
      if (isButton(t.target)) continue;
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
      if (t.identifier === joyTouchId && joyOrigin) {
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
      }
    }
  }, { passive: true });

  function endTouch(e) {
    for (const t of e.changedTouches) {
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

  // Boutons
  const bind = (id, onDown, onUp) => {
    const el = root.querySelector(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); }, { passive: false });
    if (onUp) {
      el.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); }, { passive: false });
      el.addEventListener('touchcancel', () => onUp(), { passive: true });
    }
  };

  bind('#tb-jump', () => controls.jump());
  bind('#tb-use', () => interact());
  bind('#tb-spray', () => spray.toggleMode()); // mode bombe de peinture
  bind('#tb-stamp', () => spray.stampTag());
  bind('#tb-color', () => spray.cycleColor(1));
  bind('#tb-gun', () => weapon.toggle());
  bind('#tb-tag', () => tagEditor.open());
  bind('#tb-lb', () => ui.toggleLeaderboards());
  // En mode bombe, le bouton TIR devient le bouton PEINDRE
  bind('#tb-fire', () => {
    if (state.tagMode) {
      spray.setPaint(true);
    } else {
      if (!state.weaponEquipped) weapon.toggle(true);
      weapon.setTrigger(true);
    }
  }, () => {
    spray.setPaint(false);
    weapon.setTrigger(false);
  });
}
