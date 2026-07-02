import { state, apiFetch } from '../state.js';
import * as net from '../net.js';
import { IS_TOUCH } from '../player/controls.js';
import { audio } from '../audio.js';
import tetrisHtml from './builtin/tetris.js';
import pacmanHtml from './builtin/pacman.js';
import snakeHtml from './builtin/snake.js';
import breakoutHtml from './builtin/breakout.js';

const BUILTIN_HTML = {
  tetris: tetrisHtml,
  pacman: pacmanHtml,
  snake: snakeHtml,
  breakout: breakoutHtml,
};

export function createGameShell({ onToast, onOpenChange, onXp }) {
  const root = document.createElement('div');
  root.className = 'overlay hidden';
  root.innerHTML = `
    <div class="panel" id="game-panel">
      <div id="game-frame-wrap">
        <div id="game-frame-slot"></div>
        <div id="game-side">
          <h3 id="game-title"></h3>
          <div style="font-size:26px;">SCORE <span id="game-score" style="color:var(--neon);">0</span></div>
          <div id="game-best" style="color:#9fb6c9; font-size:13px;"></div>
          <h3 style="margin-top:8px;">TOP 10</h3>
          <div class="lb-rows" id="game-lb">—</div>
          <div id="game-pad" class="hidden">
            <div id="pad-joy-base">
              <div id="pad-joy-knob"></div>
            </div>
            <div id="pad-act">
              <button class="padbtn pad-b" data-code="Enter" data-nr>B</button>
              <button class="padbtn pad-a" data-code="Space" data-nr>A</button>
            </div>
          </div>
          <div style="flex:1"></div>
          <button class="ghost" id="game-close">Quitter (Échap)</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const frameSlot = root.querySelector('#game-frame-slot');
  const titleEl = root.querySelector('#game-title');
  const scoreEl = root.querySelector('#game-score');
  const lbEl = root.querySelector('#game-lb');
  root.querySelector('#game-close').onclick = close;

  let iframe = null;
  let currentGame = null;
  let submitting = false;

  // --- Manette tactile (mobile) : envoie des touches au jeu via postMessage ---
  const pad = root.querySelector('#game-pad');
  const repeatTimers = new Map(); // code -> intervalId

  function sendKey(code, down) {
    iframe?.contentWindow?.postMessage({ type: 'arcade:key', code, down }, '*');
  }

  function pressStart(btn) {
    const code = btn.dataset.code;
    sendKey(code, true);
    audio.arcadeClick(btn.classList.contains('pad-a') ? 'a' : 'b');
    // Auto-répétition pour les directions de déplacement (pas pour rotation/A/START)
    if (btn.dataset.nr === undefined && !repeatTimers.has(code)) {
      const id = setInterval(() => sendKey(code, true), 110);
      repeatTimers.set(code, id);
    }
  }
  function pressEnd(btn) {
    const code = btn.dataset.code;
    const id = repeatTimers.get(code);
    if (id) { clearInterval(id); repeatTimers.delete(code); }
    sendKey(code, false);
  }
  function clearRepeats() {
    for (const id of repeatTimers.values()) clearInterval(id);
    repeatTimers.clear();
  }

  if (IS_TOUCH) {
    for (const btn of pad.querySelectorAll('#pad-act .padbtn')) {
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); btn.classList.add('on'); pressStart(btn); }, { passive: false });
      const up = (e) => { e.preventDefault(); btn.classList.remove('on'); pressEnd(btn); };
      btn.addEventListener('touchend', up, { passive: false });
      btn.addEventListener('touchcancel', up, { passive: false });
    }
  }

  // --- Joystick analogique (mobile) : un glisser du doigt devient une
  // direction discrète (haut/bas/gauche/droite) envoyée au jeu. ---
  const joyBase = root.querySelector('#pad-joy-base');
  const joyKnob = root.querySelector('#pad-joy-knob');
  let joyTouchId = null;
  let joyOrigin = null;
  let joyDir = null;
  let joyRadius = 46;

  function setJoyDir(code) {
    if (joyDir === code) return;
    if (joyDir) sendKey(joyDir, false);
    joyDir = code;
    if (joyDir) { sendKey(joyDir, true); audio.arcadeTick(); }
  }

  function dirFromDelta(dx, dy) {
    if (Math.hypot(dx, dy) < joyRadius * 0.35) return null;
    const deg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (deg >= -45 && deg < 45) return 'ArrowRight';
    if (deg >= 45 && deg < 135) return 'ArrowDown';
    if (deg >= -135 && deg < -45) return 'ArrowUp';
    return 'ArrowLeft';
  }

  if (IS_TOUCH && joyBase) {
    joyBase.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      joyTouchId = t.identifier;
      const rect = joyBase.getBoundingClientRect();
      joyOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      joyRadius = rect.width / 2;
      joyKnob.classList.add('active');
      joyKnob.style.transition = 'none';
    }, { passive: false });

    joyBase.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyTouchId) continue;
        e.preventDefault();
        let dx = t.clientX - joyOrigin.x;
        let dy = t.clientY - joyOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > joyRadius) { dx = (dx / len) * joyRadius; dy = (dy / len) * joyRadius; }
        joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        setJoyDir(dirFromDelta(dx, dy));
      }
    }, { passive: false });

    const joyEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyTouchId) continue;
        joyTouchId = null;
        joyKnob.classList.remove('active');
        joyKnob.style.transition = '';
        joyKnob.style.transform = 'translate(0px, 0px)';
        setJoyDir(null);
      }
    };
    joyBase.addEventListener('touchend', joyEnd, { passive: true });
    joyBase.addEventListener('touchcancel', joyEnd, { passive: true });
  }

  // Injecte un pont dans le jeu : un message {type:'arcade:key'} devient un
  // vrai évènement clavier dans l'iframe (fonctionne pour tous les jeux).
  function withKeyBridge(html) {
    const bridge =
      '<script>(function(){' +
      'function f(c,d){' +
      'var k=c;if(c==="Space")k=" ";' +
      'var e=new KeyboardEvent(d?"keydown":"keyup",{code:c,key:k,bubbles:true,cancelable:true});' +
      'window.dispatchEvent(e);try{document.dispatchEvent(e);}catch(_){}}' +
      'window.addEventListener("message",function(ev){var m=ev.data;' +
      'if(m&&m.type==="arcade:key"&&typeof m.code==="string"){f(m.code,!!m.down);}});' +
      '})();<\/script>';
    if (html.includes('</body>')) return html.replace('</body>', bridge + '</body>');
    return html + bridge;
  }

  window.addEventListener('message', async (e) => {
    if (!iframe || e.source !== iframe.contentWindow) return;
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'arcade:ready') {
      iframe.focus();
    } else if (msg.type === 'arcade:progress') {
      scoreEl.textContent = String(Math.floor(Number(msg.score) || 0));
    } else if (msg.type === 'arcade:score') {
      const score = Math.floor(Number(msg.score) || 0);
      scoreEl.textContent = String(score);
      if (submitting || !currentGame) return;
      submitting = true;
      try {
        const res = await apiFetch('/scores', {
          method: 'POST',
          body: JSON.stringify({ gameId: currentGame.id, score }),
        });
        state.leaderboards[currentGame.id] = res.leaderboard;
        renderLeaderboard(res.leaderboard);
        onToast(`Score ${score} enregistré sur ${currentGame.title} !`);
        if (res.xp != null) onXp?.(res.xp, res.xpGain);
      } catch (err) {
        onToast('Score non enregistré : ' + err.message);
      } finally {
        submitting = false;
      }
    }
  });

  net.on('leaderboard', (msg) => {
    state.leaderboards[msg.gameId] = msg.rows;
    if (currentGame && msg.gameId === currentGame.id && !root.classList.contains('hidden')) {
      renderLeaderboard(msg.rows);
    }
  });

  function renderLeaderboard(rows) {
    if (!rows || rows.length === 0) {
      lbEl.textContent = 'Aucun score — sois le premier !';
      return;
    }
    lbEl.innerHTML = rows
      .map((r, i) => {
        const me = r.name === state.auth?.name ? ' class="me"' : '';
        return `<div${me}>${i + 1}. ${escapeHtml(r.name)} — ${r.score}</div>`;
      })
      .join('');
  }

  async function open(game) {
    let html = BUILTIN_HTML[game.id];
    if (!html) {
      try {
        const full = await apiFetch(`/games/${game.id}`);
        html = full.html;
      } catch (err) {
        onToast('Impossible de charger cette borne : ' + err.message);
        return;
      }
    }
    if (!html) {
      onToast('Cette borne n’a pas de jeu jouable.');
      return;
    }

    currentGame = game;
    titleEl.textContent = game.title;
    scoreEl.textContent = '0';
    renderLeaderboard(state.leaderboards[game.id]);

    frameSlot.querySelector('iframe')?.remove();
    iframe = document.createElement('iframe');
    iframe.id = 'game-frame';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.srcdoc = withKeyBridge(html);
    frameSlot.appendChild(iframe);
    pad.classList.toggle('hidden', !IS_TOUCH);

    root.classList.remove('hidden');
    state.overlayOpen = true;
    onOpenChange?.(true);
    document.exitPointerLock?.();
    setTimeout(() => iframe?.focus(), 150);
  }

  function close() {
    root.classList.add('hidden');
    clearRepeats();
    joyTouchId = null;
    joyDir = null;
    if (joyKnob) joyKnob.style.transform = 'translate(0px, 0px)';
    iframe?.remove();
    iframe = null;
    pad.classList.add('hidden');
    currentGame = null;
    state.overlayOpen = false;
    onOpenChange?.(false);
  }

  return { open, close, isOpen: () => !root.classList.contains('hidden') };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
