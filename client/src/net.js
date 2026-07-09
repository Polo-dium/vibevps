import { state } from './state.js';

const listeners = new Map(); // type -> Set<fn>
let ws = null;
let sendTimer = null;
let getLocalState = null;
let closedByUs = false;
let joinExtra = {};

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
}

function emit(type, payload) {
  for (const fn of listeners.get(type) ?? []) fn(payload);
}

export function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// `extra` : champs additionnels fusionnés dans le message `join` — sert au
// lien d'invitation (?ami=Pseudo), voir main.js.
export function connect(stateProvider, extra = {}) {
  getLocalState = stateProvider;
  joinExtra = extra;
  open();
}

function open() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'join', token: state.auth.token, ...joinExtra }));
    if (sendTimer) clearInterval(sendTimer);
    sendTimer = setInterval(() => {
      if (ws?.readyState !== WebSocket.OPEN || !getLocalState) return;
      const s = getLocalState();
      if (s) ws.send(JSON.stringify({ t: 's', ...s }));
    }, 80); // ~12 Hz
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    emit(msg.t, msg);
  };

  ws.onclose = () => {
    if (sendTimer) clearInterval(sendTimer);
    sendTimer = null;
    if (!closedByUs) setTimeout(open, 2000); // reconnexion auto
  };
  ws.onerror = () => ws?.close();
}

window.addEventListener('beforeunload', () => {
  closedByUs = true;
  ws?.close();
});
