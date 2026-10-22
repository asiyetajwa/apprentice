// @apprentice/nebius-core: the shared core every Nebius project here builds on.
// Token Factory client, model routing, cost and latency telemetry, and a stub mode for working offline.

export * from './client.js';
export * from './models.js';
export * from './stub.js';
export * from './telemetry.js';

import { HttpTransport, TokenFactory, type Transport } from './client.js';
import { StubTransport, type StubOptions } from './stub.js';
import { Telemetry } from './telemetry.js';

/** Live when NEBIUS_API_KEY is set, stub otherwise. The stub needs the app's answers for chat calls. */
export function createTokenFactory(stub: StubOptions, env: NodeJS.ProcessEnv = process.env): TokenFactory {
  const key = env.NEBIUS_API_KEY?.trim();
  const transport: Transport = key ? new HttpTransport(key, env.NEBIUS_BASE_URL?.trim() || undefined) : new StubTransport(stub);
  return new TokenFactory(transport, new Telemetry());
}
