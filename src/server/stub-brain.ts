// Offline answers for every chat call, so the whole loop runs without a Token Factory key. The base student
// makes the confusions small models really make on this task (a refund that mentions a charge reads as
// billing; a login error reads as technical); the tuned student mostly gets past them. Stub numbers are
// labelled stub everywhere in the app; they show the loop's shape, not a result.

import type { ChatRequest } from '@apprentice/nebius-core';
import { hash } from './task.js';

type Rule = [string, RegExp];

const has = (t: string, re: RegExp) => re.test(t);

/** A careful classifier: the order encodes what a well-trained model learns about this task. */
const CAREFUL: Rule[] = [
  ['refund', /\b(refund|money back|my money|send (one of )?(the|it|that).{0,20}back|returned|want that money|get my \$?\d|not .*replacement)/],
  ['cancellation', /\b(cancel|stop (my plan|charging|it from renew)|close my account|end (my|the) (subscription|membership)|done with the service|switching to another)/],
  ['account_access', /\b(log ?in|password|sign (in|up)|two-factor|locked|hacked|login code|email (address )?on my account|get into the account|change the email)/],
  ['shipping', /\b(order|package|tracking|deliver|ship|carrier|ups|fedex|dhl|usps|post office)/],
  ['feedback', /\b(love|suggestion|redesign|wanted to say|would be great|not a bug report|too expensive for what)/],
  ['product_question', /\b(does the|does .* (include|work|come)|is there|what is the difference|how many people|can i use|will i be billed|do i need to pay extra)/],
  ['technical', /\b(error|crash|blank|spinning|slow|stopped|not work|doesn'?t work|empty file|notifications|sync)/],
  ['billing', /\b(charge|charged|billed|billing|invoice|payment|price|statement|card)/],
];

/** A hasty classifier: the first keyword wins, the way an untrained small model guesses. */
const HASTY: Rule[] = [
  ['billing', /\b(charge|charged|billed|billing|invoice|payment|price|\$\d)/],
  ['technical', /\b(error|crash|blank|spinning|slow|stopped|not work|doesn'?t work|empty file|notifications|sync)/],
  ['account_access', /\b(log ?in|password|two-factor|locked|hacked|account)/],
  ['shipping', /\b(order|package|tracking|deliver|ship)/],
  ['cancellation', /\b(cancel|close my account)/],
  ['refund', /\b(refund|money back)/],
  ['product_question', /\b(does|is there|difference|how many|can i)/],
  ['feedback', /\b(love|suggestion|redesign|great)/],
];

const LABELS = ['billing', 'refund', 'shipping', 'technical', 'account_access', 'cancellation', 'product_question', 'feedback'];

function classify(text: string, rules: Rule[], fallback = 'feedback'): string {
  const t = text.toLowerCase();
  return rules.find(([, re]) => has(t, re))?.[0] ?? fallback;
}

/** Deterministic noise: the same model and text always give the same answer. */
function noisy(model: string, text: string, label: string, rate: number): string {
  const h = hash(`${model}|${text}`);
  if ((h % 1000) / 1000 >= rate) return label;
  return LABELS[(h >>> 10) % LABELS.length]!;
}

export function studentAnswer(model: string, text: string): string {
  const tuned = /^apprentice-|^ft:/i.test(model);
  const teacher = /ultra|super/i.test(model);
  if (teacher) return noisy(model, text, classify(text, CAREFUL), 0.04);
  if (tuned) return noisy(model, text, classify(text, CAREFUL), 0.07);
  return noisy(model, text, classify(text, HASTY), 0.08);
}

const FAILURE_NAMES: Record<string, [string, string]> = {
  'refund>billing': ['Refund asked as a billing complaint', 'Asks for money back but mentions a charge, so the model says billing.'],
  'account_access>technical': ['Login error read as technical', 'Cannot sign in because of an error message, so the model says technical.'],
  'cancellation>billing': ['Cancel before renewal', 'Wants to stop the plan before the next charge, so the model says billing.'],
  'cancellation>account_access': ['Cancel read as an account issue', 'Wants to end the subscription but mentions the account.'],
  'product_question>billing': ['Plan question with prices', 'A question before buying that mentions billing or prices.'],
  'technical>billing': ['Checkout error read as billing', 'The payment page is broken, so the model says billing.'],
  'shipping>billing': ['Paid shipping read as billing', 'A delivery problem that mentions paying for shipping.'],
  'refund>shipping': ['Return read as shipping', 'Wants money back for a returned or broken item.'],
  'feedback>product_question': ['Opinion read as a question', 'A suggestion or complaint phrased like a question.'],
};

function failureTypes(content: string): string {
  const { mistakes } = JSON.parse(content) as { mistakes: Array<{ id: string; correct: string; model_said: string }> };
  const groups = new Map<string, string[]>();
  for (const m of mistakes) {
    const key = `${m.correct}>${m.model_said}`;
    groups.set(key, [...(groups.get(key) ?? []), m.id]);
  }
  const types = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .map(([key, ids]) => {
      const [gold, said] = key.split('>') as [string, string];
      const [name, description] = FAILURE_NAMES[key] ?? [`${gold.replace('_', ' ')} read as ${said.replace('_', ' ')}`, `Tickets that are ${gold} get labelled ${said}.`];
      return { name, description, gold, confused_with: said, example_ids: ids };
    });
  return JSON.stringify({ types });
}

const BANK: Record<string, string[]> = {
  refund: ['The {plan} renewal charged me {amount} {when}, please put it back on my card.', 'I want my money back for {amount}, the app never synced once.', 'Charged {amount} after I cancelled in the trial. Refund it please.', 'Return processed {when} for the desk stand, where is my refund?', 'Billing took {amount} twice. Can you reverse one of them?'],
  billing: ['What is this {amount} line on my statement from {when}?', 'Please add our company VAT number to future invoices.', 'My card was declined but I still see a pending {amount}.', 'Why is the {plan} price higher than last month?', 'Can I pay by bank transfer instead of card?'],
  cancellation: ['Turn off auto-renew on my {plan} plan before {when}.', 'I do not want to be charged again, end my subscription now.', 'Please close my account and stop all future billing.', 'Cancel the {plan} plan, we moved to another tool.'],
  account_access: ['After I type my password I get an error and cannot get in.', 'The six digit code never arrives so I am stuck at login.', 'I changed phones and two-factor no longer works.', 'Someone changed my password {when}, I cannot sign in.'],
  technical: ['The {plan} checkout page shows an error when I click pay.', 'Since the update the editor freezes when I paste images.', 'Search returns nothing even for notes I just wrote.', 'Attachments over 5 MB fail to upload with an error.'],
  shipping: ['I paid for express delivery but my order is still processing.', 'Tracking says delivered {when} but the box is not here.', 'Can you ship the printed planner to a PO box?', 'The courier left my package at the wrong address.'],
  product_question: ['Will switching to {plan} charge me the full price today?', 'Does the {plan} plan include shared folders?', 'Is there a discount for nonprofits?', 'Can two people use one account on the Starter plan?'],
  feedback: ['Honestly the {plan} plan costs too much for what it does.', 'Love the new search, it is so fast now.', 'Please bring back the old sidebar, the new one is cluttered.', 'Not a complaint, but the export could support Markdown.'],
};
const FILL: Record<string, string[]> = { plan: ['Pro', 'Team', 'Family', 'annual'], amount: ['$12', '$29.99', '$119', '$7'], when: ['yesterday', 'last week', 'on Monday', 'this morning'] };

function teacherCases(content: string, req: ChatRequest): string {
  const n = Number(/Write (\d+) cases/.exec(content)?.[1] ?? 10);
  const m = /correct label is "(\w+)"; the small model wrongly says "(\w+)"/.exec(content);
  const cases: Array<{ text: string; label: string }> = [];
  const seed = hash(content + req.model);
  for (let i = 0; i < n; i++) {
    const label = m ? (i % 10 < 7 ? m[1]! : m[2]!) : LABELS[i % LABELS.length]!;
    const bank = BANK[label] ?? BANK.feedback!;
    const tpl = bank[(seed + i * 7) % bank.length]!;
    const text = tpl.replace(/\{(\w+)\}/g, (_, k: string) => FILL[k]![(seed + i * 3 + k.length) % FILL[k]!.length]!);
    const tail = ['', ' Thanks.', ' Please help.', ` (ticket ${String(1000 + ((seed + i) % 9000))})`][(seed >>> (i % 16)) % 4];
    cases.push({ text: `${text}${tail}`, label });
  }
  return JSON.stringify({ cases });
}

function blindLabels(content: string): string {
  const { messages } = JSON.parse(content) as { messages: string[] };
  return JSON.stringify({ labels: messages.map((t) => noisy('grader', t, classify(t, CAREFUL), 0.06)) });
}

export function stubRespond(req: ChatRequest): string {
  const user = req.messages.findLast((m) => m.role === 'user')?.content ?? '';
  const content = req.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  if (req.schema?.name === 'failure_types') return failureTypes(content);
  if (req.schema?.name === 'training_cases') return teacherCases(content, req);
  if (req.schema?.name === 'labels') return blindLabels(content);
  return studentAnswer(req.model, user);
}
