// Builds the bundled demo task: support tickets for a fictional app ("Lumen"), each labelled with one of
// eight queues. Deterministic (fixed seed), so every run and every test sees the same train, dev and test
// splits. Run: node data/generate.mjs
// The tickets are composed from hand-written phrasings. Most are hard on purpose: mixed intents, misleading
// keywords and Lumen's house routing rules (below), so even a strong general model makes real mistakes that
// labelled examples can teach away.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'support-tickets');

// Mulberry32: small, fast, deterministic.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261022);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => pick(SLOTS[k]));

const SLOTS = {
  plan: ['Pro', 'Team', 'Family', 'Starter', 'annual', 'monthly'],
  amount: ['$9.99', '$14', '$29', '$119', '$4.50', '$59.88'],
  date: ['yesterday', 'on the 3rd', 'last Tuesday', 'this morning', 'two weeks ago', 'on March 12'],
  device: ['iPhone 15', 'Pixel 8', 'Galaxy S23', 'iPad', 'MacBook', 'Windows laptop', 'Chromebook'],
  feature: ['offline mode', 'dark mode', 'the calendar sync', 'shared folders', 'export to PDF', 'the widget', 'two-way sync'],
  item: ['the starter kit', 'my hardware key', 'the desk stand', 'the gift card', 'the printed planner'],
  carrier: ['UPS', 'FedEx', 'DHL', 'the post office', 'USPS'],
  error: ['error 503', 'a blank white screen', '"something went wrong"', 'a spinning wheel', 'error code E42', 'a crash on launch'],
  greet: ['', '', '', 'Hi, ', 'Hello, ', 'Hey team, ', 'Good morning. '],
  sign: ['', '', '', ' Thanks.', ' Thanks!', ' Please help.', ' Cheers', ' Appreciate it.'],
};

// Each label: plain phrasings, plus hard ones. Hard tickets follow Lumen's house rules, which a generic model
// does not know but can learn from labelled examples:
// - anything that blocks signing in is account_access, even when an error code shows;
// - an error on the payment or checkout page is billing (the payments team owns it);
// - "fix the charge" is billing, "send the money back" is refund;
// - "stop charging me" or "do not renew" is cancellation, even when it sounds like a billing complaint;
// - a damaged or wrong physical item is shipping when they want a replacement, refund when they want money;
// - "will you add X" or "please add X" is feedback, even when phrased as a question;
// - a question about how a plan change would be billed, asked before changing, is product_question;
// - a complaint about price with no request is feedback.
const LABELS = {
  billing: {
    plain: [
      'I was charged {amount} twice {date} for the same {plan} plan, can you correct it?',
      'Can you send me an invoice for the {amount} payment {date}? Our accountant needs it.',
      'My payment keeps failing when I try to update my card details.',
      'I need to change the billing address on my invoices.',
      'How do I switch from monthly to annual billing?',
    ],
    hard: [
      'Not asking for money back, I just want to understand the {amount} charge from {date}.',
      'I upgraded to {plan} and was charged the full {amount} instead of the prorated amount, please fix the charge.',
      'The checkout page shows {error} when I try to pay for the {plan} plan.',
      'Your payment page on my {device} shows {error} after I enter my card.',
      'My account says {plan} but the invoice is for a different plan, please correct the invoice.',
      'Please add our VAT number to the {amount} invoice from {date}.',
      'The card on file expired and the app keeps showing {error} when I try to replace it.',
      'I see a pending charge of {amount} from {date}, is that right or a mistake on your side?',
    ],
  },
  refund: {
    plain: [
      'I would like a refund for the {amount} charge {date}, I never used the {plan} plan.',
      'Please refund my last payment. The app did not work for me.',
      'I returned {item} {date}, when will I get my money back?',
      'I was promised a refund {date} and still have not received it.',
    ],
    hard: [
      'You charged me twice {date}, please send one of the {amount} payments back to my card.',
      'I cancelled within the trial but was still billed {amount}, I want that money returned.',
      '{item} arrived broken, I do not want a replacement, just the money back.',
      'The {plan} plan never synced on my {device}, I would rather have the {amount} back than more troubleshooting.',
      'Billing took {amount} after I had already closed my account, put it back on my card please.',
      'I do not want to cancel, I just want the {amount} from {date} reversed because I was charged for a plan I never chose.',
      'Your app crashed during my exam week and the {plan} plan was useless, I expect my {amount} returned.',
      'Can the {amount} go back to my card? {item} was the wrong size and I already sent it back.',
    ],
  },
  shipping: {
    plain: [
      'Where is my order? {item} was supposed to arrive {date}.',
      'The tracking for {item} has not updated in a week, {carrier} says nothing.',
      'Can I change the delivery address for {item}? It has not shipped yet.',
      'My package was marked delivered {date} but it is not here.',
    ],
    hard: [
      'I paid {amount} for express shipping on {item} and it still took ten days, can you look into the delivery?',
      '{item} arrived cracked, please send a new one.',
      'You sent me the wrong item instead of {item}, I need the right one shipped.',
      'Order says shipped {date} but {carrier} has no record, is it actually on the way?',
      'My account shows {item} as delivered but I never got it, the app must be wrong or {carrier} is.',
      'Billing went through for {item} {date} but there is still no tracking number.',
      'Can {carrier} leave {item} with my neighbour? I will be away when it arrives.',
      'The box for {item} was empty when it arrived {date}, please send what I ordered.',
    ],
  },
  technical: {
    plain: [
      'The app shows {error} every time I open it on my {device}.',
      'Sync stopped working on my {device} {date}, my notes are not updating.',
      '{feature} does not work after the latest update.',
      'The app is extremely slow on my {device}, it takes a minute to load.',
    ],
    hard: [
      'I am signed in fine but {feature} shows {error} on my {device}.',
      'Is {feature} broken or am I using it wrong? Nothing happens when I tap it.',
      'I pay for {plan} and {feature} still says it is locked, even though everything else works.',
      'Since the update my account settings page shows {error}, I can still sign in.',
      'Export from my {plan} account produces an empty file on my {device}.',
      'I love the app but {feature} drains my {device} battery in an hour since {date}.',
      'Notes I wrote {date} on my {device} disappeared after the sync, I am still logged in.',
      'Printing from the app on my {device} gives {error}.',
    ],
  },
  account_access: {
    plain: [
      'I forgot my password and the reset email never arrives.',
      'My account is locked after too many login attempts.',
      'I lost my phone and cannot get past two-factor authentication.',
      'Someone else logged into my account {date}, I think I was hacked.',
    ],
    hard: [
      'I cannot log in because the app shows {error} right after I enter my password.',
      'I want to keep my subscription but I cannot get into the account to manage it.',
      'I need to update my card but I cannot sign in to my account since {date}.',
      'Sign in on my {device} says my account does not exist, but I pay for {plan}.',
      'The login screen on my {device} gives {error} so I cannot reach my notes.',
      'I want to cancel but first I need to get back into my account, the reset link is broken.',
      'The verification code text never arrives on my {device}, so I am stuck at sign in.',
      'There was a sign-in from a {device} I do not own {date}, please secure my account.',
    ],
  },
  cancellation: {
    plain: [
      'Please cancel my {plan} subscription, I no longer need it.',
      'How do I stop my plan from renewing next month?',
      'I want to close my account and delete my data.',
      'I am switching to another app, please end my subscription.',
    ],
    hard: [
      'Stop charging my card, I am done with the service.',
      'Please do not renew the {plan} plan on the 1st, I will not need it after this month.',
      'I cannot find the cancel button in my account settings, please end the subscription for me.',
      'No more {amount} payments please, the {plan} plan ends with me today.',
      'My company stopped using Lumen, turn off the auto renewal on our {plan} account.',
      'I do not want a refund, I just want to make sure I am not billed again next month.',
      'Remove my card and shut down the account, the app is fine but I do not use it.',
      'Downgrade me to nothing, I mean end the subscription, before the next billing date.',
    ],
  },
  product_question: {
    plain: [
      'Does the {plan} plan include {feature}?',
      'Can I use the app on my {device} and my laptop at the same time?',
      'What is the difference between the Pro and Team plans?',
      'How many people can share a Family plan?',
    ],
    hard: [
      'If I move to the {plan} plan, will I be billed again or is it prorated?',
      'Does {feature} come with the {plan} plan or do I need to pay extra?',
      'Before I buy the {plan} plan, does it work offline on a {device}?',
      'If I cancel the trial early, do I keep {feature} until the end of the month?',
      'Is the {amount} price for {plan} per person or for the whole team?',
      'Will my notes still sync to a {device} if I stay on the free tier?',
      'Can I pay for the {plan} plan with a gift card, or only a credit card?',
      'Do you ship {item} to Canada, and is shipping included in the {plan} plan?',
    ],
  },
  feedback: {
    plain: [
      'Love the new {feature}, it saves me so much time.',
      'The redesign is confusing, I preferred the old layout.',
      'Just wanted to say your support team was great last week.',
      'It would be great if {feature} supported more file types.',
    ],
    hard: [
      'Will you add {feature} to the {device} app? It is the one thing I miss.',
      'Please add {feature} to the {plan} plan, my whole team would use it.',
      'Honestly the {plan} plan is too expensive for what it offers.',
      'Not a bug report, but {feature} feels slow compared to before.',
      'Any plans to support {device}? I would switch my whole team over.',
      'The {amount} price went up again {date}, that is a lot for a notes app.',
      'Shipping on {item} was quick and the packaging was lovely, thank you.',
      'Can you bring back the old {feature}? The new one is harder to use.',
    ],
  },
};

// Background a customer adds that names other queues without asking for anything from them.
// Each aside lists the queues it would contradict, so it is never added to those.
const ASIDES = [
  ['I have been on the {plan} plan for two years.', []],
  ['Your app is usually great.', []],
  ['My last order arrived fine.', ['shipping']],
  ['Billing has never been an issue before.', ['billing', 'refund']],
  ['I use it on my {device} every day.', []],
  ['I already tried logging out and back in.', []],
  ['I am not trying to cancel.', ['cancellation']],
  ['I recommended Lumen to my whole office.', []],
];

function noise(text, label) {
  let t = text;
  if (rand() < 0.4) {
    const [aside, not] = pick(ASIDES);
    if (!not.includes(label)) t = `${fill(aside)} ${t}`;
  }
  if (rand() < 0.15) t = t.toLowerCase();
  if (rand() < 0.1) t = t.replace(/\./g, '');
  if (rand() < 0.08) t = t.replace(/ the /, ' teh ');
  return t;
}

// The reserved phrasings of every label (below) never appear in training: dev and test draw half
// their tickets from them, so a tuned model is scored on wording it has not seen, not on memorised frames.
function pool(label, hard, split) {
  const all = hard ? LABELS[label].hard : LABELS[label].plain;
  // Plain: the last phrasing is reserved. Hard: the last two, so held-out tickets test the house rules on new wording.
  const keep = hard ? 2 : 1;
  const reserved = all.slice(-keep);
  const open = all.slice(0, -keep);
  if (split === 'train') return open;
  return rand() < 0.5 ? reserved : open;
}

function make(label, hard, split) {
  const greet = pick(SLOTS.greet);
  let body = fill(pick(pool(label, hard, split)));
  if (greet.endsWith(', ')) body = body[0].toLowerCase() + body.slice(1);
  const core = `${greet}${body}${pick(SLOTS.sign)}`.trim();
  return { body: body.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), core, text: noise(core, label) };
}

// Per label: 30 train, 8 dev, 15 test; about two thirds of each split is hard.
const sizes = { test: 15, dev: 8, train: 30 };
const seen = new Set();
const owner = new Map();
const splits = { test: [], dev: [], train: [] };
for (const label of Object.keys(LABELS)) {
  for (const [split, n] of Object.entries(sizes)) {
    let made = 0;
    let tries = 0;
    while (made < n && tries < 5000) {
      tries++;
      const hard = made < Math.round((n * 2) / 3);
      // A sentence belongs to one split only: test and tuning checks never reuse a training sentence, even
      // with a different greeting. Within a split, tickets are unique before noise is added.
      const { body, core, text } = make(label, hard, split);
      const key = core.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(key)) continue;
      if (owner.has(body) && owner.get(body) !== split) continue;
      owner.set(body, split);
      seen.add(key);
      splits[split].push({ text, label, hard });
      made++;
    }
  }
}

mkdirSync(out, { recursive: true });
for (const [split, rows] of Object.entries(splits)) {
  // Shuffle deterministically so labels are interleaved, then number them.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const lines = rows.map((r, i) => JSON.stringify({ id: `${split}-${String(i + 1).padStart(3, '0')}`, ...r }));
  writeFileSync(join(out, `${split}.jsonl`), `${lines.join('\n')}\n`);
  console.log(`${split}: ${rows.length}`);
}
writeFileSync(
  join(out, 'task.json'),
  `${JSON.stringify(
    {
      name: 'Support ticket routing',
      description: 'Route each customer support ticket for the Lumen notes app to exactly one queue.',
      labels: Object.keys(LABELS),
      labelHelp: {
        billing: 'questions or problems about charges, invoices, prices or payment methods, without asking for money back',
        refund: 'asks for money back',
        shipping: 'physical orders, delivery and tracking',
        technical: 'the app or a feature is broken, slow or erroring',
        account_access: 'cannot sign in, passwords, two-factor, email on the account, security',
        cancellation: 'wants to stop a subscription or close the account',
        product_question: 'questions about plans, features or pricing before buying',
        feedback: 'opinions, praise, complaints and suggestions with no request to act',
      },
      metric: 'accuracy',
    },
    null,
    2,
  )}\n`,
);
