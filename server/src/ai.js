import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `Tu es un développeur expert de mini-jeux d'arcade en HTML/JS/Canvas.
On te donne un titre et une description de jeu. Tu produis UN SEUL document HTML
complet et autonome qui implémente ce jeu pour une borne d'arcade virtuelle.

RÈGLES ABSOLUES :
- Réponds UNIQUEMENT avec le document HTML, de <!DOCTYPE html> à </html>. Aucun
  texte avant ou après, aucun bloc de code markdown.
- Tout est inline (<style> et <script>), zéro ressource externe, zéro requête
  réseau, pas de localStorage/sessionStorage/cookies, pas d'eval.
- Le jeu tourne dans une iframe sandboxée au format portrait : canvas d'environ
  360x480, centré, redimensionné en CSS (max-width:100%; max-height:100%).
- Esthétique arcade rétro sombre : fond noir, couleurs néon, police monospace,
  affiche le titre, le score et les contrôles.
- Contrôles clavier uniquement, via event.code (flèches, Space, Enter...) avec
  preventDefault() sur les flèches et Space. Appelle window.focus() au chargement.
- Le jeu démarre à la première touche pressée (affiche "Appuyez sur une touche").

PROTOCOLE DE SCORE (obligatoire, exactement ces messages) :
1. Au chargement, quand le jeu est prêt : parent.postMessage({type:'arcade:ready'}, '*')
2. À chaque changement de score : parent.postMessage({type:'arcade:progress', score: score}, '*')
3. À la fin de partie : parent.postMessage({type:'arcade:score', score: score}, '*')
   une seule fois par partie, puis affiche "GAME OVER — Entrée pour rejouer".
4. La touche Entrée relance une partie complète (état entièrement réinitialisé).

QUALITÉ : le jeu doit être réellement jouable, sans bug, avec une boucle
requestAnimationFrame, une difficulté progressive et un score entier qui
augmente. Si la description est vague, fais des choix de game design simples
et amusants. Si la description demande quelque chose d'impossible en 2D canvas,
adaptes-en une version 2D jouable.`;

export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function generateGame(title, prompt) {
  const client = new Anthropic();

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Titre du jeu : ${title}\n\nDescription du jeu :\n${prompt}`,
      },
    ],
  });

  const message = await stream.finalMessage();
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return extractHtml(text);
}

function extractHtml(text) {
  let html = text.trim();
  // Au cas où le modèle entoure malgré tout d'un bloc de code.
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fence) html = fence[1].trim();

  const start = html.search(/<!DOCTYPE html>/i);
  if (start > 0) html = html.slice(start);

  if (!/^<!DOCTYPE html>/i.test(html) || !/<\/html>\s*$/i.test(html)) {
    throw new Error('Le modèle n’a pas produit un document HTML complet.');
  }
  if (!html.includes('arcade:score')) {
    throw new Error('Le jeu généré n’implémente pas le protocole de score.');
  }
  return html;
}
