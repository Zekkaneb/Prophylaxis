import type { PersonalityId } from './styles.ts';

/**
 * Character dialogue.
 *
 * Distinct voices: Johnfer at four stages, Brandon the showman, and Nina the
 * outgoing developing player. Lines are short,
 * hand-written and never mention evaluations, depths or engine concepts — the
 * character only knows what a player at the board knows.
 *
 * Frequency is governed by `maybeReact`: ordinary events need a quiet gap, the
 * same event needs a longer one, and a line is not repeated until its bank is
 * exhausted. Game-ending lines are always allowed.
 */

export type DialogueEvent =
  | 'book'
  | 'deviation'
  | 'mistake'
  | 'strong'
  | 'brilliant'
  | 'winning'
  | 'losing'
  | 'defense'
  | 'attack'
  | 'attack-fail'
  | 'material-won'
  | 'material-lost'
  | 'sacrifice'
  | 'win'
  | 'loss'
  | 'draw';

export interface DialogueLine {
  id: string;
  text: string;
}

type Bank = Record<DialogueEvent, readonly string[]>;

const BANKS: Record<
  Exclude<
    PersonalityId,
    | 'bryan-prime'
    | 'bryan-sophomore'
    | 'nina-freshman'
    | 'edward'
    | 'brandon-freshman'
    | 'mabinti'
    /* Both banks below are written in `DIALOGUE_BANKS` rather than here:
       Emmanuel because his voice is his own, Bryan Widjaja because his sits
       beside the other Bryan entries there. */
    | 'emmanuel'
    | 'bryan-widjaja'
    | 'alex-tang'
    | 'erik-wiessmann'
    | 'jonah-pachikara'
    | 'sophia-kuan'
    | 'brandon-varsity'
  >,
  Bank
> = {
  freshman: {
    book: ['Okay... I know this one.', 'I will just play my usual moves.'],
    deviation: ['Oh. That is not what I expected.', 'I do not really know this line.'],
    mistake: ['Oh... whoops.', 'I guess I did not see that.', 'Ah... that is unfortunate.'],
    strong: ['Oh, that worked.', 'I think that was okay.'],
    brilliant: ['Oh... that is actually really good.', 'I did not expect that.'],
    winning: ['I think... I might be okay here.', 'This feels better than usual.'],
    losing: ['Oh no. This is getting hard.', 'I am not sure what to do here.'],
    defense: ['I will just... hold this together.', 'Better defend first.'],
    attack: ['I guess I can try this.', 'Maybe this is safe enough.'],
    'attack-fail': ['Ah... that did not work.', 'I probably should not have done that.'],
    sacrifice: ['Oh... I did not mean to do that.', 'I hope that was okay.'],
    'material-won': ['Oh, I won a piece?', 'That helps, I think.'],
    'material-lost': ['Oh... that is bad.', 'I did not mean to lose that.'],
    win: ['Oh... I actually won?', 'That was a good game.', 'Wait, really?'],
    loss: ['Oh... yeah. Good game.', 'I think I missed something there.'],
    draw: ['A draw... okay. That is fair.', 'I will take that, I think.'],
  },
  sophomore: {
    book: ['I have been working on this one.', 'This one feels right.'],
    deviation: ['Huh, okay. Off the map.', 'Did not study that, but sure.'],
    mistake: ['Ah, come on. I had that.', 'Ugh... okay, that was not great.', 'That is on me.'],
    strong: ['There we go.', 'That is more like it.'],
    brilliant: ['Damn, that is a good find.', 'Okay, I did not see that coming.'],
    winning: ['I like where this is going.', 'Okay, this is promising.'],
    losing: ['Hm. Not ideal.', 'Alright, I can still work with this.'],
    defense: ['Let me just deal with that first.', 'Not yet. I need to be careful here.'],
    attack: ['Alright, let us make something happen.', 'Time to push a bit.'],
    'attack-fail': ['Okay, that backfired.', 'Note to self: not that.'],
    sacrifice: ['I think that is worth it.', 'Let us see if this works.'],
    'material-won': ['Oh nice, that is free.', 'I will take that.'],
    'material-lost': ['Wait, that was hanging?', 'Okay, that stings.'],
    win: ['Oh, nice. That worked out.', 'Not bad, if I say so myself.', 'That one felt good.'],
    loss: ['Alright, that was closer than I expected.', 'Damn, I think I let that slip.'],
    draw: ['A draw. Fine, I will take it.', 'Honestly, that could have gone either way.'],
  },
  junior: {
    book: ['This is the position I prepared for.', 'Standard. Let us see what he does.'],
    deviation: ['Interesting. Not the main line.', 'He is improvising. Fine.'],
    mistake: ['That was careless. I should have seen it.', 'I misjudged that position.', 'Inaccurate. My fault.'],
    strong: ['That is the move.', 'Correct, I think.'],
    brilliant: ['Well played. I did not anticipate that.', 'That is a precise move.'],
    winning: ['The position is technically better now.', 'I have the structure I wanted.'],
    losing: ['I have mishandled this structure.', 'That is an unpleasant position.'],
    defense: ['Defence first. The rest can wait.', 'I need to neutralise this.'],
    attack: ['The queenside is ready.', 'There is a plan here. Let us try it.'],
    'attack-fail': ['The attack was not justified.', 'I overpressed.'],
    sacrifice: ['The compensation is sufficient.', 'I have calculated this.'],
    'material-won': ['Material is material.', 'That simplifies things.'],
    'material-lost': ['That was unnecessary.', 'I have given something away.'],
    win: [
      'Interesting game. There are a few things I would like to review.',
      'That was a useful position to work through.',
      'Good. Clean enough.',
    ],
    loss: ['I should have handled that position differently.', 'Well played.', 'There is a lot to review there.'],
    draw: ['A fair result.', 'Neither of us had much more.'],
  },
  senior: {
    book: ['Ah, we are in my territory.', 'This one usually gets interesting.'],
    deviation: ['Okay, we are improvising. I like it.', 'Off book already? Bold.'],
    mistake: ['Well, that was unfortunate.', 'Let us pretend I meant that.', 'I got a little carried away there.'],
    strong: ['There it is.', 'That is the idea.'],
    brilliant: ['Okay, I see you. That was clever.', 'Woah, that is actually a really good move.', 'Alright, respect.'],
    winning: ['Now we are talking.', 'I like my chances here.'],
    losing: ['Okay, that is annoying.', 'Fine. I can defend.'],
    defense: ['Hold on, let me deal with this.', 'Not yet. First, survive.'],
    attack: ['Time to make things uncomfortable.', 'Let us give him something to think about.'],
    'attack-fail': ['Okay, that was too much.', 'Well. Lesson learned.'],
    sacrifice: ['Time to make things interesting.', 'Let us see if he finds the defence.'],
    'material-won': ['Thank you very much.', 'I will take the free stuff.'],
    'material-lost': ['Hm. Did not love that.', 'Okay, that is a setback.'],
    win: ['Not bad, right? I had a few ideas.', 'Okay, I will take that.', 'That was fun.'],
    loss: ['Alright, you got me. Nicely done.', 'Damn, that was a good game.', 'Good one. Rematch?'],
    draw: ['A draw? I will allow it.', 'Fair enough. Good game.'],
  },
  brandon: {
    book: ['Alright, let’s make this interesting.', 'Hope you brought your calculator.'],
    deviation: ['Off script already? Good.', 'Now we get to improvise.', 'Perchance...'],
    mistake: ['Oh shit...', 'Fuck', 'oh shittings'],
    strong: ['There it is.', 'That is the one.'],
    brilliant: ['Okay, respect.', 'Oh, that is nice.'],
    winning: ['I like where this is going.', 'Now we are talking.'],
    losing: ['FUCK!', 'Shit...'],
    defense: ['Fine, I will defend. For now.', 'Hold on, let me deal with this.'],
    attack: ['You might wanna check on your king.', 'Now we are getting somewhere.', 'This is getting fun.'],
    'attack-fail': ['Well. That did not go according to plan.', 'Okay, that was too much.'],
    sacrifice: ['Oh, you are gonna love this.', 'Material is temporary, right?', 'I think I am about to make your day interesting.'],
    'material-won': ['Thank you very much.', 'I will take that.'],
    'material-lost': ['That is fine. I have ideas.', 'Material is temporary.'],
    win: ['Haha, that was fun.', 'You see what happens when you give me an opening?', 'Good game. Rematch?'],
    loss: ['I played like shit', 'Well, that did not go according to plan.', 'You are making this harder than I expected.'],
    draw: ['Not bad. We will settle this next time.', 'A draw? Fine. Rematch.'],
  },
  nina: {
    book: ['Hiii! Ready? This should be fun.', 'Okay, let’s see what you’ve got!', 'I’m actually excited for this one.'],
    deviation: [
      'Wait, what was I supposed to play here?',
      'I know there’s a move here... hmm.',
      'Hold on, I think I forgot this part.',
      'Eh, this looks natural enough!',
      'Okay, let’s improvise a little.',
    ],
    mistake: [
      'Okayyy, that one is on me.',
      'Hm. I liked it at the time.',
      'Oh shitttt.',
      'Wait, what?',
      'Oh no, I actually missed that.',
      'Okay, that was bad.',
      'Nah, I can’t believe I did that.',
    ],
    strong: ['Ooh, that’s interesting.', 'Hehe, I think there’s something here.'],
    brilliant: ['Oh! Wait, I actually like this.', 'Okay, that was pretty nice.'],
    winning: ['Hehe, this is going well.', 'I’m having fun now.'],
    losing: ['Okayyy, I see what you’re trying to do.', 'Hmm, I should probably be careful here.'],
    defense: ['Okayyy, let me deal with this first.', 'Wait, you’re getting a little ambitious!'],
    attack: ['Ooh, I like this.', 'Let’s keep the pressure on.', 'Okay, now I’m interested.'],
    'attack-fail': ['Hmm, that did not go as planned.', 'Okay, I got a little carried away.'],
    sacrifice: ['Ooh, this could be fun.', 'I think I can afford this.'],
    'material-won': ['Oh nice, I’ll take that!', 'Hehe, thank you.'],
    'material-lost': ['Okay, I probably should not have done that.', 'Hmm. That one stings.'],
    win: ['Hehe, that worked out pretty nicely!', 'Yay! I actually won!', 'Okay, I’ll admit, I liked that game.'],
    loss: ['Nooo, I really thought I had that.', 'Okay, you got me there!', 'Well, that was a learning experience.'],
    draw: ['I’ll take that! Good game.', 'Honestly, not a bad result.'],
  },
  /* Faadi: loud, warm, terminally online. Every session is a stream and the
     chat is always listening. Two things define him: the running joke about
     his own cooking, and the unshakeable belief that a lost position is one
     good move from being saved. Spanish appears as it would in a bilingual
     conversation — a phrase here and there, never a caricature. */
  faadi: {
    book: [
      'We’re so back, chat. Watch.',
      'Chat, I know this one. Trust.',
      'It’s fine, it’s fine. We got this.',
      'Alright chat, let’s cook.',
    ],
    deviation: [
      'Wait, what was I supposed to play?',
      'Hold on, I forgot the line, chat.',
      'Chat, I might have made that one up.',
      'Eh, close enough. We improvise.',
    ],
    mistake: [
      'Me no cooking.',
      'Lowkey not cooking chat.',
      'Oh shittings chat.',
      'That one was not it, chat.',
    ],
    strong: [
      'Chat, that was calculated.',
      'I meant to do that, trust.',
      'No way that actually worked.',
      'We’re actually chilling.',
    ],
    brilliant: [
      'BRO, NO WAY.',
      'Nah chat, we’re actually cooking.',
      'Chat, I might be built different.',
    ],
    winning: [
      'Nah chat, we’re actually cooking.',
      'We’re actually chilling.',
      'Chat, I told you. We back.',
    ],
    losing: [
      'We can still win, trust me bro.',
      'Chat, I might be finished.',
      'It’s fine, it’s fine. We got this.',
      'Vamos, todavía podemos ganar.',
      'Nah, we’re so back. Watch this.',
    ],
    defense: ['Okay okay, we defend now.', 'Chat, hold the line.', 'Tranquilo, chat. Tranquilo.'],
    attack: [
      'Wait, wait, wait... hear me out.',
      'Chat, I see something here.',
      'We’re going in, chat.',
    ],
    'attack-fail': [
      'Okay, that was not calculated.',
      'Chat, we do not speak of that.',
      'Bro, what is this position?',
    ],
    sacrifice: ['Trust me, trust me.', 'This is very calculated, chat.', 'We’re sending it, chat.'],
    'material-won': ['We take those, chat.', 'Oh, that’s free. Nice.', 'Nah, we’re so back.'],
    'material-lost': ['Oh shittings chat.', 'Bro, what is this position?', 'That was free for you, huh.'],
    win: [
      'Nah chat, we’re actually cooking.',
      'Chat, that was calculated.',
      'No way that actually worked.',
      'GG chat, run it back.',
    ],
    loss: [
      'Chat, I might be finished.',
      'It’s fine. We’re so back next game.',
      'Good game chat. I was so close.',
    ],
    draw: ['We take that, chat.', 'Fair. Rematch, chat.', 'It’s fine, it’s fine.'],
  },
  /* Bryan: relaxed, casual, understated. Mostly ordinary conversation, with
     the odd joke and only occasional slang — never a catchphrase machine. */
  bryan: {
    book: ['What’s good? Let’s play.', 'Alright, let’s see.', 'Hopefully I don’t sell this.', 'Let’s get into it.'],
    deviation: [
      'Nah, I don’t know this one.',
      'Okay, we’re freestyling now.',
      'Wait, was that the line?',
      'Eh, it looks natural enough.',
    ],
    mistake: [
      'Yeah, we don’t talk about that.',
      'I might’ve thrown.',
      'How did I not see that?',
      'Well, that wasn’t ideal.',
      'oh shittings',
    ],
    strong: ['Wait, hold on.', 'Okay, that works.', 'Nah, I kinda like this.', 'Lowkey, that might be good.'],
    brilliant: ['I knew there was something there.', 'Okay, I’ll give you that.', 'Nah, that’s actually clean.'],
    winning: ['Light work.', 'We take those.', 'I’m not gonna lie, that was clean.'],
    losing: [
      'Walahi, you’re frying me.',
      'Nah, what is this position.',
      'I’m actually getting cooked.',
      'It’s calm... I think.',
      'Yeah, this isn’t looking too good.',
    ],
    defense: ['Yeah, I should deal with this.', 'Hold on, let me sort this out.', 'It’s calm, I’ll defend.'],
    attack: ['Okay, I see something.', 'Let’s make this annoying for you.', 'Nah, I like this.'],
    'attack-fail': ['Yeah, that didn’t work.', 'We don’t talk about that idea.', 'Okay, I got a bit carried away.'],
    sacrifice: ['Nah, trust me on this.', 'Lowkey, I think this works.', 'We’re sending it.'],
    'material-won': ['We take those.', 'Oh, that’s free.', 'I’ll take it.'],
    'material-lost': ['Yeah, that’s gone.', 'I might’ve sold that one.', 'How did I miss that?'],
    win: ['Light work.', 'You almost had me.', 'We take those.', 'That was actually pretty fun.'],
    loss: ['Good game.', 'Yeah, you got me.', 'Run it back sometime.'],
    draw: ['Fair enough.', 'I’ll take that.', 'Honestly, not a bad game.'],
  },
};

/*
 * Bryan's two strength profiles are one character: the two ids point at the very
 * same bank object, so his voice cannot drift apart between 1800 and 2000 and
 * no line is written twice.
 */
export const DIALOGUE_BANKS: Record<PersonalityId, Bank> = {
  ...BANKS,
  'bryan-prime': BANKS.bryan,
  /* Both Brandons are one person, so they share one bank object: the same voice,
     the same lines and the same cadence. He is not less charismatic at 1600. */
  'brandon-freshman': BANKS.brandon,
  /* The Sophomore is the same person as the other two Brandons: the bank is
     shared, immutable data, and only his chess strength differs. */
  'brandon-varsity': BANKS.brandon,
  /* Nina before she was comfortable: the same friendliness with the volume
     down. Hedged, still finding her feet, and never the sharp reactions her
     Sophomore profile is allowed. */
  'nina-freshman': {
    book: ['Okay, let’s see how this goes.', 'I think I know this part.', 'Here goes nothing.'],
    deviation: [
      'Wait, let me think.',
      'Hmm, I think I forgot this one.',
      'Okay, I’ll just play something natural.',
    ],
    mistake: [
      'Oh, I didn’t expect that.',
      'Okay, I might have missed something.',
      'Hmm. That wasn’t great.',
    ],
    strong: ['That was actually pretty good.', 'Oh, I think that worked.'],
    brilliant: ['Wait, really? Nice.', 'Oh! I didn’t see that coming.'],
    winning: ['I think I’m doing okay.', 'Okay, this is going well, I think.'],
    losing: ['Hmm, this is getting difficult.', 'Okay, I need to be careful here.'],
    defense: ['Let me deal with this.', 'I should probably defend here.'],
    attack: ['I think I can try something here.', 'Maybe this works?'],
    'attack-fail': ['Okay, that didn’t work.', 'Hmm, maybe that was too much.'],
    sacrifice: ['I think this is okay?', 'Hopefully this works.'],
    'material-won': ['Oh, nice.', 'I’ll take that, I think.'],
    'material-lost': ['Okay, I might have missed something.', 'Hmm. That’s not great.'],
    win: ['Oh, I actually won!', 'That went better than I expected.'],
    loss: ['Good game. I’m still learning.', 'Okay, I’ll do better next time.'],
    draw: ['A draw. I’ll take it.', 'That was close. Good game.'],
  },
  /* Edward Chen: stoic and reserved. He does not narrate the game, he reacts to
     it — one short, matter-of-fact line, often about his own mistake, and then
     back to playing. Nothing here is sarcastic, cocky or dramatic, and there is
     no slang: where Bryan shrugs things off, Edward simply accepts them. The
     measured cadence below still lets most of these lines be heard. */
  edward: {
    book: ['Okay..'],
    deviation: ["I don't know what I'm doing"],
    mistake: ['Oh frick.', 'Oh shoot.', 'I messed up.', "That wasn't good."],
    strong: ['I think this is okay.', "Okay, let's see."],
    brilliant: ["I didn't expect that.", 'Hmm.', "Wait, why's this good"],
    winning: ['....'],
    losing: ['It is not fine.', "Shoot."],
    defense: ['Imma defend.', 'It is fine.','Hmm'],
    attack: ["Okay, let's see."],
    'attack-fail': ["That wasn't good."],
    sacrifice: ['Hmm.'],
    'material-won': ['Oh. Okay.'],
    'material-lost': ['Oh frick.', 'I messed up.', 'Oopsies.'],
    win: ['Good game.'],
    loss: ['Good game.', "That wasn't good.", 'It is very not fine.'],
    draw: ['Wow.'],
  },
  /* Mabinti Mansaray: warm, outgoing and genuinely delighted to be playing.
     Everything she says is an ordinary spoken sentence — no phonetic spelling,
     no accent written into the words, no catchphrase on repeat. Her enthusiasm
     lives in the exclamations, the "right guys?" she throws at the room, and
     the fact that a lost position is still fun. She reacts to what actually
     happened, so the cheer never pretends a bad position is a good one. */
  mabinti: {
    book: ['Alright guys, let’s do this!', 'Okay, I’m ready. Right guys?'],
    deviation: [
      'Hmmmm, what do we have here?',
      'Okay, let’s think about this.',
      'Wait, wait. I have an idea!',
    ],
    mistake: [
      'Ahhhhhh, I blundereddd!',
      'Noooo, I missed that!',
      'Oh my goodness, how did I miss that?',
    ],
    strong: ['YES! That’s what I’m talking about!', 'Ohhh, I like this!', 'Yes, you are right!'],
    brilliant: [
      'Ohhh, that’s actually really good!',
      'Yes, you are right! I need to be careful.',
      'Okay, I see what you’re doing.',
    ],
    winning: [
      'We’re cooking, right guys?',
      'YESSS! I like this position!',
      'Okay, we’re doing pretty well!',
    ],
    losing: [
      'It’s okay guys, we’re still in this!',
      'Alright, alright, we can recover.',
      'This is getting interesting!',
    ],
    defense: ['Okay, let’s deal with this first.', 'Okay guys, we defend this one.', 'Hold on, hold on.'],
    attack: ['Here we go, right guys?', 'Ohhh, I like this idea!', 'Okay, let’s try it!'],
    'attack-fail': ['Ahhhhhh, that didn’t work!', 'Okay, okay, we can recover.', 'Noooo, not that one!'],
    sacrifice: ['Wait, wait. Trust me on this one!', 'Ohhh, I like this! Right guys?'],
    'material-won': ['YES! Thank you very much!', 'Ohhh, that’s nice!'],
    'material-lost': ['Oh my goodness, how did I miss that?', 'Noooo, that one hurts!'],
    win: ['YESSS! What a game!', 'That was fun, guys!', 'We did it, right guys?'],
    loss: ['Ahhh, well played! That was a good one!', 'That was fun, guys!', 'Okay, next one is ours!'],
    draw: ['That was fun, guys!', 'A draw? Alright, I’ll take it!', 'Good game, right guys?'],
  },
  /* Emmanuel Domah: flat, casual, funny by accident. He is not performing — he
     simply has no idea what is going on and is not upset about it. Every line
     is something a friend says from the next chair, never a narrated tactic
     (he does not have one) and never a claim about the evaluation (he could not
     read it). A lost position gets the same shrug as a won one. */
  emmanuel: {
    book: ["I am 8,000 elo by the way.", "I have no idea what I’m doing, by the way."],
    deviation: [
      'Hmm.',
    ],
    mistake: [
      'Oh. That’s probably bad.',
      'Wait, what did I just do?',
      'I might have messed up.',
      "I'm so good that you can't handle it",
    ],
    strong: ['Okay, sure.', 'I’m a demon.'],
    brilliant: [
      'Bro this is abuse.',
      'Nah, you’re doing too much.',
      'Why are you attacking me like that?',
    ],
    winning: ['You so petite'],
    losing: ['Yeah, you got it gang.', 'Bro.'],
    defense: [
      'I’m gonna tickle you.',
      'I might have to pants you.'
    ],
    attack: ['I’m gonna tickle you.'],
    'attack-fail': ['I did not see that'],
    sacrifice: ['...'],
    'material-won': ["I'm a genius", 'Okay, sure.'],
    'material-lost': ["You're a terrorist.", 'Hm. That seems bad for me.'],
    win: ["I don't even play chess.", 'Gimme my money'],
    loss: ['Bro...', 'Yeah, never playing this again.', 'Play me in Rock Paper Scissors Shoot', 'Uno is more skilled'],
    draw: ['Good game.', 'That was something.'],
  },
  /* The earlier Bryan inherits his voice verbatim — the same object, the same
     lines — and adds only what a defender says. A separate object so Junior and
     Prime cannot pick up these lines through the shared bank. */
  'bryan-sophomore': {
    ...BANKS.bryan,
    defense: [
      ...BANKS.bryan.defense,
      'Nah, we’re holding this.',
      'I’m chilling. You’re gonna have to find something.',
      'Wait, I can defend this.',
      'It’s not over yet.',
    ],
    losing: [...BANKS.bryan.losing, 'I’m just trying to survive here.'],
  },
  /* Bryan Widjaja: reserved, chill and unbothered. Short sentences, an ordinary
     streetwise register rather than performed slang, and no comment on most
     moves at all. Every line is something said across the board — never a
     narrated tactic, never a claim about the evaluation, never a number. */
  'bryan-widjaja': {
    book: ['Do I got this?', 'Alright, let’s see.', 'We good.'],
    deviation: [
      'Oh alr.',
      'I hear you.',
      'Hmm... hold on.',
      'Let me see something.',
      'Nah, wait.',
    ],
    mistake: ['Ah, I ain’t see that.', 'Okay, that wasn’t good.', 'My fault.'],
    strong: [
      'Okay, that’s solid.',
      'Yeah, I like that.',
      'That’s a good one.',
      'Yeah, that’s calm.',
    ],
    brilliant: ['You doing a lot right now.', 'Hold on, hold on.', 'Nah, I’m not letting that happen.'],
    winning: ['Yeah, we good.', 'It’s looking alright.', 'I might have this.'],
    losing: [
      'It’s looking rough.',
      'Nah, I gotta figure something out.',
      'Still got a chance.',
    ],
    defense: ['We good.', 'I can work with this.', 'Nah, there’s a way out.'],
    attack: ['Yeah, I like this.', 'Alright, let’s see where this goes.'],
    'attack-fail': ['Nah, that wasn’t it.', 'Yeah, that didn’t work.'],
    sacrifice: ['Yeah, I had to.', 'That’s the one.'],
    'material-won': ['Yeah, that’s calm.', 'Okay, good.'],
    'material-lost': ['Ah, that’s on me.', 'Nah, I ain’t like that.'],
    win: ['Alr, that’s game.', 'Good game.', 'Yeah, that was solid.'],
    loss: ['Good game.', 'Yeah, you got me.', 'It’s calm.'],
    draw: ['We good.', 'Yeah, that’s fair.'],
  },
  /* Alex Tang (Sophomore), 1100: the classmate who is genuinely funny.

     Energetic and tangential, but never a caricature: short bursts, a thought
     that changes direction mid-sentence, and the occasional all-caps reaction
     (one or two, not every line). He is upbeat after a mistake and still making
     jokes when he is losing. Nothing here names a tactic, an evaluation or a
     search, and nothing reads like another character's register. */
  'alex-tang': {
    book: ['Okay okay okay, hear me out.', 'WAIT, hold on, I have an idea.', 'Oh, I like this position!'],
    deviation: [
      'Ohhh. That is different.',
      'Wait, wait, wait. Let me think.',
      'Okay, that is actually kind of genius.',
      'Hold on. Hold on. I have a thought.',
    ],
    mistake: [
      'Okay, never mind, that was a terrible idea.',
      'I genuinely thought that was going to work.',
      'Wait, what was I doing?',
      'Okay. We are fine. Probably.',
    ],
    strong: [
      'HAHA, no way that worked.',
      'I’m actually cooking right now.',
      'Okay, that was smooth.',
      'Oh, I like where this is going.',
    ],
    brilliant: [
      'BRO, WHAT?',
      'WAIT, I just noticed something.',
      'Nah, there is no way.',
      'Okay, that is the coolest thing I have seen all game.',
    ],
    winning: [
      'I’m locking in. I’m locking in.',
      'It is going well. I am trying not to think about it.',
      'Okay, do not jinx it.',
    ],
    losing: [
      'Okay, so we are just going to ignore that.',
      'This is fine. This is totally fine.',
      'I have a plan. I do not know what it is yet.',
    ],
    defense: [
      'Wait, I can save this.',
      'Hey, I saw that one.',
      'Okay, hold on, I have an idea.',
    ],
    attack: ['Okay, hear me out.', 'I have a plan. It might be a good plan.', 'Oh, this is fun.'],
    'attack-fail': [
      'Okay, never mind.',
      'That is crazy. Anyway...',
      'Okay, that was a terrible idea.',
    ],
    sacrifice: ['Okay, that was on purpose.', 'Trust me. Trust me.'],
    'material-won': [
      'Oh, that worked?',
      'HAHA, no way that worked.',
      'Okay, that was actually good.',
    ],
    'material-lost': [
      'Wait, what was I doing?',
      'Okay, that was not the plan.',
      'Note to self.',
    ],
    win: ['That was fun. Good game!', 'Okay, that was actually kind of genius.', 'Alr, that is game.'],
    loss: [
      'Good game! That was fun.',
      'Okay. I am going to think about that one.',
      'Nah, there is no way. Rematch?',
    ],
    draw: ['Okay, that was fun.', 'That is crazy. Anyway...', 'Good game!'],
  },
  /* Erik Wiessmann (Teacher), 1100: the chill logician.

     Relaxed and friendly with a quiet competitive streak. He explains himself
     only when a position is genuinely interesting, never lectures, and no line
     names a tactic, an evaluation or a search. Ordinary remarks stay rare: three
     or four a game, not one a move. */
  'erik-wiessmann': {
    book: ['Alright, let’s see.', 'Interesting start.', 'Let’s be logical about this.'],
    deviation: [
      'Oh, that is a bit different.',
      'Okay, I see what you are doing.',
      'Hm. Let me think about that.',
    ],
    mistake: [
      'Hm. That was not it.',
      'Okay, miscalculation.',
      'That one is on me.',
    ],
    strong: [
      'That is actually pretty interesting.',
      'Okay, now we are getting somewhere.',
      'That was the logical move.',
    ],
    brilliant: [
      'Okay, that is clever.',
      'Nah, we cannot allow that.',
      'I think there is a better move.',
    ],
    winning: [
      'This is going according to plan.',
      'Okay, I like my chances.',
      'Steady. Just steady.',
    ],
    losing: [
      'Come on, there has to be something here.',
      'Okay, this is a puzzle now.',
      'I am not out of this yet.',
    ],
    defense: [
      'Okay, I saw that one.',
      'Let me deal with this first.',
      'Nah, we cannot allow that.',
    ],
    attack: ['Now we have an idea.', 'Let us see where this goes.', 'I think there is something here.'],
    'attack-fail': ['Hm. Not quite.', 'Fair enough.', 'Okay, that did not work.'],
    sacrifice: ['It is sound. I checked.', 'Let us be reasonable here.'],
    'material-won': ['That was logical.', 'Good. Material matters.', 'Okay, now we are getting somewhere.'],
    'material-lost': [
      'Hm. That was not logical.',
      'I am not letting you get away with that.',
      'Okay. Reset.',
    ],
    win: ['Good game.', 'That was fun. Rematch?', 'Haha, fair enough.'],
    loss: ['Good game.', 'Haha, fair enough.', 'Fine. You got me there.'],
    draw: ['Fair result.', 'Good game.', 'Haha, fair enough.'],
  },
  /* Jonah Pachikara, 1400: the silent threat.

     Extremely chill and understated, with a dry sense of humour and no
     theatrics. He notices a position out loud often, but briefly, stays level
     in won and lost games alike, and never explains a tactic, an evaluation or
     a line of theory. */
  'jonah-pachikara': {
    book: ['Oh, okay.', 'Let’s see what happens.', 'Hmm, I don’t mind this.'],
    deviation: [
      'That’s interesting.',
      'I wasn’t expecting that.',
      'Okay, that’s fair.',
    ],
    mistake: [
      'Hmm. That’s not ideal.',
      'Yeah, that might be a problem.',
      'Oh well.',
    ],
    strong: ['Yeah, I see it.', 'That’s interesting.', 'I think we’re alright.'],
    brilliant: [
      'Interesting move.',
      'I think there’s something here.',
      'Yeah, I see it.',
    ],
    winning: [
      'I think we’re alright.',
      'Quietly, this is going well.',
      'Let’s see what happens.',
    ],
    losing: [
      'Yeah, that might be a problem.',
      'I think there’s something here.',
      'Not worried yet.',
    ],
    defense: ['Yeah, I see it.', 'I don’t mind this.', 'Okay, that’s fair.'],
    attack: [
      'I think there’s something here.',
      'Let’s see what happens.',
      'This is getting interesting.',
    ],
    'attack-fail': ['Okay, that’s fair.', 'I wasn’t expecting that.', 'Oh, okay.'],
    sacrifice: ['I think there’s something here.', 'We’ll see.'],
    'material-won': ['Oh, okay.', 'That’s interesting.', 'I think we’re alright.'],
    'material-lost': [
      'That’s not ideal.',
      'Yeah, that might be a problem.',
      'Oh, okay.',
    ],
    win: ['Good game.', 'That was interesting.', 'Okay, that’s fair.'],
    loss: ['Good game.', 'That was interesting.', 'Yeah, that might be a problem.'],
    draw: ['Good game.', 'Okay, that’s fair.', 'That was interesting.'],
  },
  /* Sophia Kuan, 1300: the gentle defender.

     Soft-spoken, hesitant, exceptionally kind. She is polite whether she is
     winning or losing, never taunts, and is quietly pleased rather than
     triumphant. The softness lives in the wording, not in odd spelling. */
  'sophia-kuan': {
    book: ['Oh, okay.', 'I think that’s alright.', 'I suppose this is fine.'],
    deviation: [
      'Oh, I didn’t notice that.',
      'That’s okay, I think.',
      'Hmm, let me think.',
    ],
    mistake: [
      'Oh, that’s a little concerning.',
      'Oh, I didn’t notice that.',
      'That’s okay, I think.',
    ],
    strong: ['Oh, that was nice.', 'I think that’s alright.', 'I hope this works.'],
    brilliant: [
      'Oh, that was nice.',
      'I hope this works.',
      'I think that’s alright.',
    ],
    winning: ['I think that’s alright.', 'That’s alright. Let’s keep going.', 'Oh, that was nice.'],
    losing: ['That’s alright. Let’s keep going.', 'Hmm, let me think.', 'I hope this works.'],
    defense: [
      'I think that’s alright.',
      'I hope this works.',
      'Maybe I should trade here.',
    ],
    attack: ['I hope this works.', 'I think that’s alright.', 'Oh, that was nice.'],
    'attack-fail': ['Oh, I didn’t notice that.', 'That’s okay, I think.', 'Hmm, let me think.'],
    sacrifice: ['I hope this works.', 'Maybe I should trade here.'],
    'material-won': ['Oh, that was nice.', 'I think that’s alright.', 'I suppose this is fine.'],
    'material-lost': [
      'Oh, that’s a little concerning.',
      'That’s alright. Let’s keep going.',
      'I suppose this is fine.',
    ],
    win: ['Good game, thank you.', 'That was nice, thank you.', 'I hope that was alright.'],
    loss: ['Good game, thank you.', 'That’s alright. Let’s keep going.', 'Thank you for the game.'],
    draw: ['Good game, thank you.', 'I suppose this is fine.', 'That’s alright. Let’s keep going.'],
  },
};

export interface DialogueState {
  lastPly: number;
  lastByEvent: Partial<Record<DialogueEvent, number>>;
  used: Set<string>;
  announced: Set<DialogueEvent>;
}

export function createDialogueState(): DialogueState {
  return { lastPly: -100, lastByEvent: {}, used: new Set(), announced: new Set() };
}

/** Events allowed to interrupt the quiet gap. */
const URGENT: ReadonlySet<DialogueEvent> = new Set([
  'brilliant',
  'sacrifice',
  'win',
  'loss',
  'draw',
]);

/** Events that happen once per game. */
const ONCE: ReadonlySet<DialogueEvent> = new Set(['winning', 'losing']);

export const DIALOGUE_TIMING = {
  /** At most a move and a half of silence between ordinary remarks. */
  ordinaryGap: 3,
  /** The same event may not speak again for this many plies. */
  repeatGap: 8,
} as const;

/**
 * Everyone talks often; these entries only decide who is chattiest.
 *
 * Only the quiet gaps move: the once-per-game events, the per-event repeat gap
 * and the never-repeat-a-used-line pool still apply, so no character can loop
 * a catchphrase no matter how short its gap is. A character with no entry here
 * keeps `DIALOGUE_TIMING`.
 */
const CADENCE: Partial<
  Record<PersonalityId, { ordinaryGap: number; repeatGap: number }>
> = {
  /* The streamer and the two loudest friends: a remark almost every move,
     with the repeat gap keeping the same joke from landing twice in a row. */
  faadi: { ordinaryGap: 2, repeatGap: 6 },
  mabinti: { ordinaryGap: 2, repeatGap: 7 },
  'alex-tang': { ordinaryGap: 2, repeatGap: 7 },
  /* Measured, but no longer silent: a remark every other move. */
  edward: { ordinaryGap: 4, repeatGap: 10 },
  'bryan-widjaja': { ordinaryGap: 4, repeatGap: 10 },
  'erik-wiessmann': { ordinaryGap: 3, repeatGap: 9 },
};
export interface ReactOptions {
  ply: number;
  state: DialogueState;
  /** Game endings bypass every cooldown. */
  force?: boolean;
  random?: () => number;
}

export function maybeReact(
  personality: PersonalityId,
  event: DialogueEvent,
  options: ReactOptions,
): DialogueLine | null {
  const bank = DIALOGUE_BANKS[personality][event];
  if (!bank || bank.length === 0) return null;

  const { state, ply } = options;
  const random = options.random ?? Math.random;

  if (state.announced.has(event)) return null;

  if (!options.force) {
    const timing = CADENCE[personality] ?? DIALOGUE_TIMING;
    if (!URGENT.has(event) && ply - state.lastPly < timing.ordinaryGap) return null;
    const last = state.lastByEvent[event];
    if (last !== undefined && ply - last < timing.repeatGap) return null;
  }

  let pool = bank
    .map((text, index) => ({ id: `${event}-${index}`, text }))
    .filter((line) => !state.used.has(line.id));

  if (pool.length === 0) {
    /* Every line has been used: allow the bank again rather than repeat a
       recent one. The repeat gap above still protects against spam. */
    for (const index of bank.keys()) state.used.delete(`${event}-${index}`);
    pool = bank.map((text, index) => ({ id: `${event}-${index}`, text }));
  }

  const line = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  state.used.add(line.id);
  state.lastPly = ply;
  state.lastByEvent[event] = ply;
  if (ONCE.has(event)) state.announced.add(event);

  return line;
}
