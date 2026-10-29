// Conversation libre avec un PNJ : panneau de dialogue, réponses de Claude
// (serveur /api/npc/talk), voix Piper si le serveur l'a, sinon synthèse du
// navigateur. Sans clé API côté serveur, ctx.talkTo renvoie false et les PNJ
// gardent leurs répliques fixes.
import { state, apiFetch } from '../state.js';
import { audio, getAudioGraph } from '../audio.js';
import { rainAmount } from '../world/weather.js';

// Repli speechSynthesis : une hauteur de voix par PNJ
const PITCH = { patron: 0.6, patronne: 1.25, marchand: 0.9, bouquiniste: 0.7 };

export function createTalk(ctx) {
  let available = false;
  apiFetch('/npc/status').then((s) => { available = !!s.ai; }).catch(() => {});

  const el = document.createElement('div');
  el.id = 'talk';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="talk-head"><span class="talk-who"></span><button class="talk-close" title="Partir (Échap)">✕</button></div>
    <div class="talk-log"></div>
    <form class="talk-form">
      <input type="text" maxlength="240" autocomplete="off" placeholder="Dis-lui quelque chose… (Entrée)">
      <button type="submit">➤</button>
    </form>`;
  document.body.appendChild(el);
  const who = el.querySelector('.talk-who');
  const log = el.querySelector('.talk-log');
  const form = el.querySelector('.talk-form');
  const input = form.querySelector('input');

  let npc = null, busy = false, source = null;

  function line(cls, text) {
    const d = document.createElement('div');
    d.className = 'talk-line ' + cls;
    d.textContent = text;
    log.appendChild(d);
    while (log.children.length > 30) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function stopVoice() {
    try { source?.stop(); } catch { /* déjà fini */ }
    source = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  async function sayAloud(text, ttsId) {
    stopVoice();
    if (ttsId) {
      try {
        const res = await fetch(`/api/tts/${ttsId}`);
        if (res.ok) {
          const { ctx: ac, master } = getAudioGraph();
          const buf = await ac.decodeAudioData(await res.arrayBuffer());
          if (!npc) return; // parti entre-temps
          const g = ac.createGain();
          g.gain.value = 1.6; // Piper sort assez bas face aux effets du jeu
          source = ac.createBufferSource();
          source.buffer = buf;
          source.connect(g).connect(master);
          source.start();
          return;
        }
      } catch { /* repli navigateur */ }
    }
    audio.speak(text, { pitch: PITCH[npc?.id] ?? 1, rate: 1.02, volume: 1 });
  }

  function open(id, opts) {
    npc = { id, ...opts };
    who.textContent = `${opts.emoji ?? '💬'} ${opts.title}`;
    log.innerHTML = '';
    if (opts.greet) line('npc', opts.greet);
    el.classList.remove('hidden');
    state.overlayOpen = true;
    document.exitPointerLock?.();
    setTimeout(() => input.focus(), 30);
  }

  function close() {
    if (!npc) return;
    stopVoice();
    el.classList.add('hidden');
    input.value = '';
    input.blur();
    npc = null;
    state.overlayOpen = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy || !npc) return;
    input.value = '';
    line('me', text);
    const wait = line('npc wait', '…');
    busy = true;
    const cur = npc;
    try {
      const out = await apiFetch('/npc/talk', {
        method: 'POST',
        body: JSON.stringify({
          npc: cur.id, message: text,
          scene: { nuit: (ctx.env?.daylight ?? 1) < 0.35, pluie: rainAmount() > 0.3 },
        }),
      });
      wait.remove();
      if (npc !== cur) return;
      line('npc', out.reply);
      sayAloud(out.reply, out.tts);
    } catch (err) {
      wait.remove();
      if (npc !== cur) return;
      // IA coupée côté serveur : on retombe sur les répliques fixes
      if (/désactivés/.test(err.message)) available = false;
      line('sys', err.message);
      if (cur.fallback) line('npc', cur.fallback());
    } finally {
      busy = false;
    }
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // ZQSD, E, F… ne pilotent pas le jeu pendant la saisie
    if (e.key === 'Escape') close();
  });
  el.querySelector('.talk-close').addEventListener('click', close);

  // ctx.talkTo('patron', { title, emoji, greet, fallback }) → true si ouvert
  ctx.talkTo = (id, opts) => {
    if (!available || !state.auth || state.overlayOpen) return false;
    open(id, opts);
    return true;
  };
  return { close, isOpen: () => !!npc };
}
