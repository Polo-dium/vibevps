import { state } from '../state.js';

// COMMANDES RECONFIGURABLES (clavier) + réglages de la manette.
//
// Tout le jeu lit des codes de touches PHYSIQUES en dur (`e.code === 'KeyE'`,
// `keys.has('KeyW')`…). Plutôt que de réécrire chaque lecture, on TRADUIT à
// la source : un écouteur en phase de capture intercepte la touche choisie
// par le joueur et réémet l'événement avec le code d'origine de l'action.
// Aucune autre partie du code n'a à connaître les réglages. La manette
// (player/gamepad.js) passe par la même porte : `press(code, down)`.
const LS_KEY = 'lyon_keys';

export const ACTIONS = [
  ['Déplacements', [
    ['KeyW', 'Avancer'], ['KeyS', 'Reculer'], ['KeyA', 'Gauche'], ['KeyD', 'Droite'],
    ['Space', 'Sauter'], ['ShiftLeft', 'S\'accroupir / glisser'],
  ]],
  ['Combat', [
    ['Digit1', 'Sortir / ranger l\'arme'], ['Digit2', 'Arme suivante'], ['KeyR', 'Recharger'],
    ['KeyQ', 'Grenade (arène)'], ['KeyZ', 'Fumigène (arène)'],
    ['Tab', 'Tableau des scores (arène)'],
  ]],
  ['Ville', [
    ['KeyE', 'Interagir'], ['KeyM', 'Carte'], ['KeyJ', 'Jetpack'], ['KeyB', 'Enceinte'],
    ['KeyF', 'Bombe de peinture'], ['KeyG', 'Poser son tag'], ['KeyT', 'Éditeur de tags'],
    ['KeyC', 'Mode photo'], ['Digit3', 'Emote 1'], ['Digit4', 'Emote 2'], ['Digit5', 'Emote 3'],
  ]],
  ['Divers', [
    ['Enter', 'Chat'], ['KeyV', 'Micro'], ['KeyL', 'Classements'], ['KeyO', 'Graphismes'],
    ['KeyN', 'Ce menu'],
  ]],
];

const NAMES = {
  Space: 'Espace', ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl gauche',
  ControlRight: 'Ctrl droite', AltLeft: 'Alt', AltRight: 'Alt Gr', Enter: 'Entrée', Tab: 'Tab',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '²', CapsLock: 'Verr. maj',
};

export function createBindings({ toast } = {}) {
  let user = {}; // code d'origine de l'action → touche choisie
  try { user = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { /* vierge */ }
  let fromUser = {}; // touche choisie → code d'origine
  const rebuild = () => { fromUser = {}; for (const [def, code] of Object.entries(user)) fromUser[code] = def; };
  rebuild();
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(user)); } catch { /* plein */ } rebuild(); };
  const keyOf = (def) => user[def] ?? def;

  // Étiquette lisible : la lettre réellement gravée sur le clavier quand le
  // navigateur sait le dire (AZERTY : la touche physique KeyW porte un Z)
  let layout = null;
  navigator.keyboard?.getLayoutMap?.().then((m) => { layout = m; if (open) render(); }).catch(() => {});
  const label = (code) => NAMES[code] ?? layout?.get(code)?.toUpperCase() ??
    code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Pavé ');

  let waiting = null; // action en attente d'une nouvelle touche

  // Réémet une touche sous son code d'origine (clavier remappé, manette)
  function press(code, down) {
    const ev = new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true });
    ev.__remapped = true;
    (document.body ?? window).dispatchEvent(ev);
  }

  const onKey = (e) => {
    if (e.__remapped) return;
    const tag = e.target?.tagName;
    if (waiting) {
      // saisie d'une nouvelle touche pour une action
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'keydown') return;
      if (e.code !== 'Escape') assign(waiting, e.code);
      waiting = null;
      render();
      return;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA') return; // on tape du texte
    const def = fromUser[e.code];
    if (def) {
      // touche choisie par le joueur → action d'origine
      e.preventDefault();
      e.stopImmediatePropagation();
      press(def, e.type === 'keydown');
    } else if (user[e.code] && user[e.code] !== e.code) {
      // ancienne touche d'une action déplacée ailleurs : elle ne fait plus rien
      e.stopImmediatePropagation();
    }
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);

  function assign(def, code) {
    // la touche servait déjà à une autre action : les deux échangent
    const other = ACTIONS.flatMap((g) => g[1]).map((a) => a[0]).find((d) => d !== def && keyOf(d) === code);
    const previous = keyOf(def);
    if (other) { if (previous === other) delete user[other]; else user[other] = previous; }
    if (code === def) delete user[def]; else user[def] = code;
    save();
  }

  // --- Réglages de la manette (lus par player/gamepad.js) ---------------------
  const pad = { sens: 1, invertY: false };
  try { Object.assign(pad, JSON.parse(localStorage.getItem('lyon_pad') || '{}')); } catch { /* défauts */ }
  const savePad = () => { try { localStorage.setItem('lyon_pad', JSON.stringify(pad)); } catch { /* plein */ } };

  // --- Menu ----------------------------------------------------------------------
  const overlay = document.createElement('div');
  overlay.className = 'overlay hidden';
  overlay.id = 'keys-overlay';
  document.body.appendChild(overlay);
  let open = false;
  const PAD_HELP = [
    ['Stick gauche', 'Se déplacer'], ['Stick droit', 'Regarder'], ['RT', 'Tirer'], ['LT', 'Viser à l\'épaule'],
    ['A', 'Sauter'], ['B', 'S\'accroupir'], ['X', 'Recharger'], ['Y', 'Arme suivante'],
    ['LB', 'Interagir'], ['RB', 'Sortir / ranger l\'arme'], ['Clic stick droit', 'Grenade'], ['Clic stick gauche', 'Fumigène'], ['Croix ↑', 'Carte'], ['Croix ↓', 'Jetpack'],
    ['Croix ← →', 'Emotes'], ['Select', 'Scores (arène)'], ['Start', 'Ce menu'],
  ];
  function render() {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    overlay.innerHTML = `
      <div class="panel" id="keys-panel">
        <h2>🎮 Commandes</h2>
        <p class="sub">Clique une touche puis appuie sur la nouvelle (Échap pour annuler). Deux actions sur la même touche échangent leurs places.</p>
        <div class="keys-cols">
          ${ACTIONS.map(([title, list]) => `
            <section><h3>${title}</h3>
              ${list.map(([def, name]) => `
                <div class="key-row"><span>${esc(name)}</span>
                  <button type="button" data-def="${def}" class="${waiting === def ? 'wait' : user[def] ? 'custom' : ''}">
                    ${waiting === def ? '…' : esc(label(keyOf(def)))}</button></div>`).join('')}
            </section>`).join('')}
          <section><h3>Manette</h3>
            <p class="pad-state">${state.gamepadName ? `Connectée : ${esc(state.gamepadName)}` : 'Aucune manette détectée — branche-la et appuie sur un bouton.'}</p>
            ${PAD_HELP.map(([b, a]) => `<div class="key-row"><span>${a}</span><kbd>${b}</kbd></div>`).join('')}
            <label class="pad-opt">Sensibilité du regard <b id="pad-sens-v">${pad.sens.toFixed(1)}</b>
              <input type="range" id="pad-sens" min="0.4" max="2.5" step="0.1" value="${pad.sens}"></label>
            <label class="pad-opt"><input type="checkbox" id="pad-inv" ${pad.invertY ? 'checked' : ''}> Inverser l'axe vertical</label>
          </section>
        </div>
        <div class="keys-actions">
          <button type="button" class="ghost" id="keys-reset">Touches par défaut</button>
          <button type="button" id="keys-close">Fermer</button>
        </div>
      </div>`;
    overlay.querySelectorAll('[data-def]').forEach((b) => {
      b.onclick = () => { waiting = b.dataset.def; render(); };
    });
    overlay.querySelector('#keys-reset').onclick = () => { user = {}; save(); render(); toast?.('⌨️ Touches remises par défaut.'); };
    overlay.querySelector('#keys-close').onclick = () => toggle(false);
    overlay.querySelector('#pad-sens').oninput = (e) => {
      pad.sens = Number(e.target.value);
      overlay.querySelector('#pad-sens-v').textContent = pad.sens.toFixed(1);
      savePad();
    };
    overlay.querySelector('#pad-inv').onchange = (e) => { pad.invertY = e.target.checked; savePad(); };
  }
  function toggle(show = !open) {
    if (show === open) return;
    if (show && state.overlayOpen) return; // un autre panneau est déjà ouvert
    open = show;
    waiting = null;
    if (show) {
      render();
      overlay.classList.remove('hidden');
      state.overlayOpen = true;
      document.exitPointerLock?.();
    } else {
      overlay.classList.add('hidden');
      state.overlayOpen = false;
    }
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) toggle(false); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyN' && !open && !state.overlayOpen && e.target?.tagName !== 'INPUT') toggle(true);
    else if (e.code === 'Escape' && open) toggle(false);
  });

  return { press, toggle, pad, label, keyOf, get open() { return open; } };
}
