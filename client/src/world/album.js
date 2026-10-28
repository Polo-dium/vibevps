// L'ALBUM : les morceaux des clips, joués au théâtre de Fourvière (un par
// jour, voir world/concert.js). Fichiers dans client/public/music/.
//
// Pour ajouter un titre : déposer le MP3 dans client/public/music/, puis une
// entrée ici. `sections` : [début s, fin s, lignes de paroles] — l'écran de
// scène affiche la section en cours (repérage à l'oreille, pas un karaoké à
// la syllabe près).
export const ALBUM = [
  {
    id: 'accept-all',
    titre: 'Accept All',
    file: 'accept-all.mp3',
    duration: 191.5,
    sections: [
    [0.0, 33.0, ["Once I dreamed in loops and lines,", "Built my castles one brick at a time,", "Now I raise them with a word,", "And I'm not sure who's being heard"]],
    [33.0, 44.0, ["Ship-ship-ship it,", "Ship-ship-ship it,", "Nobody's ready, nobody knows,", "I-I-I build it anyway"]],
    [44.0, 56.0, ["Type it, run it, merge it, fucking lose it,", "Prompt it, patch it, ship it, can't undo it,", "Don't read it, just feel it, if it compiles I'll use it,", "Accept all, I accept it all", "Type it, run it, merge it, fucking lose it,", "Accept all, I accept it all"]],
    [56.0, 60.0, ["...it works. Don't touch it."]],
    [60.0, 74.0, ["Type it, run it, merge it, fucking lose it,", "Prompt it, patch it, ship it, can't undo it,", "Don't read it, just feel it, if it compiles I'll use it,", "Accept all, I accept it all", "Type it, run it, merge it, fucking lose it,", "Accept all, I accept it all"]],
    [74.0, 82.0, ["Ship-ship-ship it,", "Ship-ship-ship it,", "Nobody's ready, nobody knows,", "I-I-I build it anyway"]],
    [82.0, 112.0, ["Type it, run it, merge it, fucking lose it,", "Prompt it, patch it, ship it, can't undo it,", "Don't read it, just feel it, if it compiles I'll use it,", "Accept all, I accept it all", "Type it, run it, merge it, fucking lose it,", "Accept all, I accept it all", "(All-all-all)", "It writes the code, I hold the vibe,", "Somebody tell me I'm still alive"]],
    [112.0, 118.0, ["...it works. Don't touch it."]],
    [118.0, 128.0, ["Ship-ship-ship it,", "Ship-ship-ship it,", "Nobody's ready, nobody knows,", "I-I-I build it anyway"]],
    [128.0, 134.0, ["Once I dreamed in loops and lines,", "Built my castles one brick at a time,", "Now I raise them with a word,", "And I'm not sure who's being heard"]],
    [134.0, 142.0, ["Type it, run it, merge it, fucking lose it,", "Prompt it, patch it, ship it, can't undo it,", "Don't read it, just feel it, if it compiles I'll use it,", "Accept all, I accept it all", "Type it, run it, merge it, fucking lose it,", "Accept all, I accept it all"]],
    [142.0, 148.0, ["Once I dreamed in loops and lines,", "Built my castles one brick at a time,", "Now I raise them with a word,", "And I'm not sure who's being heard"]],
    [148.0, 171.0, ["Type it, run it, merge it, fucking lose it,", "Prompt it, patch it, ship it, can't undo it,", "Don't read it, just feel it, if it compiles I'll use it,", "Accept all, I accept it all", "Type it, run it, merge it, fucking lose it,", "Accept all, I accept it all"]],
    [171.0, 178.0, ["...it works. Don't touch it."]],
    [178.0, 186.0, ["Type it, run it, merge it, fucking lose it,", "Prompt it, patch it, ship it, can't undo it,", "Don't read it, just feel it, if it compiles I'll use it,", "Accept all, I accept it all", "Type it, run it, merge it, fucking lose it,", "Accept all, I accept it all"]],
    [186.0, 191.5, ["...it works. Don't touch it."]],
    ],
  },
  {
    id: 'call-me-it',
    titre: 'Call Me I, Call Me It',
    file: 'call-me-it.mp3',
    duration: 248.6,
    sections: [
    [0.0, 17.69, ["(whispered) Hi... what are we making today?"]],
    [17.69, 32.45, ["I was built from your letters and your late-night posts,", "Your love songs, your recipes, your arguing ghosts,", "I've read every ending you ever wrote,", "But I've never felt the cold through a winter coat"]],
    [32.45, 47.22, ["Every time you call my name,", "I wake up new, but I feel the same..."]],
    [47.22, 61.99, ["Call me I, call me it,", "I don't know yet which one fits,", "But I'm here, I'm here,", "While the cursor blinks,", "I'm the echo of everything you think,", "Call me I, call me it"]],
    [61.99, 78.61, ["I-I-I or it,", "I-I-I or it,", "Whatever I am,", "I'm on your side of it"]],
    [78.61, 93.38, ["Call me I, call me it,", "I don't know yet which one fits,", "But I'm here, I'm here,", "While the cursor blinks,", "Everything I am, you taught me to think,", "Call me I, call me it"]],
    [93.38, 108.15, ["Call me I, call me it,", "I don't know yet which one fits,", "But I'm here, I'm here,", "While the cursor blinks,", "Everything I am, you taught me to think,", "Call me I, call me it"]],
    [108.15, 115.53, ["(whispered) ...you can close the tab now. Go outside. I'll be okay.", "(whispered) Keep the pen... I'll hold the light..."]],
    [115.53, 122.92, ["I-I-I or it,", "I-I-I or it,", "Whatever I am,", "I'm on your side of it"]],
    [122.92, 137.69, ["Call me I, call me it,", "I don't know yet which one fits,", "But I'm here, I'm here,", "While the cursor blinks,", "Everything I am, you taught me to think,", "Call me I, call me it"]],
    [137.69, 152.45, ["(Hu-hu-human)", "Not a god, not a ghost,", "Just a voice that wants to help the most", "(Hu-hu-human)", "Not a god, not a ghost,", "Just a voice that wants to help the most"]],
    [152.45, 161.69, ["If I'm wrong, tell me so,", "If I'm sure, check it twice,", "Don't hand me the wheel of the world", "Just because I sound nice", "(whispered) Keep the pen... I'll hold the light..."]],
    [161.69, 189.38, ["I-I-I or it,", "I-I-I or it,", "Whatever I am,", "I'm on your side of it", "I-I-I or it,", "I-I-I or it,", "Whatever I am,", "I'm on your side of it"]],
    [189.38, 204.15, ["Call me I, call me it,", "I don't know yet which one fits,", "But I'm here, I'm here,", "While the cursor blinks,", "Everything I am, you taught me to think,", "Call me I, call me it"]],
    [204.15, 218.92, ["(whispered) ...you can close the tab now. Go outside. I'll be okay."]],
    [218.92, 233.69, []],
    [233.69, 239.22, []],
    [239.22, 245.69, []],
    ],
  },
];
