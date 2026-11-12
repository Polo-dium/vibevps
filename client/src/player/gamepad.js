import { state } from '../state.js';

// MANETTE (API Gamepad, disposition « standard » Xbox / PlayStation).
// Lue une fois par image ; elle ne connaît AUCUNE règle du jeu :
//  - stick gauche → controls.setTouchMove (le même canal que le joystick tactile)
//  - stick droit → controls.addLook (même friction de visée que la souris)
//  - gâchettes → détente de l'arme / visée à l'épaule
//  - boutons → touches d'origine réémises par ui/bindings.js (`press`)
// Les réglages (sensibilité, axe inversé) se font dans le menu Commandes.
const DEAD = 0.16;
const BUTTON_KEYS = {
  0: 'Space',   // A / croix : sauter
  2: 'KeyR',    // X / carré : recharger
  3: 'Digit2',  // Y / triangle : arme suivante
  4: 'KeyE',    // LB : interagir
  5: 'Digit1',  // RB : sortir / ranger l'arme
  8: 'Tab',     // Select : scores
  10: 'KeyZ',   // clic du stick gauche : fumigène
  11: 'KeyQ',   // clic du stick droit : grenade
  12: 'KeyM',   // croix haut : carte
  13: 'KeyJ',   // croix bas : jetpack
  14: 'Digit3', // croix gauche / droite : emotes
  15: 'Digit4',
};

export function createGamepad({ controls, weapon, bindings }) {
  const was = [];
  let moving = false, trigger = false, aim = false;
  const curve = (v) => {
    const a = Math.abs(v);
    if (a < DEAD) return 0;
    const k = (a - DEAD) / (1 - DEAD);
    return Math.sign(v) * k * (0.35 + 0.65 * k); // fin au centre, franc en butée
  };
  window.addEventListener('gamepadconnected', (e) => { state.gamepadName = e.gamepad.id.slice(0, 40); });
  window.addEventListener('gamepaddisconnected', () => { state.gamepadName = null; state.gamepadActive = false; });

  function update(dt) {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    let gp = null;
    for (const p of pads) if (p?.connected && p.mapping === 'standard') { gp = p; break; }
    if (!gp) for (const p of pads) if (p?.connected) { gp = p; break; }
    if (!gp) return;
    const b = (i) => (gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.35);

    // la manette « prend la main » au premier geste (sans capture de souris)
    if (!state.gamepadActive) {
      const any = gp.buttons.some((x) => x.pressed) || gp.axes.some((v) => Math.abs(v) > 0.5);
      if (!any) return;
      state.gamepadActive = true;
      state.gamepadName = gp.id.slice(0, 40);
    }

    // Start : menu des commandes (toujours disponible)
    const start = b(9);
    if (start && !was[9]) bindings.toggle();
    was[9] = start;
    if (state.overlayOpen) {
      // un panneau est ouvert : on relâche tout
      if (moving) { controls.setTouchMove(0, 0); moving = false; }
      if (trigger) { weapon.setTrigger(false); trigger = false; }
      if (aim) { weapon.setAds(false); aim = false; }
      for (const i of Object.keys(BUTTON_KEYS)) if (was[i]) { bindings.press(BUTTON_KEYS[i], false); was[i] = false; }
      return;
    }

    // Déplacement
    const mx = curve(gp.axes[0] ?? 0), my = curve(gp.axes[1] ?? 0);
    if (mx || my) { controls.setTouchMove(-my, mx); moving = true; } else if (moving) { controls.setTouchMove(0, 0); moving = false; }

    // Regard : vitesse angulaire (rad/s) convertie en « pixels de souris »
    const lx = curve(gp.axes[2] ?? 0), ly = curve(gp.axes[3] ?? 0);
    if (lx || ly) {
      const speed = 3.1 * bindings.pad.sens * (weapon.ads > 0.5 ? 0.55 : 1);
      const px = speed * dt / 0.0023;
      controls.addLook(lx * px, ly * px * 0.75 * (bindings.pad.invertY ? -1 : 1));
    }

    // Gâchettes : tir (RT) et visée à l'épaule (LT)
    const rt = b(7), lt = b(6);
    if (rt !== trigger) { weapon.setTrigger(rt); trigger = rt; }
    if (lt !== aim) { weapon.setAds(lt); aim = lt; }

    // B / rond : accroupi (bascule)
    const crouch = b(1);
    if (crouch && !was[1]) controls.toggleCrouch();
    was[1] = crouch;

    // Boutons → touches d'origine
    for (const [i, code] of Object.entries(BUTTON_KEYS)) {
      const down = b(Number(i));
      if (down !== Boolean(was[i])) { bindings.press(code, down); was[i] = down; }
    }
  }

  return { update };
}
