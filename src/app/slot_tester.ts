// Executor auxiliar de health probe e testSlot
import type { KeySlotMetadata } from '../domain/types.ts';
import { evaluateFailure, markSlotHealthy } from '../domain/router_engine.ts';
import type { ProviderPort, VaultPort } from '../ports/contracts.ts';

export interface TestSlotOutcome {
  ok: boolean;
  status: number;
  detail: string;
  mode: 'ping' | 'full';
  latencyMs?: number;
  toolCallOk?: boolean;
  streamOk?: boolean;
  slot?: KeySlotMetadata;
}

export type CompletionFn = (input: {
  source: 'playground';
  policy: 'manual';
  messages: Array<{ role: 'user'; content: string }>;
  maxTokens: number;
}) => Promise<{ ok: boolean; httpStatus: number; message: string }>;

export async function executeSlotTest(
  slot: KeySlotMetadata,
  secret: string,
  mode: 'ping' | 'full',
  provider: ProviderPort,
  vault: VaultPort,
  execCompletion: CompletionFn
): Promise<{ outcome: TestSlotOutcome; updatedSlot: KeySlotMetadata }> {
  const startedAt = Date.now();
  let probe = await provider.healthCheck(slot, secret);
  let toolCallOk: boolean | undefined = undefined;
  let streamOk: boolean | undefined = undefined;

  if (probe.ok && mode === 'full') {
    try {
      const fullRes = await execCompletion({
        source: 'playground',
        policy: 'manual',
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 16
      });
      streamOk = fullRes.ok;
      if (!fullRes.ok) {
        probe = { ok: false, status: fullRes.httpStatus, detail: `Teste full falhou: ${fullRes.message}` };
      } else {
        toolCallOk = true;
      }
    } catch (err) {
      probe = { ok: false, status: 502, detail: `Erro no teste full: ${(err as Error).message}` };
    }
  }

  const latencyMs = Math.max(1, Date.now() - startedAt);
  const nowIso = new Date().toISOString();
  const updatedSlot = probe.ok
    ? markSlotHealthy(slot, nowIso)
    : evaluateFailure(slot, probe.status, null, probe.detail);

  await vault.updateSlotMetadata(updatedSlot);
  return {
    outcome: {
      ok: probe.ok,
      status: probe.status,
      detail: probe.detail,
      mode,
      latencyMs,
      toolCallOk,
      streamOk,
      slot: updatedSlot
    },
    updatedSlot
  };
}
