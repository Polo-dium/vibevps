// Écran persistant pendant les téléchargements et la construction de la ville.
const TIPS = [
  'F sort la bombe de peinture · G pose ton tag',
  'M ouvre la carte · les lieux se révèlent en explorant',
  'Sur mobile, touche le décor et utilise les boutons d’action',
];

export function createLoadingScreen() {
  const overlay = document.createElement('div');
  overlay.className = 'loading-screen';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="loading-card">
      <div class="loading-kicker">PROCHAINE STATION</div>
      <div class="loading-title">LYON <span>ARCADE</span></div>
      <div class="loading-skyline" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
      </div>
      <p id="loading-status">Préparation de Bellecour…</p>
      <div class="loading-track"><div id="loading-progress"></div></div>
      <p id="loading-tip" class="loading-tip">ASTUCE · ${TIPS[0]}</p>
    </div>`;
  document.body.appendChild(overlay);

  const status = overlay.querySelector('#loading-status');
  const progress = overlay.querySelector('#loading-progress');
  const tip = overlay.querySelector('#loading-tip');
  let tipIndex = 0;
  let currentPercent = 0;
  const tipTimer = setInterval(() => {
    tipIndex = (tipIndex + 1) % TIPS.length;
    tip.textContent = `ASTUCE · ${TIPS[tipIndex]}`;
  }, 2800);

  function set(message, percent) {
    status.textContent = message;
    currentPercent = Math.max(currentPercent, Math.min(100, percent));
    progress.style.width = `${Math.max(4, currentPercent)}%`;
  }

  function done() {
    clearInterval(tipTimer);
    set('Bienvenue à Lyon !', 100);
    overlay.classList.add('is-done');
    setTimeout(() => overlay.remove(), 420);
  }

  function fail(message, retry = () => location.reload()) {
    clearInterval(tipTimer);
    overlay.classList.add('has-error');
    status.textContent = message;
    tip.innerHTML = '<button id="loading-retry">RÉESSAYER</button>';
    tip.querySelector('#loading-retry').onclick = retry;
  }

  return { set, done, fail };
}

export function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
