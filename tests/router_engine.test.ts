import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateCostUsd, evaluateFailure, isSlotBlockedByPrivacy, markSlotHealthy, selectRoute } from '../src/domain/router_engine.ts';
import type { KeySlotMetadata, RouteRequest } from '../src/domain/types.ts';

function slot(over: Partial<KeySlotMetadata> = {}): KeySlotMetadata {
  return {
    id: 's1', label: 'Conta A', provider: 'google-ai-studio', tier: 'free', baseUrl: '',
    maskedSecret: 'AIza...0000', enabled: true, priority: 10, allowedModels: [],
    cooldownUntilMs: 0, consecutiveFailures: 0, authInvalid: false, lastError: null,
    createdAtIso: '2026-01-01T00:00:00Z', lastUsedAtIso: null, ...over
  };
}

const req = (over: Partial<RouteRequest> = {}): RouteRequest => ({
  policy: 'balanced', sensitivity: 'public', messages: [{ role: 'user', content: 'oi' }], ...over
});

test('PrivacyGuard bloqueia free Google apenas em confidencial', () => {
  assert.equal(isSlotBlockedByPrivacy(slot(), 'confidential'), true);
  assert.equal(isSlotBlockedByPrivacy(slot(), 'public'), false);
  assert.equal(isSlotBlockedByPrivacy(slot({ tier: 'paid' }), 'confidential'), false);
  assert.equal(isSlotBlockedByPrivacy(slot({ provider: 'ollama', tier: 'local' }), 'confidential'), false);
});

test('selectRoute retorna PRIVACY_BLOCKED quando so ha free Google e prompt confidencial', () => {
  const plan = selectRoute(req({ sensitivity: 'confidential' }), [slot()]);
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.equal(plan.code, 'PRIVACY_BLOCKED');
});

test('selectRoute rejeita entrada vazia e lista sem slots', () => {
  const empty = selectRoute(req({ messages: [{ role: 'user', content: '   ' }] }), [slot()]);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, 'INVALID_INPUT');
  const none = selectRoute(req(), []);
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.code, 'NO_SLOTS_CONFIGURED');
  const disabled = selectRoute(req(), [slot({ enabled: false })]);
  assert.equal(disabled.ok, false);
});

test('slot em cooldown fica fora e devolve retryAfter', () => {
  const now = 1_000_000;
  const plan = selectRoute(req(), [slot({ cooldownUntilMs: now + 30_000 })], now);
  assert.equal(plan.ok, false);
  if (!plan.ok) {
    assert.equal(plan.code, 'ALL_SLOTS_COOLING_DOWN');
    assert.equal(plan.retryAfterMs, 30_000);
  }
});

test('manual respeita modelo pedido', () => {
  const plan = selectRoute(req({ policy: 'manual', requestedModel: 'gemini-3.8-flash' }), [slot()]);
  assert.equal(plan.ok, true);
  if (plan.ok) assert.equal(plan.candidates[0].model.id, 'gemini-3.8-flash');
});

test('free tier nunca recebe modelo pago (Argon)', () => {
  const plan = selectRoute(req({ policy: 'frontier' }), [slot()]);
  assert.equal(plan.ok, true);
  if (plan.ok) assert.ok(plan.candidates.every((c) => c.model.id !== 'gemini-4-argon'));
});

test('429 aplica backoff exponencial e respeita Retry-After maior', () => {
  const s1 = evaluateFailure(slot(), 429, null, 'quota', 0);
  assert.equal(s1.cooldownUntilMs, 15_000);
  const s2 = evaluateFailure(s1, 429, null, 'quota', 0);
  assert.equal(s2.cooldownUntilMs, 30_000);
  const s3 = evaluateFailure(slot(), 429, 120_000, 'quota', 0);
  assert.equal(s3.cooldownUntilMs, 120_000);
  const auth = evaluateFailure(slot(), 401, null, '', 0);
  assert.equal(auth.authInvalid, true);
  assert.equal(markSlotHealthy(auth, 'x').authInvalid, false);
});

test('custo e economia nunca negativos e tratam NaN', () => {
  const r = estimateCostUsd({ inputCostPer1MUsd: 0, outputCostPer1MUsd: 0 }, 1_000_000, 1_000_000);
  assert.equal(r.costUsd, 0);
  assert.equal(r.savingsUsd, 9);
  const bad = estimateCostUsd({ inputCostPer1MUsd: 1, outputCostPer1MUsd: 1 }, Number.NaN, -5);
  assert.deepEqual(bad, { costUsd: 0, savingsUsd: 0 });
});

test('mutacao: inverter PrivacyGuard seria detectado', () => {
  const mutated = (s: KeySlotMetadata, sens: string) => !(sens === 'confidential' && s.tier === 'free');
  assert.notEqual(mutated(slot(), 'confidential'), isSlotBlockedByPrivacy(slot(), 'confidential'));
});
