const STORAGE_KEY = 'lyon_arcade_tutorial_v1';

export function createTutorial({ isTouch = false } = {}) {
  let stage = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
  let startPosition = null;
  let el = null;
  const missions = [
    {
      title: 'Prends tes marques à Bellecour',
      detail: isTouch ? 'Utilise le joystick gauche pour faire quelques pas.' : 'Avance avec ZQSD ou WASD.',
    },
    {
      title: 'Laisse ta trace',
      detail: isTouch ? 'Sors la bombe, vise un mur et peins.' : 'Appuie sur F, vise un mur puis peins avec le clic.',
    },
    {
      title: 'Trouve la salle d’arcade',
      detail: 'Pars au nord de Bellecour. Son enseigne néon se voit de loin.',
    },
  ];

  function render() {
    if (stage >= missions.length) return complete();
    if (!el) {
      el = document.createElement('aside');
      el.id = 'intro-mission';
      el.setAttribute('aria-live', 'polite');
      el.innerHTML = `
        <div class="mission-top"><span>MISSION D’INTRO</span><button title="Passer le tutoriel" aria-label="Passer le tutoriel">×</button></div>
        <strong></strong><p></p><div class="mission-dots"></div>`;
      el.querySelector('button').onclick = skip;
      document.body.appendChild(el);
    }
    el.querySelector('strong').textContent = missions[stage].title;
    el.querySelector('p').textContent = missions[stage].detail;
    el.querySelector('.mission-dots').innerHTML = missions
      .map((_, i) => `<i class="${i < stage ? 'done' : i === stage ? 'active' : ''}"></i>`)
      .join('');
    el.classList.remove('mission-pop');
    void el.offsetWidth;
    el.classList.add('mission-pop');
  }

  function advance() {
    if (stage >= missions.length) return;
    stage += 1;
    localStorage.setItem(STORAGE_KEY, String(stage));
    render();
  }

  function update(position, arcadePosition) {
    if (stage >= missions.length) return;
    if (!startPosition) startPosition = { x: position.x, z: position.z };
    if (stage === 0 && Math.hypot(position.x - startPosition.x, position.z - startPosition.z) > 10) advance();
    if (stage === 2 && Math.hypot(position.x - arcadePosition.x, position.z - arcadePosition.z) < 28) advance();
  }

  function tagSaved() {
    if (stage === 1) advance();
  }

  function complete() {
    stage = missions.length;
    localStorage.setItem(STORAGE_KEY, String(stage));
    if (!el) return;
    el.querySelector('.mission-top span').textContent = 'MISSION ACCOMPLIE';
    el.querySelector('strong').textContent = 'Bienvenue chez les gones !';
    el.querySelector('p').textContent = 'Lyon est à toi. Explore, joue et trouve les secrets de la ville.';
    el.querySelector('.mission-dots').innerHTML = '<i class="done"></i><i class="done"></i><i class="done"></i>';
    setTimeout(() => { el?.remove(); el = null; }, 4200);
  }

  function skip() {
    stage = missions.length;
    localStorage.setItem(STORAGE_KEY, String(stage));
    el?.remove();
    el = null;
  }

  return {
    start: () => { if (stage < missions.length) render(); },
    update,
    tagSaved,
  };
}
