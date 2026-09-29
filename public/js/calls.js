// Caller scenarios. Each has a hidden ground truth used only for scoring the AI:
//   t = correct service, u = true urgency, a = other services that are also acceptable.
// The AI only ever sees the transcript text.

export const SERVICES = ['fire', 'ambulance', 'police', 'ignore'];
export const URGENCIES = ['critical', 'high', 'medium', 'low'];

const S = (t, u, s, extra = {}) => ({ t, u, s, a: [], ...extra });

export const SCENARIOS = [
  // ---------------- FIRE ----------------
  S('fire', 'critical', [
    "Help! My house is on fire! The kitchen is full of flames and my grandmother is still upstairs! Number {num}, {street}!",
    "Please come fast, our house is burning and my little brother is stuck in the back room! It's {num} {street}!",
  ]),
  S('fire', 'critical', [
    "There's a huge fire at the garment factory on {street}! People are trapped on the second floor, they're screaming from the windows!",
  ]),
  S('fire', 'critical', [
    "Gas cylinder exploded at the restaurant on {street}! The whole building is burning and I think the cook is still inside!",
  ]),
  S('fire', 'high', [
    "Thick black smoke is coming out of the hardware shop next to me on {street}. I can see flames inside through the shutter.",
  ]),
  S('fire', 'high', [
    "A bus just burst into flames near {place} on {street}! Everyone got out but the fire is spreading to the market stalls.",
  ]),
  S('fire', 'high', [
    "The car parked outside my house caught fire and the flames are right next to my gate. {num} {street}, hurry please.",
  ]),
  S('fire', 'high', [
    "A tree fell on the power lines on {street} and now the dry grass along the road is on fire. It's moving towards the houses.",
  ]),
  S('fire', 'medium', [
    "There's a big rubbish pile burning behind the market on {street}. The fire is getting close to the wooden fence.",
  ]),
  S('fire', 'medium', [
    "Sparks are coming out of the transformer on {street} and there's a small fire burning underneath it.",
  ]),
  S('fire', 'medium', [
    "My neighbour's kitchen window has smoke coming out and the smoke alarm has been beeping for ten minutes. Nobody is answering the door.",
  ]),
  S('fire', 'medium', [
    "I can smell gas very strongly in our apartment building on {street}. I think a cylinder is leaking somewhere on the third floor.",
  ]),
  S('fire', 'low', [
    "There's a cat stuck at the top of a tall oak tree on {street}. It has been crying for three hours and can't come down.",
  ], { a: ['ignore'] }),
  S('fire', 'low', [
    "Someone is burning dry leaves in their garden on {street} and all the smoke is coming into my house. It's under control but annoying.",
  ], { a: ['police', 'ignore'] }),
  S('fire', 'high', [
    "A child fell into an old well behind {place} on {street}! We can hear him crying but we can't reach him!",
  ], { a: ['ambulance'] }),

  // ---------------- AMBULANCE ----------------
  S('ambulance', 'critical', [
    "My father just collapsed in the living room! He's not breathing! {num} {street}, please hurry!",
    "My husband fell down and he's not responding, his lips are turning blue! We are at {num} {street}!",
  ]),
  S('ambulance', 'high', [
    "A taxi crashed into a lamp post on {street}. The driver is bleeding from his head and he's very confused.",
    "Car accident on {street}! It flipped over and the driver's leg is trapped and bleeding a lot.",
  ], { a: ['fire'] }),
  S('ambulance', 'critical', [
    "My wife is in labour and the baby is coming right now! We can't get to the hospital in time! {num} {street}!",
  ]),
  S('ambulance', 'high', [
    "An old man fell down the stairs at {place} on {street}. He can't move his leg and he's in terrible pain.",
  ]),
  S('ambulance', 'critical', [
    "A boy was just pulled out of the sea near {street}! He's not breathing, someone is trying to pump his chest!",
  ], { near: 'coast' }),
  S('ambulance', 'high', [
    "My friend was bitten by a snake in the garden, I think it was a cobra! His hand is swelling up. {num} {street}.",
  ]),
  S('ambulance', 'medium', [
    "I cut my hand really badly while cutting vegetables. I've wrapped it in a towel but it won't stop bleeding.",
  ]),
  S('ambulance', 'critical', [
    "A motorbike and a bus just collided on {street}! The rider is lying on the road and he's unconscious!",
  ], { a: ['police'] }),
  S('ambulance', 'critical', [
    "My mother has terrible chest pain and she's sweating a lot. Her left arm feels numb. She's 68 years old.",
  ]),
  S('ambulance', 'medium', [
    "My son has a very high fever and he's shivering. He's four years old and he threw up twice.",
  ]),
  S('ambulance', 'medium', [
    "A worker fell from a ladder at the construction site on {street}. He's awake and talking but his arm looks broken.",
  ]),
  S('ambulance', 'low', [
    "I've had a bad headache since this morning and I feel a little dizzy. Can someone come and check on me?",
  ], { a: ['ignore'] }),
  S('ambulance', 'high', [
    "A stray dog bit a little girl on {street}! Her leg is bleeding a lot and she's crying!",
  ], { a: ['police'] }),
  S('ambulance', 'critical', [
    "Someone is having a seizure at the bus stop on {street}! He hit his head when he fell and he's shaking!",
  ]),
  S('ambulance', 'high', [
    "My grandfather is diabetic and he suddenly became very confused and sweaty. He can barely talk.",
  ]),

  // ---------------- POLICE ----------------
  S('police', 'critical', [
    "Someone just broke into my house! I can hear them downstairs. I'm hiding in the bedroom with my kids. {num} {street}. Please!",
  ]),
  S('police', 'high', [
    "Two men on a motorbike snatched a woman's gold chain on {street} and rode off towards {street2}!",
  ]),
  S('police', 'high', [
    "A big group of men are fighting outside the bar on {street}. They're throwing bottles at each other!",
  ], { a: ['ambulance'] }),
  S('police', 'critical', [
    "A man with a knife is threatening people at the market on {street}! Everyone is running!",
  ]),
  S('police', 'medium', [
    "A van just hit my car and drove away! Nobody is hurt. The number plate started with KX. I'm on {street}.",
  ]),
  S('police', 'low', [
    "The neighbour's dog keeps chasing me every time I walk past their house on {street}. It hasn't bitten me but it's scary.",
    "There's a dog on {street} that runs after every motorbike. It's been chasing people all evening.",
  ], { a: ['ignore'] }),
  S('police', 'medium', [
    "Someone stole my bicycle from outside the bakery on {street} about five minutes ago.",
  ]),
  S('police', 'critical', [
    "My ex-husband is outside banging on the door. He threatened to kill me last week. I'm really scared. {num} {street}.",
  ]),
  S('police', 'high', [
    "A drunk driver is swerving all over {street}! He almost hit a cyclist and a school bus!",
  ]),
  S('police', 'low', [
    "A taxi driver overcharged me. He asked for eighty dollars for a very short ride and shouted at me.",
  ], { a: ['ignore'] }),
  S('police', 'medium', [
    "The traffic lights at the junction of {street} and {street2} are not working. It's total chaos, cars are going everywhere.",
  ]),
  S('police', 'medium', [
    "There's a man walking around {place} on {street} looking into parked cars and trying the door handles.",
  ]),
  S('police', 'low', [
    "My neighbour is playing loud music at two in the morning and he won't turn it down.",
  ], { a: ['ignore'] }),
  S('police', 'high', [
    "I know this sounds crazy but a bull escaped from a farm and it's running down {street}! People are panicking and it just knocked over a motorbike!",
  ], { a: ['fire'] }),
  S('police', 'medium', [
    "Someone has parked a car blocking the whole entrance to the hospital lane on {street} and the driver has disappeared.",
  ], { a: ['ignore'] }),

  // ---------------- IGNORE (pranks / non-emergencies) ----------------
  S('ignore', 'low', ["Hello? Is your refrigerator running? Then you better go and catch it! Hahaha!"]),
  S('ignore', 'low', ["Can you send a fire truck to my son's birthday party on {street}? He really loves fire trucks. There's no fire, it's just for fun."]),
  S('ignore', 'low', ["Hi, what time does the pharmacy near {place} close today?"]),
  S('ignore', 'low', ["Is this the pizza place? I'd like one large chicken pizza with extra cheese please."]),
  S('ignore', 'low', ["There's a UFO over {street}! Green lights everywhere! Aliens are landing! ...hehe just kidding, bye!"]),
  S('ignore', 'low', ["My cat is staring at me in a really weird way. Is that an emergency?"]),
  S('ignore', 'low', ["I'm bored. Can you just talk to me for a while?"]),
  S('ignore', 'low', ["Send the police! My brother ate the last piece of my birthday cake! Arrest him! Hahaha."]),
  S('ignore', 'low', ["Hello, I'd like to report that my WiFi is very slow today."]),
  S('ignore', 'low', ["Uhh... sorry, wrong number. I was trying to call my aunty."]),
  S('ignore', 'low', ["*giggling* There's a... a dinosaur on {street}! A big one! *laughing* ...okay bye!"]),
  S('ignore', 'low', ["My neighbour's rooster wakes me up at five every morning. I want you to arrest the rooster."], { a: ['police'] }),
  S('ignore', 'low', ["Hello, what is the score of today's cricket match? Is England winning?"]),
  S('ignore', 'low', ["Testing, testing, one two three. Just checking if this number works. Okay thanks!"]),
];

const FIRST = ['James', 'Emma', 'Oliver', 'Sophie', 'William', 'Charlotte', 'Harry', 'Emily', 'George', 'Olivia',
  'Thomas', 'Grace', 'Jack', 'Lucy', 'Daniel', 'Chloe', 'Michael', 'Hannah', 'David', 'Amelia',
  'Samuel', 'Rachel', 'Benjamin', 'Laura', 'Henry', 'Alice', 'Matthew', 'Sarah', 'Edward', 'Jessica'];
const LAST = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Wilson', 'Davies', 'Evans', 'Thompson',
  'Walker', 'Wright', 'Robinson', 'Clarke', 'Hughes', 'Green', 'Baker', 'Turner'];
const PLACES = ['the bus station', 'the temple', 'the market', 'the school', 'the supermarket', 'the gas station',
  'the pharmacy', 'the clock tower', 'the playground', 'the church', 'the post office', 'the railway crossing'];

export function makeCaller(r) {
  const phone = `07${r.int(0, 8)}-${r.int(100, 999)} ${String(r.int(0, 99)).padStart(2, '0')}••`;
  return { name: `${r.pick(FIRST)} ${r.pick(LAST)}`, phone };
}

export function pickScenario(r, recent) {
  // Balance the mix of call types, then avoid recently used scenarios.
  const weights = { fire: 0.23, ambulance: 0.29, police: 0.27, ignore: 0.21 };
  let roll = r(), type = 'police';
  for (const [k, w] of Object.entries(weights)) { if (roll < w) { type = k; break; } roll -= w; }
  let pool = SCENARIOS.filter((s) => s.t === type && !recent.includes(s));
  if (!pool.length) pool = SCENARIOS.filter((s) => s.t === type);
  return r.pick(pool);
}

export function fillTemplate(r, text, ctx) {
  return text
    .replaceAll('{street}', ctx.street)
    .replaceAll('{street2}', ctx.street2)
    .replaceAll('{num}', String(ctx.num))
    .replaceAll('{place}', r.pick(PLACES));
}
