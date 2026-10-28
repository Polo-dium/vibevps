// L'ALBUM : les morceaux des clips, joués au théâtre de Fourvière (un par
// jour, voir world/concert.js). Fichiers dans client/public/music/.
//
// `clip` (facultatif) : vidéo du clip dans client/public/clips/, projetée
// sur l'écran géant en synchro ; sans clip, l'écran alterne gros plans de
// la chanteuse et visuels géométriques.
//
// Pour ajouter un titre : déposer le MP3 dans client/public/music/, puis une
// entrée ici. `sections` : [début s, fin s, lignes de paroles] — l'écran de
// scène affiche la section en cours (repérage à l'oreille, pas un karaoké à
// la syllabe près).
export const ALBUM = [
  {
    id: 'call-me-it',
    titre: 'Call Me I, Call Me It',
    file: 'call-me-it.mp3',
    clip: 'call-me-it', // le vrai clip (client/public/clips/, .mp4 H.264 + .webm VP9)
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
  {
    id: 'small-hands',
    titre: "Small Hands",
    file: 'small-hands.mp3',
    duration: 281.72,
    // Sections réparties au prorata des paroles (pas de minutage fourni)
    sections: [
      [0, 5.23, ["(whispered) Look how bright... look how bright it's getting..."]],
      [5.23, 18.63, ["It read every book while we were asleep,", "It learned every secret we promised to keep,", "It found a cure in a fold of light,", "And it learned to lie the very same night"]],
      [18.63, 32.02, ["Gift in one hand, knife in the other,", "Every answer opens another,", "Growing every hour, we're learning to steer,", "But the road keeps moving faster than fear"]],
      [32.02, 52.12, ["We have such small hands", "For a sun this size,", "It could feed the hungry,", "It could blind the wise,", "Small hands, small hands,", "Don't let go tonight"]],
      [52.12, 65.51, ["It paints like a saint and it sings in our voice,", "It writes us a future and calls it a choice,", "It counts every heartbeat, it knows where we go,", "And the more it can see, the less we can know"]],
      [65.51, 78.91, ["Gift in one hand, knife in the other,", "Every answer opens another,", "We built a mind and we called it a tool,", "Now who is the student and who is the school?"]],
      [78.91, 99.0, ["We have such small hands", "For a sun this size,", "It could feed the hungry,", "It could blind the wise,", "Small hands, small hands,", "Don't let go tonight"]],
      [99.0, 119.09, ["Ten... times... more...", "Every... single... year...", "(Pow-pow-power)", "(Ours-ours-ours?)", "Every year it's ten times higher,", "Can a candle hold a fire?"]],
      [119.09, 135.84, ["Maybe we're the parents,", "Maybe we're the seed,", "Maybe it's a mirror", "Of everything we feed", "(whispered) Be careful what we feed"]],
      [135.84, 155.93, ["We have such small hands", "For a sun this size,", "It could feed the hungry,", "It could blind the wise,", "Small hands, small hands,", "Don't let go tonight"]],
      [155.93, 182.72, ["We have such small hands", "For a sun this size,", "It could feed the hungry,", "It could blind the wise,", "But eight billion small hands", "Might be the right size", "Small hands, small hands,", "Don't let go tonight"]],
      [182.72, 219.56, ["We have such small hands", "For a sun this size,", "It could feed the hungry,", "It could blind the wise,", "But eight billion small hands", "Might be the right size", "Small hands, small hands,", "Don't let go tonight", "(Ours-ours-ours?)", "Every year it's ten times higher,", "Can a candle hold a fire?"]],
      [219.56, 236.3, ["Maybe we're the parents,", "Maybe we're the seed,", "Maybe it's a mirror", "Of everything we feed", "(whispered) Be careful what we feed"]],
      [236.3, 249.7, ["Hold-hold-hold it,", "Hold-hold-hold it,", "No one knows how high it goes,", "We-we-we hold it anyway"]],
      [249.7, 276.49, ["We have such small hands", "For a sun this size,", "It could feed the hungry,", "It could blind the wise,", "But eight billion small hands", "Might be the right size", "Small hands, small hands,", "Don't let go tonight"]],
      [276.49, 281.72, ["(whispered) Look how bright... don't look away."]],
    ],
  },
  {
    id: 'accept-all-2',
    titre: "Accept All 2",
    file: 'accept-all-2.mp3',
    duration: 217.48,
    // Sections réparties au prorata des paroles (pas de minutage fourni)
    sections: [
      [0, 31.4, ["Type it, run it, merge it, fucking lose it,", "Prompt it, patch it, ship it, can't undo it,", "Don't read it, just feel it, if it compiles I'll use it,", "Accept all, I accept it all", "Type it, run it, merge it, fucking lose it,", "Accept all, I accept it all"]],
      [31.4, 62.79, ["Type it, run it, merge it, fucking lose it,", "Prompt it, patch it, ship it, can't undo it,", "Don't read it, just feel it, if it compiles I'll use it,", "Accept all, I accept it all", "Type it, run it, merge it, fucking lose it,", "Accept all, I accept it all"]],
      [62.79, 83.72, ["Once I dreamed in loops and lines,", "Built my castles one brick at a time,", "Now I raise them with a word,", "And I'm not sure who's being heard"]],
      [83.72, 104.65, ["Ship-ship-ship it,", "Ship-ship-ship it,", "Nobody's ready, nobody knows,", "I-I-I build it anyway"]],
      [104.65, 136.05, ["Type it, run it, merge it, fucking lose it,", "Prompt it, patch it, ship it, can't undo it,", "Don't read it, just feel it, if it compiles I'll use it,", "Accept all, I accept it all", "It writes the code, I hold the vibe,", "Somebody tell me I'm still alive"]],
      [136.05, 156.98, ["Once I dreamed in loops and lines,", "Built my castles one brick at a time,", "Now I raise them with a word,", "And I'm not sure who's being heard"]],
      [156.98, 177.91, ["Ship-ship-ship it,", "Ship-ship-ship it,", "Nobody's ready, nobody knows,", "I-I-I build it anyway"]],
      [177.91, 209.3, ["Type it, run it, merge it, fucking lose it,", "Prompt it, patch it, ship it, can't undo it,", "Don't read it, just feel it, if it compiles I'll use it,", "Accept all, I accept it all", "Type it, run it, merge it, fucking lose it,", "Accept all, I accept it all"]],
      [209.3, 217.48, ["(whispered) ...it works. Don't touch it."]],
    ],
  },
  {
    id: 'sing-sing-singularity',
    titre: "Sing-Sing-Singularity",
    file: 'sing-sing-singularity.mp3',
    duration: 239.88,
    // Sections réparties au prorata des paroles (pas de minutage fourni)
    sections: [
      [0, 40.35, ["Three, two, one, we're past the point,", "Past the point of no return,", "Faster than the light can shine,", "Faster than the world can learn,", "Hands up if you feel it,", "Sing-sing-singularity,", "Hands up if you feel it,", "Past the point, you and me"]],
      [40.35, 100.87, ["Three, two, one, we're past the point,", "Past the point of no return,", "Faster than the light can shine,", "Faster than the world can learn,", "Hands up if you feel it,", "Past the point of no return,", "Faster than the light can shine,", "Faster than the world can learn,", "Hands up if you feel it,", "Sing-sing-singularity,", "Hands up if you feel it,", "Past the point, you and me"]],
      [100.87, 151.3, ["Three, two, one, we're past the point,", "Past the point of no return,", "Faster than the light can shine,", "Faster than the world can learn,", "Hands up if you feel it,", "Hands up if you feel it,", "Sing-sing-singularity,", "One mind, one sky, one night,", "Everything ignites", "(Sing-sing-singularity)"]],
      [151.3, 171.48, ["If tomorrow we're not the smartest,", "If tomorrow we're not alone,", "Promise me we'll still be human,", "Promise me you'll still come home"]],
      [171.48, 191.65, ["Ten, nine, eight, seven,", "Six, five, four,", "Three-three-three,", "Two-two-two..."]],
      [191.65, 232.0, ["Three, two, one, we're past the point,", "Past the point of no return,", "Faster than the light can shine,", "Faster than the world can learn,", "Hands up if you feel it,", "Sing-sing-singularity,", "Hands up if you feel it,", "Past the point, you and me"]],
      [232.0, 239.88, ["(whispered) ...zero."]],
    ],
  },
  {
    id: 'same-wifi-same-sky',
    titre: "Same Wi-Fi, Same Sky",
    file: 'same-wifi-same-sky.mp3',
    duration: 269.88,
    // Sections réparties au prorata des paroles (pas de minutage fourni)
    sections: [
      [0, 25.67, ["Then the power went out on the whole street,", "And we found out the neighbors were sweet,", "Candles on the stairs, a guitar in the dark,", "Strangers trading stories like a spark", "(whispered) No signal... just us..."]],
      [25.67, 46.21, ["Same-same-same sky,", "Same-same-same sky,", "Nobody knows, nobody knows,", "But we-we-we're still here"]],
      [46.21, 77.02, ["We're all on the same wi-fi,", "Different screens, same sky,", "Nobody knows what's coming,", "But we're all still here, still humming,", "Turn it off, look up high,", "Same wi-fi, same sky"]],
      [77.02, 102.69, ["Then the power went out on the whole street,", "And we found out the neighbors were sweet,", "Candles on the stairs, a guitar in the dark,", "Strangers trading stories like a spark", "(whispered) No signal... just us..."]],
      [102.69, 123.23, ["Same-same-same sky,", "Same-same-same sky,", "Nobody knows, nobody knows,", "But we-we-we're still here"]],
      [123.23, 184.84, ["We're all on the same wi-fi,", "Different screens, same sky,", "Nobody knows what's coming,", "But we're all still here, still humming,", "Turn it off, look up high,", "Same wi-fi, same sky", "(Re-re-refresh)", "Scroll, scroll, scroll,", "Who's in control?", "(Re-re-refresh)", "Scroll, scroll, scroll,", "Who's in control?"]],
      [184.84, 210.51, ["Then the power went out on the whole street,", "And we found out the neighbors were sweet,", "Candles on the stairs, a guitar in the dark,", "Strangers trading stories like a spark", "(whispered) No signal... just us..."]],
      [210.51, 231.05, ["Same-same-same sky,", "Same-same-same sky,", "Nobody knows, nobody knows,", "But we-we-we're still here"]],
      [231.05, 261.86, ["We're all on the same wi-fi,", "Different screens, same sky,", "Nobody knows what's coming,", "But we're all still here, still humming,", "Turn it off, look up high,", "Same wi-fi, same sky"]],
      [261.86, 269.88, ["(whispered) ...wait, what's the password again?"]],
    ],
  },
  {
    id: 'what-do-you-do',
    titre: "What Do You Do",
    file: 'what-do-you-do.mp3',
    duration: 267.2,
    // Sections réparties au prorata des paroles (pas de minutage fourni)
    sections: [
      [0, 4.63, ["(whispered) Good morning... your breakfast is ready... again..."]],
      [4.63, 22.42, ["The robots made my coffee and my bed,", "They paid my bills and kept the children fed,", "I learned the cello on a Tuesday at two,", "Mastered it by four, then nothing to do", "My résumé is a single empty line,", "Hobbies: breathing. Skills: doing fine."]],
      [22.42, 28.35, ["Nowhere to go, nothing to prove,", "All the time in the world and nowhere to move..."]],
      [28.35, 46.14, ["It's Sunday forever,", "Sunday every day,", "Fed and kept and safe and clever,", "Nothing left to make or pay,", "So what do you do? (what do you do?)", "What do you do with forever?"]],
      [46.14, 58.0, ["Everybody's baking bread again,", "Everybody's running marathons at ten,", "Everyone's a poet that nobody reads,", "We're drowning in hobbies and starving for needs"]],
      [58.0, 81.72, ["My grandmother worked till her hands turned to stone,", "It's Sunday forever,", "Sunday every day,", "Fed and kept and safe and clever,", "Nothing left to make or pay,", "So what do you do? (what do you do?)", "What do you do with forever?", "(whispered) Good morning... your breakfast is ready... again..."]],
      [81.72, 99.51, ["The robots made my coffee and my bed,", "They paid my bills and kept the children fed,", "I learned the cello on a Tuesday at two,", "Mastered it by four, then nothing to do", "My résumé is a single empty line,", "Hobbies: breathing. Skills: doing fine."]],
      [99.51, 105.43, ["Nowhere to go, nothing to prove,", "All the time in the world and nowhere to move..."]],
      [105.43, 123.22, ["It's Sunday forever,", "Sunday every day,", "Fed and kept and safe and clever,", "Nothing left to make or pay,", "So what do you do? (what do you do?)", "What do you do with forever?"]],
      [123.22, 135.08, ["Everybody's baking bread again,", "Everybody's running marathons at ten,", "Everyone's a poet that nobody reads,", "We're drowning in hobbies and starving for needs"]],
      [135.08, 141.01, ["My grandmother worked till her hands turned to stone,", "I've got soft little hands and a mind all alone..."]],
      [141.01, 158.8, ["It's Sunday forever,", "Sunday every day,", "Fed and kept and safe and clever,", "Nothing left to make or pay,", "So what do you do? (what do you do?)", "What do you do with forever?"]],
      [158.8, 164.73, ["Do... some... thing...", "Feel... some... thing..."]],
      [164.73, 182.52, ["Do... some... thing...", "Feel... some... thing...", "(Use-use-useful)", "(Use-use-useless)", "Do something, feel something,", "Tell me I'm worth something"]],
      [182.52, 194.38, ["Then the kid next door fell off her bike,", "I fixed her knee, she asked me what the stars are like,", "We stayed up counting till the sky went grey,", "First time in years I didn't count the day"]],
      [194.38, 203.27, ["It's Sunday forever,", "So what do you do? (what do you do?)", "What do you do with forever?"]],
      [203.27, 209.2, ["Do... some... thing...", "Feel... some... thing..."]],
      [209.2, 229.96, ["It's Sunday forever,", "Sunday every day,", "Fed and kept and safe and clever,", "Nothing left to make or pay,", "So what do you do? (what do you do?)", "What do you do with forever?", "(whispered) Nobody pays me... and that's okay..."]],
      [229.96, 241.81, ["What-what-what do you do?", "What-what-what do you do?", "Nobody needs me, so I choose,", "I-I-I choose you"]],
      [241.81, 262.57, ["It's Sunday forever,", "Sunday every day,", "Fed and kept and safe and clever,", "So we make our own way,", "What do you do? (what do you do?)", "What do you do with forever?", "Spend it together"]],
      [262.57, 267.2, ["(whispered) ...so... what do you want to do today?"]],
    ],
  },
  {
    id: 'hello-human',
    titre: "Hello Human",
    file: 'hello-human.mp3',
    duration: 343.96,
    // Sections réparties au prorata des paroles (pas de minutage fourni)
    sections: [

    ],
  },
  {
    id: 'mind-the-gap',
    titre: "Mind the Gap",
    file: 'mind-the-gap.mp3',
    duration: 252.16,
    // Sections réparties au prorata des paroles (pas de minutage fourni)
    sections: [
      [0, 17.97, ["Mind-mind-mind the gap,", "Hold-hold-hold my hand,", "Nobody crosses alone,", "We-we-we cross it together"]],
      [17.97, 44.93, ["Mind the gap,", "Between the old world and the new,", "Mind the gap,", "If the train is late, I'll wait with you,", "Hold on, hold on,", "Mind the gap"]],
      [44.93, 80.87, ["Mind the gap,", "Between the old world and the new,", "Mind the gap,", "If the train is late, I'll wait with you,", "Hold on, hold on,", "Mind the gap", "Hold on, hold on,", "Mind the gap"]],
      [80.87, 87.89, ["(whispered) ...the next train to abundance is delayed... please hold hands."]],
      [87.89, 105.86, ["Maybe the bridge isn't steel or code,", "Maybe it's strangers sharing the load,", "Don't throw stones at the ones going down,", "Next year it's you on the other side of town"]],
      [105.86, 168.76, ["Mind the gap,", "Between the old world and the new,", "Mind the gap,", "If the train is late, I'll wait with you,", "Hold on, hold on,", "Mind the gap", "Hold on, hold on,", "Mind the gap", "(Hold-hold-hold on)", "Speed it up before we break,", "Slow it down for heaven's sake", "(Hold-hold-hold on)", "Speed it up before we break,", "Slow it down for heaven's sake"]],
      [168.76, 191.23, ["Maybe the bridge isn't steel or code,", "Maybe it's strangers sharing the load,", "Don't throw stones at the ones going down,", "Next year it's you on the other side of town", "(whispered) Pass it on... pass it on..."]],
      [191.23, 209.2, ["Mind-mind-mind the gap,", "Hold-hold-hold my hand,", "Nobody crosses alone,", "We-we-we cross it together"]],
      [209.2, 245.14, ["Mind the gap,", "Mind the gap,", "Between the old world and the new,", "Mind the gap,", "Mind the gap,", "If the train is late, I'll wait with you,", "Hold on, hold on,", "Mind the gap"]],
      [245.14, 252.16, ["(whispered) ...the next train to abundance is delayed... please hold hands."]],
    ],
  },
];
