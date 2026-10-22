// Builds the bundled demo task: support tickets for a fictional app ("Lumen"), each labelled with one of
// eight queues. Deterministic (fixed seed), so every run and every test sees the same train, dev and test
// splits. Run: node data/generate.mjs
// The tickets are composed from hand-written phrasings, with confusable cases on purpose (a refund that
// mentions billing, a cancellation that mentions the account), so a small base model makes real mistakes.

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

// Each label: plain phrasings, plus hard ones that borrow another queue's words.
const LABELS = {
  billing: {
    plain: [
      'I was charged {amount} twice {date} for the same {plan} plan.',
      'Why did my card get charged {amount} {date}? I thought I was on the free tier.',
      'Can you send me an invoice for the {amount} payment {date}? Our accountant needs it.',
      'My payment keeps failing when I try to update my card details.',
      'The price on my statement is {amount} but the site said less for the {plan} plan.',
      'I need to change the billing address on my invoices.',
      'How do I switch from monthly to annual billing?',
      'There is a charge of {amount} I do not recognise from {date}.',
    ],
    hard: [
      'Not asking for money back, I just want to understand the {amount} charge from {date}.',
      'I upgraded to {plan} and was charged the full {amount} instead of the prorated amount, can you fix the charge?',
      'My account says {plan} but I am being billed for a different plan.',
    ],
  },
  refund: {
    plain: [
      'I would like a refund for the {amount} charge {date}, I never used the {plan} plan.',
      'Please refund my last payment. The app did not work for me.',
      'I returned {item} {date}, when will I get my money back?',
      'Can I get my {amount} back? I bought the wrong plan by mistake.',
      'I was promised a refund {date} and still have not received it.',
      'Requesting a full refund for the {plan} subscription, it is not what was advertised.',
    ],
    hard: [
      'You charged me twice {date}, please send one of the {amount} payments back to my card.',
      'I cancelled within the trial but was still billed {amount}, I want that money returned.',
      '{item} arrived broken, I do not want a replacement, just the money back.',
    ],
  },
  shipping: {
    plain: [
      'Where is my order? {item} was supposed to arrive {date}.',
      'The tracking for {item} has not updated in a week, {carrier} says nothing.',
      'Can I change the delivery address for {item}? It has not shipped yet.',
      'My package was marked delivered {date} but it is not here.',
      'Do you ship {item} to Canada and how long does it take?',
      '{carrier} lost my package, what happens now?',
    ],
    hard: [
      'I paid for express shipping on {item} and it still took ten days, can you look into the delivery?',
      'Order says shipped {date} but {carrier} has no record, is it actually on the way?',
    ],
  },
  technical: {
    plain: [
      'The app shows {error} every time I open it on my {device}.',
      'Sync stopped working on my {device} {date}, my notes are not updating.',
      '{feature} does not work after the latest update.',
      'I get {error} when I try to upload a file larger than 10 MB.',
      'The app is extremely slow on my {device}, it takes a minute to load.',
      'Notifications stopped arriving on my {device}.',
      'Export to PDF produces an empty file.',
    ],
    hard: [
      'I cannot log in because the app shows {error} right after I enter my password.',
      'The checkout page shows {error} so I cannot pay for the {plan} plan.',
      'Since the update my account settings page shows {error}.',
    ],
  },
  account_access: {
    plain: [
      'I forgot my password and the reset email never arrives.',
      'My account is locked after too many login attempts.',
      'I lost my phone and cannot get past two-factor authentication.',
      'How do I change the email address on my account?',
      'Someone else logged into my account {date}, I think I was hacked.',
      'I signed up with Google and now cannot log in with email.',
      'The password reset link from {date} says it has expired.',
      'I get logged out every few minutes on my {device}.',
      'My {device} keeps asking for a verification code I never receive.',
      'I need to move my account to a new email address, the old one is gone.',
      'There was a sign-in from a {device} I do not own {date}, please secure my account.',
      'My account got locked {date} after I typed the wrong password a few times.',
      'Face ID login stopped working on my {device}.',
      'I set up two-factor on a {device} I sold, how do I get back in?',
    ],
    hard: [
      'I want to keep my subscription but I cannot get into the account to manage it.',
      'The login code goes to my old email, how do I update it so I can sign in?',
      'I need to update my card but I cannot sign in to my account since {date}.',
      'Sign in on my {device} says my account does not exist, but I pay for {plan}.',
    ],
  },
  cancellation: {
    plain: [
      'Please cancel my {plan} subscription, I no longer need it.',
      'How do I stop my plan from renewing next month?',
      'I want to close my account and delete my data.',
      'Cancel my membership effective today please.',
      'I am switching to another app, please end my subscription.',
    ],
    hard: [
      'Please cancel my {plan} plan before it charges me again on the 1st.',
      'I cannot find the cancel button in my account settings, please end the subscription for me.',
      'Stop charging my card, I am done with the service.',
    ],
  },
  product_question: {
    plain: [
      'Does the {plan} plan include {feature}?',
      'Can I use the app on my {device} and my laptop at the same time?',
      'Is there a student discount?',
      'What is the difference between the Pro and Team plans?',
      'Does {feature} work without an internet connection?',
      'How many people can share a Family plan?',
    ],
    hard: [
      'If I move to the {plan} plan, will I be billed again or is it prorated?',
      'Does {feature} come with the {plan} plan or do I need to pay extra?',
    ],
  },
  feedback: {
    plain: [
      'Love the new {feature}, it saves me so much time.',
      'Suggestion: please add {feature} to the mobile app.',
      'The redesign is confusing, I preferred the old layout.',
      'Just wanted to say your support team was great last week.',
      'It would be great if {feature} supported more file types.',
    ],
    hard: [
      'Not a bug report, but {feature} feels slow compared to before.',
      'Honestly the {plan} plan is too expensive for what it offers, consider a cheaper tier.',
    ],
  },
};

function noise(text) {
  let t = text;
  if (rand() < 0.15) t = t.toLowerCase();
  if (rand() < 0.1) t = t.replace(/\./g, '');
  if (rand() < 0.08) t = t.replace(/ the /, ' teh ');
  if (rand() < 0.1) t = `${t} This is the ${pick(['second', 'third'])} time I am writing.`;
  return t;
}

// The last plain and the last hard phrasing of every label never appear in training: dev and test draw half
// their tickets from them, so a tuned model is scored on wording it has not seen, not on memorised frames.
function pool(label, hard, split) {
  const all = hard ? LABELS[label].hard : LABELS[label].plain;
  const reserved = all.slice(-1);
  const open = all.slice(0, -1);
  if (split === 'train') return open;
  return rand() < 0.5 ? reserved : open;
}

function make(label, hard, split) {
  const greet = pick(SLOTS.greet);
  let body = fill(pick(pool(label, hard, split)));
  if (greet.endsWith(', ')) body = body[0].toLowerCase() + body.slice(1);
  const core = `${greet}${body}${pick(SLOTS.sign)}`.trim();
  return { body: body.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), core, text: noise(core) };
}

// Per label: 30 train, 8 dev, 15 test; about a third of each split is hard.
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
      const hard = made < Math.round(n / 3);
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
