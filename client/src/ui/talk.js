// Conversation libre avec un PNJ : panneau de dialogue, réponses de Claude
// (serveur /api/npc/talk), voix Piper si le serveur l'a, sinon synthèse du
// navigateur. Sans clé API côté serveur, ctx.talkTo renvoie false et les PNJ
// gardent leurs répliques fixes.
import { state, apiFetch } from '../state.js';
import { audio, getAudioGraph } from '../audio.js';
import { rainAmount } from '../world/weather.js';

// Repli speechSynthesis : une hauteur de voix par PNJ
const PITCH = { patron: 0.6, patronne: 1.25, marchand: 0.9, bouquiniste: 0.7 };

// Reconnaissance vocale NATIVE (Chrome Android/PC, Safari) : texte en direct,
// rien à envoyer au serveur. Sinon repli whisper.cpp (/api/stt).
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function createTalk(ctx) {
  let available = false, sttOn = false;
  const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  // Mode conversation (micro natif) : on parle, le PNJ répond à voix haute,
  // puis le micro se rouvre tout seul. Mémorisé d'une conversation à l'autre.
  let handsFree = false;
  try { handsFree = !!SR && localStorage.getItem('lyon_talk_voice') === '1'; } catch { /* stockage indisponible */ }
  apiFetch('/npc/status').then((s) => {
    available = !!s.ai;
    sttOn = !!s.stt && canRecord;
    mic.classList.toggle('hidden', !(SR || sttOn));
    if (SR || sttOn) input.placeholder = idleHint();
  }).catch(() => {});
  const idleHint = () => (SR
    ? (handsFree ? 'Parle, je t’écoute… (🎤 pour couper la voix)' : 'Dis-lui quelque chose… (Entrée, ou 🎤 / Tab pour parler)')
    : 'Dis-lui quelque chose… (Entrée, ou 🎤 / Tab pour parler)');

  const el = document.createElement('div');
  el.id = 'talk';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="talk-head"><span class="talk-who"></span><button class="talk-close" title="Partir (Échap)">✕</button></div>
    <div class="talk-log"></div>
    <form class="talk-form">
      <input type="text" maxlength="240" autocomplete="off" placeholder="Dis-lui quelque chose… (Entrée)">
      <button type="button" class="talk-mic hidden" title="Parler au micro (Tab)">🎤</button>
      <button type="submit">➤</button>
    </form>`;
  document.body.appendChild(el);
  const who = el.querySelector('.talk-who');
  const log = el.querySelector('.talk-log');
  const form = el.querySelector('.talk-form');
  const input = form.querySelector('input');
  const mic = form.querySelector('.talk-mic');

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

  // Résolue quand le PNJ a fini de parler (le micro peut alors se rouvrir)
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
          const src = ac.createBufferSource();
          source = src;
          src.buffer = buf;
          src.connect(g).connect(master);
          const done = new Promise((r) => { src.onended = r; });
          src.start();
          await done;
          if (source === src) source = null;
          return;
        }
      } catch { /* repli navigateur */ }
    }
    audio.speak(text, { pitch: PITCH[npc?.id] ?? 1, rate: 1.02, volume: 1 });
    // synthèse du navigateur : on attend qu'elle se taise
    await new Promise((r) => setTimeout(r, 300));
    while ('speechSynthesis' in window && speechSynthesis.speaking) await new Promise((r) => setTimeout(r, 200));
  }

  // --- Micro NATIF : résultats intermédiaires écrits en direct dans le
  // champ, envoi automatique à la fin de la phrase
  let recog = null;
  function listenNative() {
    if (!SR || recog || busy || !npc) return;
    stopVoice();
    const r = new SR();
    recog = r;
    r.lang = 'fr-FR';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      input.value = (finalText + interim).trim();
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        line('sys', 'Micro refusé par le navigateur.');
        setHandsFree(false);
      }
    };
    r.onend = () => {
      if (recog === r) recog = null;
      micState();
      if (npc && !busy && input.value.trim()) form.requestSubmit();
    };
    try { r.start(); } catch { recog = null; }
    micState();
  }
  function setHandsFree(on) {
    handsFree = on;
    try { localStorage.setItem('lyon_talk_voice', on ? '1' : '0'); } catch { /* stockage indisponible */ }
    if (!on && recog) { recog.onend = null; recog.abort(); recog = null; }
    micState();
  }
  function micState() {
    mic.classList.toggle('rec', !!recog || !!rec);
    mic.classList.toggle('on', handsFree);
    input.placeholder = recog ? '🔴 Je t’écoute…' : idleHint();
  }

  // --- Micro : MediaRecorder → PCM 16 kHz mono (OfflineAudioContext) → WAV
  // → /api/stt (whisper.cpp) → texte envoyé comme une réplique tapée.
  let rec = null;
  async function startRec() {
    if (rec || busy) return;
    stopVoice();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      line('sys', 'Micro refusé par le navigateur.');
      return;
    }
    if (!npc) { stream.getTracks().forEach((t) => t.stop()); return; }
    const mr = new MediaRecorder(stream);
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { mr.onstop = r; });
    mr.start();
    rec = { mr, stream, chunks, done, timer: setTimeout(() => stopRec(), 12000) };
    mic.classList.add('rec');
    mic.textContent = '⏹';
    input.placeholder = '🔴 Je t’écoute… (Tab ou ⏹ pour envoyer)';
  }

  async function stopRec(cancel = false) {
    if (!rec) return;
    const { mr, stream, chunks, done, timer } = rec;
    rec = null;
    clearTimeout(timer);
    mr.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    mic.classList.remove('rec');
    mic.textContent = '🎤';
    input.placeholder = 'Dis-lui quelque chose… (Entrée, ou 🎤 / Tab pour parler)';
    if (cancel || !npc || !chunks.length) return;
    const wait = line('me wait', '🎤 …');
    try {
      const wav = await toWav16k(new Blob(chunks, { type: mr.mimeType }));
      if (!wav) { wait.remove(); line('sys', 'Je t’ai pas entendu, parle plus fort !'); return; }
      const res = await fetch('/api/stt', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${state.auth?.token}` },
        body: wav,
      });
      const out = await res.json().catch(() => ({}));
      wait.remove();
      if (!res.ok) { line('sys', out.error ?? 'Micro indisponible.'); return; }
      if (!out.text) { line('sys', 'Je t’ai pas compris, réessaie.'); return; }
      input.value = out.text;
      form.requestSubmit();
    } catch {
      wait.remove();
      line('sys', 'Je t’ai pas compris, réessaie.');
    }
  }

  async function toWav16k(blob) {
    const { ctx: ac } = getAudioGraph();
    const src = await ac.decodeAudioData(await blob.arrayBuffer());
    const n = Math.min(Math.ceil(src.duration * 16000), 16000 * 14);
    if (n < 4000) return null; // moins d'un quart de seconde
    const off = new OfflineAudioContext(1, n, 16000);
    const s = off.createBufferSource();
    s.buffer = src;
    s.connect(off.destination);
    s.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    let sum = 0, peak = 0;
    for (let i = 0; i < n; i++) { sum += pcm[i] * pcm[i]; peak = Math.max(peak, Math.abs(pcm[i])); }
    if (Math.sqrt(sum / n) < 0.004) return null; // silence
    const gain = peak > 0 ? Math.min(4, 0.9 / peak) : 1; // normalisation douce
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const x = Math.max(-1, Math.min(1, pcm[i] * gain));
      v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    return buf;
  }

  // Natif : 🎤 allume/éteint le mode conversation. Repli : enregistrement
  // manuel envoyé à whisper (/api/stt).
  function micToggle() {
    if (SR) {
      if (handsFree) setHandsFree(false);
      else { setHandsFree(true); listenNative(); }
    } else if (rec) stopRec();
    else startRec();
  }
  mic.addEventListener('click', micToggle);

  function open(id, opts) {
    npc = { id, ...opts };
    who.textContent = `${opts.emoji ?? '💬'} ${opts.title}`;
    log.innerHTML = '';
    if (opts.greet) line('npc', opts.greet);
    el.classList.remove('hidden');
    state.overlayOpen = true;
    document.exitPointerLock?.();
    micState();
    // mode conversation : on écoute tout de suite (pas de clavier sur mobile)
    if (handsFree) setTimeout(listenNative, 250);
    else setTimeout(() => input.focus(), 30);
  }

  function close() {
    if (!npc) return;
    if (recog) { recog.onend = null; recog.abort(); recog = null; }
    stopRec(true);
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
      sayAloud(out.reply, out.tts).then(() => {
        if (handsFree && npc === cur) listenNative(); // à toi de répondre
      });
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
    else if (recog && e.key.length === 1) { // on tape : le micro se tait
      recog.onend = null; recog.abort(); recog = null; micState();
    }
    else if (e.key === 'Tab' && (SR || sttOn)) { e.preventDefault(); micToggle(); }
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
