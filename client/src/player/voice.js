import * as net from '../net.js';

// Chat vocal de proximité en WebRTC (maillage entre joueurs).
// - Micro activable/désactivable.
// - On reçoit toujours la voix des autres ; le volume baisse avec la distance.
// - Signalisation relayée par le serveur (messages 't:rtc').

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const VOICE_RANGE = 28; // portée d'audibilité (mètres)

export function createVoice({ getMyId, getMyPos, getRemotePos, onToast, onState }) {
  const peers = new Map(); // remoteId -> { pc, transceiver, audio, makingOffer, ignoreOffer, polite }
  let localStream = null;
  let micOn = false;

  function emitState() { onState?.(micOn); }

  function signal(to, data) {
    net.send({ t: 'rtc', to, data });
  }

  function ensurePeer(remoteId) {
    if (peers.has(remoteId)) return peers.get(remoteId);
    const myId = getMyId();
    if (!myId || remoteId === myId) return null;

    const pc = new RTCPeerConnection(ICE);
    const entry = { pc, transceiver: null, audio: null, makingOffer: false, ignoreOffer: false, polite: myId < remoteId };

    // On veut recevoir la voix dès maintenant ; on émettra quand le micro s'allume
    entry.transceiver = pc.addTransceiver('audio', { direction: 'recvonly' });
    if (localStream && micOn) {
      entry.transceiver.direction = 'sendrecv';
      entry.transceiver.sender.replaceTrack(localStream.getAudioTracks()[0]);
    }

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        signal(remoteId, { description: pc.localDescription });
      } catch (err) {
        console.warn('voice negotiation', err);
      } finally {
        entry.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) signal(remoteId, { candidate });
    };
    pc.ontrack = (e) => {
      let audio = entry.audio;
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;
        audio.volume = 0;
        entry.audio = audio;
      }
      audio.srcObject = e.streams[0];
      audio.play?.().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { pc.restartIce?.(); }
    };

    peers.set(remoteId, entry);
    return entry;
  }

  async function onSignal(from, data) {
    const entry = ensurePeer(from);
    if (!entry) return;
    const { pc } = entry;
    try {
      if (data.description) {
        const offerCollision =
          data.description.type === 'offer' &&
          (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          signal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); }
        catch (err) { if (!entry.ignoreOffer) throw err; }
      }
    } catch (err) {
      console.warn('voice signal', err);
    }
  }

  function removePeer(id) {
    const entry = peers.get(id);
    if (!entry) return;
    try { entry.pc.close(); } catch { /* déjà fermé */ }
    if (entry.audio) { entry.audio.srcObject = null; entry.audio = null; }
    peers.delete(id);
  }

  async function enableMic() {
    if (micOn) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      onToast?.('Micro refusé : ' + (err?.message ?? 'accès bloqué'));
      return;
    }
    micOn = true;
    const track = localStream.getAudioTracks()[0];
    for (const entry of peers.values()) {
      entry.transceiver.direction = 'sendrecv';
      await entry.transceiver.sender.replaceTrack(track).catch(() => {});
    }
    onToast?.('🎤 Micro activé — les joueurs proches t’entendent.');
    emitState();
  }

  function disableMic() {
    if (!micOn) return;
    micOn = false;
    for (const entry of peers.values()) {
      entry.transceiver.sender.replaceTrack(null).catch?.(() => {});
      entry.transceiver.direction = 'recvonly';
    }
    if (localStream) {
      for (const t of localStream.getTracks()) t.stop();
      localStream = null;
    }
    onToast?.('🔇 Micro coupé.');
    emitState();
  }

  function toggleMic() { micOn ? disableMic() : enableMic(); }

  // Atténuation du volume selon la distance (appelé chaque frame)
  function update() {
    const me = getMyPos();
    for (const [id, entry] of peers) {
      if (!entry.audio) continue;
      const p = getRemotePos(id);
      if (!p) { entry.audio.volume = 0; continue; }
      const dx = p.x - me.x, dz = p.z - me.z;
      const dist = Math.hypot(dx, dz);
      const v = dist >= VOICE_RANGE ? 0 : Math.pow(1 - dist / VOICE_RANGE, 1.6);
      entry.audio.volume = Math.max(0, Math.min(1, v));
    }
  }

  // Câblage réseau
  net.on('rtc', (msg) => onSignal(msg.from, msg.data));
  net.on('hello', (msg) => { for (const pl of msg.players) ensurePeer(pl.id); });
  net.on('pjoin', (msg) => ensurePeer(msg.id));
  net.on('pleave', (msg) => removePeer(msg.id));

  return { toggleMic, enableMic, disableMic, update, isOn: () => micOn };
}
