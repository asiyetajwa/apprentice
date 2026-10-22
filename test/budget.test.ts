// The spend guard, against a fake transport: no network, no money.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetError, GuardedTransport, SpendGuard, StubTransport, TokenFactoryError, type ChatRequest, type Transport } from '@apprentice/nebius-core';

const ledger = () => join(mkdtempSync(join(tmpdir(), 'ledger-')), 'ledger.jsonl');
const prices = async () => new Map([['m', { in: 1, out: 3 }]]);
const req = (maxTokens = 100): ChatRequest => ({ step: 't', role: 'student', model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens });

function fake(over: Partial<Transport> = {}): Transport {
  const base = new StubTransport({ respond: () => 'ok', speed: 0 });
  return Object.assign(base, { chat: async () => ({ text: 'ok', tokensIn: 1000, tokensOut: 100, latencyMs: 1 }) }, over);
}

test('records real cost and refuses a call whose worst case would pass the cap', async () => {
  const guard = new SpendGuard(0.002, ledger());
  const t = new GuardedTransport(fake(), guard, prices);
  await t.chat(req()); // 1000 in at $1/M + 100 out at $3/M = $0.0013
  assert.ok(Math.abs(guard.spent() - 0.0013) < 1e-9);
  await assert.rejects(t.chat(req(1000)), BudgetError);
});

test('a billing error halts every later call, even in a new process', async () => {
  const path = ledger();
  const t = new GuardedTransport(fake({ chat: () => Promise.reject(new TokenFactoryError('402', 402, '{"error":"insufficient balance"}')) }), new SpendGuard(1, path), prices);
  await assert.rejects(t.chat(req()), TokenFactoryError);
  const again = new GuardedTransport(fake(), new SpendGuard(1, path), prices);
  await assert.rejects(again.chat(req()), /halted/);
});

test('unpriced models, deploys and unquoted fine-tunes are refused', async () => {
  const t = new GuardedTransport(fake(), new SpendGuard(1, ledger()), prices);
  await assert.rejects(t.chat({ ...req(), model: 'unknown' }), /No published/);
  await assert.rejects(t.deployLora(), /dedicated endpoint/);
  await assert.rejects(t.createFineTune({ model: 'm', trainingFile: 'f', suffix: 's', seed: 1, hyperparameters: { n_epochs: 1, learning_rate: 1e-4, batch_size: 8, lora: true, lora_r: 16, lora_alpha: 32, lora_dropout: 0 } }), /no approved price quote/);
});
