import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AnthropicAdapter, buildAnthropicHeaders } from '../src/adapters/anthropic_adapter.ts';
import { DpapiVaultAdapter } from '../src/adapters/dpapi_vault_adapter.ts';
import type { SecretCipher } from '../src/adapters/dpapi_vault_adapter.ts';
import { buildGeminiAuthHeaders, parseRetryAfterMs } from '../src/adapters/gemini_adapter.ts';
import { HttpGatewayAdapter } from '../src/adapters/http_gateway_adapter.ts';
import { McpServerAdapter } from '../src/adapters/mcp_server_adapter.ts';
import { MemoryLedgerAdapter, MemoryProviderAdapter, MemoryVaultAdapter, maskKey } from '../src/adapters/memory_adapters.ts';
import { SqliteLedgerAdapter } from '../src/adapters/sqlite_ledger_adapter.ts';
import { RouterOrchestrator } from '../src/app/router_orchestrator.ts';
import type { MascotEventPayload } from '../src/app/router_orchestrator.ts';
import { selectRoute } from '../src/domain/router_engine.ts';
import { ProviderRequestError } from '../src/ports/contracts.ts';

const fakeCipher: SecretCipher = {
  async encrypt(p) { return { scheme: 'aes-256-gcm', payload: Buffer.from(`x${p}`).toString('base64') }; },
  async decrypt(r) { return Buffer.from(r.payload, 'base64').toString('utf8').slice(1); }
};

function tmp(): string { return mkdtempSync(path.join(os.tmpdir(), 'kitsune-')); }

async function setup() {
  const vault = new MemoryVaultAdapter();
  const ledger = new MemoryLedgerAdapter();
  const provider = new MemoryProviderAdapter();
  const orch = new RouterOrchestrator({ vault, ledger, provider });
  const base = { provider: 'google-ai-studio' as const, tier: 'free' as const, baseUrl: '', enabled: true, allowedModels: [] };
  await orch.upsertSlot({ ...base, id: 'a', label: 'Conta A', secret: 'AIzaAAAA1111', priority: 20 });
  await orch.upsertSlot({ ...base, id: 'b', label: 'Conta B', secret: 'AIzaBBBB2222', priority: 10 });
  return { vault, ledger, provider, orch };
}

test('orquestrador faz fallback em 429 e registra ledger + humor', async () => {
  const { provider, ledger, orch, vault } = await setup();
  provider.enqueueOutcome('a', { type: 'error', status: 429, message: 'quota' });
  const moods: string[] = [];
  orch.subscribe((e: MascotEventPayload) => { if (e.mood) moods.push(e.mood); });
  const r = await orch.executeCompletion({ source: 'playground', policy: 'manual', requestedModel: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'oi' }] });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.slot.id, 'b'); assert.equal(r.fallbackUsed, true); }
  assert.ok(vault.getSlotMetadata('a')!.cooldownUntilMs > Date.now());
  const s = ledger.querySummary();
  assert.equal(s.totalRequests, 2);
  assert.equal(s.successfulRequests, 1);
  assert.deepEqual(moods, ['routing', 'warning', 'celebrating']);
});

test('orquestrador esgota todos e devolve 429/exhausted', async () => {
  const { provider, orch } = await setup();
  provider.enqueueOutcome('a', { type: 'error', status: 429, message: 'q1' });
  provider.enqueueOutcome('b', { type: 'error', status: 429, message: 'q2' });
  const r = await orch.executeCompletion({ source: 'mcp', policy: 'manual', requestedModel: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.httpStatus, 429); assert.equal(r.code, 'UPSTREAM_EXHAUSTED'); }
  assert.equal(orch.getStateSnapshot().activeMood.mood, 'exhausted');
});

test('confidencial com so free Google vira blocked e nao chama provedor', async () => {
  const { provider, orch, ledger } = await setup();
  const r = await orch.executeCompletion({ source: 'playground', sensitivity: 'confidential', messages: [{ role: 'user', content: 'segredo' }] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.httpStatus, 403);
  assert.equal(provider.callLog.length, 0);
  assert.equal(ledger.querySummary().privacyBlockedRequests, 1);
});

test('maskKey e parseRetryAfterMs tratam bordas', () => {
  assert.equal(maskKey('', 'ollama'), 'local-no-key');
  assert.equal(maskKey('', 'openrouter'), 'unset');
  assert.equal(maskKey('AIzaSyABCDEFGH1234', 'google-ai-studio'), 'AIza...1234');
  assert.equal(parseRetryAfterMs('7'), 7000);
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs('lixo'), null);
});

test('DpapiVaultAdapter persiste sem expor segredo em texto puro', async () => {
  const dir = tmp();
  try {
    const v = new DpapiVaultAdapter(dir, fakeCipher);
    await v.upsertSlot({ id: 'Minha Conta!', label: 'X', provider: 'openrouter', tier: 'paid', baseUrl: '', secret: 'sk-or-SECRETVALUE99', enabled: true, priority: 1, allowedModels: [' a ', 'a'] });
    const raw = readFileSync(path.join(dir, 'vault.enc.json'), 'utf8');
    assert.ok(!raw.includes('sk-or-SECRETVALUE99'));
    const reloaded = new DpapiVaultAdapter(dir, fakeCipher);
    const s = reloaded.listSlotMetadata()[0];
    assert.equal(s.id, 'minha-conta');
    assert.deepEqual(s.allowedModels, ['a']);
    assert.equal(await reloaded.getSecret('minha-conta'), 'sk-or-SECRETVALUE99');
    await assert.rejects(reloaded.upsertSlot({ id: 'n', label: 'n', provider: 'openrouter', tier: 'paid', baseUrl: '', secret: '', enabled: true, priority: 1, allowedModels: [] }));
    assert.equal(await reloaded.deleteSlot('minha-conta'), true);
    assert.equal(await reloaded.deleteSlot('minha-conta'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DPAPI real do Windows faz round-trip', { skip: process.platform !== 'win32' }, async () => {
  const dir = tmp();
  try {
    const v = new DpapiVaultAdapter(dir);
    await v.upsertSlot({ id: 'w', label: 'W', provider: 'openrouter', tier: 'paid', baseUrl: '', secret: 'chave-ção-ü-123456', enabled: true, priority: 1, allowedModels: [] });
    assert.equal(await v.getSecret('w'), 'chave-ção-ü-123456');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SqliteLedgerAdapter agrega e reseta', () => {
  const dir = tmp();
  const l = new SqliteLedgerAdapter(dir);
  try {
    assert.equal(l.querySummary().totalRequests, 0);
    l.record({ timestampIso: 't', source: 'mcp', slotId: 'a', slotLabel: 'A', provider: 'openrouter', modelId: 'm', sensitivity: 'public', status: 'ok', httpStatus: 200, latencyMs: 5, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.001, estimatedSavingsUsd: 0.002, errorMessage: null });
    l.record({ timestampIso: 't', source: 'mcp', slotId: 'a', slotLabel: 'A', provider: 'openrouter', modelId: 'm', sensitivity: 'public', status: 'privacy_blocked', httpStatus: 403, latencyMs: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, estimatedSavingsUsd: 0, errorMessage: 'x' });
    const s = l.querySummary();
    assert.equal(s.totalRequests, 2);
    assert.equal(s.privacyBlockedRequests, 1);
    assert.equal(s.totalInputTokens, 10);
    l.reset();
    assert.equal(l.querySummary().totalRequests, 0);
  } finally { l.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP gateway: /v1, /api/slots, playground, estatico e erros', async () => {
  const { orch } = await setup();
  const gw = new HttpGatewayAdapter(orch, { port: 0, uiDir: path.resolve('src/ui') });
  const port = await gw.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    const models = await (await fetch(`${base}/v1/models`)).json();
    assert.ok(models.data.length > 3);
    const chat = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'ola' }] }) });
    assert.equal(chat.status, 200);
    const cj = await chat.json();
    assert.equal(cj.object, 'chat.completion');
    assert.match(cj.choices[0].message.content, /ola/);
    const bad = await fetch(`${base}/v1/chat/completions`, { method: 'POST', body: '{nope' });
    assert.equal(bad.status, 400);
    const empty = await fetch(`${base}/v1/chat/completions`, { method: 'POST', body: '{"messages":[]}' });
    assert.equal(empty.status, 400);
    const conf = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'x-kitsune-sensitivity': 'confidential' }, body: JSON.stringify({ messages: [{ role: 'user', content: 's' }] }) });
    assert.equal(conf.status, 403);
    const add = await fetch(`${base}/api/slots`, { method: 'POST', body: JSON.stringify({ label: 'Local', provider: 'ollama', tier: 'local' }) });
    assert.equal(add.status, 201);
    const invalid = await fetch(`${base}/api/slots`, { method: 'POST', body: JSON.stringify({ label: 'x', provider: 'hack', tier: 'free' }) });
    assert.equal(invalid.status, 400);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.slots.length, 3);
    assert.match(state.integration.mcpConfigJson, /kitsune-router/);
    const tg = await fetch(`${base}/api/slots/a/test`, { method: 'POST' });
    assert.equal((await tg.json()).ok, true);
    const del = await fetch(`${base}/api/slots/a`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const del404 = await fetch(`${base}/api/slots/a`, { method: 'DELETE' });
    assert.equal(del404.status, 404);
    const pg = await fetch(`${base}/api/playground`, { method: 'POST', body: JSON.stringify({ prompt: '' }) });
    assert.equal(pg.status, 400);
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  } finally { await gw.stop(); }
});

test('MCP JSON-RPC: initialize, tools/list, tools/call', async () => {
  const { orch } = await setup();
  let pillOpened = 0;
  const mcp = new McpServerAdapter(orch, {
    onOpenPill: async () => {
      pillOpened += 1;
      return { launched: true, url: 'http://127.0.0.1:4319/?mode=pill', reason: 'ok' };
    }
  });
  const init = await mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal((init!.result as { serverInfo: { name: string } }).serverInfo.name, 'kitsune-router');
  const list = await mcp.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal((list!.result as { tools: unknown[] }).tools.length, 8);
  const pillRes = await mcp.handleMessage({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'kitsune_open_pill', arguments: {} } });
  assert.equal(pillOpened, 1);
  assert.match((pillRes!.result as { content: Array<{ text: string }> }).content[0].text, /\?mode=pill/);
  const call = await mcp.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kitsune_route_prompt', arguments: { prompt: 'teste mcp' } } });
  const res = call!.result as { isError: boolean; content: Array<{ text: string }> };
  assert.equal(res.isError, false);
  assert.match(res.content[0].text, /teste mcp/);

  const wsList = await mcp.handleMessage({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'kitsune_list_workspace_files', arguments: { project: 'kitsune-router', limit: 5 } } });
  assert.equal((wsList!.result as { isError: boolean }).isError, false);

  const empty = await mcp.handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'kitsune_route_prompt', arguments: {} } });
  assert.equal((empty!.result as { isError: boolean }).isError, true);
  const badPolicy = await mcp.handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'kitsune_set_active_profile', arguments: { policy: 'xx' } } });
  assert.equal((badPolicy!.result as { isError: boolean }).isError, true);
  const unknown = await mcp.handleMessage({ jsonrpc: '2.0', id: 6, method: 'nada' });
  assert.equal(unknown!.error!.code, -32601);
  assert.equal(await mcp.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('Multi-provedores OAuth/Claude/DeepSeek: headers, tier gate e Adapter HTTP', async () => {
  const oauthHdrs = buildGeminiAuthHeaders('google-oauth', '{"access_token":"ya29.test-oauth-999"}');
  assert.equal(oauthHdrs.Authorization, 'Bearer ya29.test-oauth-999');
  assert.equal(oauthHdrs['x-goog-api-key'], undefined);

  const keyHdrs = buildGeminiAuthHeaders('google-ai-studio', 'AIzaTestKey1234');
  assert.equal(keyHdrs['x-goog-api-key'], 'AIzaTestKey1234');
  assert.equal(keyHdrs.Authorization, undefined);

  const claudeOat = buildAnthropicHeaders('sk-ant-oat01-session-token');
  assert.equal(claudeOat.Authorization, 'Bearer sk-ant-oat01-session-token');
  assert.equal(claudeOat['x-api-key'], undefined);
  const claudeKey = buildAnthropicHeaders('sk-ant-api03-key-token');
  assert.equal(claudeKey['x-api-key'], 'sk-ant-api03-key-token');

  const freeStudioSlot = {
    id: 'free1', label: 'Free', provider: 'google-ai-studio' as const, tier: 'free' as const,
    baseUrl: '', maskedSecret: 'AIza...1', enabled: true, priority: 10, cooldownUntilMs: 0,
    authInvalid: false, consecutiveFailures: 0, lastError: null, lastUsedIso: null, allowedModels: []
  };
  const deepBlocked = selectRoute(
    { requestedModel: 'gemini-deep-research', policy: 'manual', sensitivity: 'public', messages: [{ role: 'user', content: 'q' }] },
    [freeStudioSlot]
  );
  assert.equal(deepBlocked.ok, false);

  const paidOAuthSlot = { ...freeStudioSlot, id: 'oauth1', label: 'Google Pro', provider: 'google-oauth' as const, tier: 'paid' as const };
  const deepAllowed = selectRoute(
    { requestedModel: 'gemini-deep-research', policy: 'frontier', sensitivity: 'public', messages: [{ role: 'user', content: 'q' }] },
    [freeStudioSlot, paidOAuthSlot]
  );
  assert.equal(deepAllowed.ok, true);
  if (deepAllowed.ok) {
    assert.equal(deepAllowed.candidates[0].slot.id, 'oauth1');
    assert.equal(deepAllowed.candidates[0].model.id, 'gemini-deep-research');
  }

  const origFetch = globalThis.fetch;
  const adapter = new AnthropicAdapter(5000);
  try {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'Claude OK' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 4 } }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
    const okRes = await adapter.sendCompletion({
      slot: { ...paidOAuthSlot, provider: 'anthropic' },
      secret: 'sk-ant-api03-xyz',
      model: { id: 'anthropic/claude-sonnet-4-5', label: 'Claude', provider: 'anthropic', tierClass: 'balanced', availableOnFreeTier: false, contextWindow: 200000, inputCostPer1MUsd: 3, outputCostPer1MUsd: 15, upstreamModelId: 'claude-sonnet-4-5', notes: '' },
      messages: [{ role: 'system', content: 'Be terse' }, { role: 'user', content: 'Ping' }]
    });
    assert.equal(okRes.text, 'Claude OK');

    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: { message: 'rate_limit' } }),
      { status: 429, headers: { 'retry-after': '3', 'content-type': 'application/json' } }
    );
    await assert.rejects(
      adapter.sendCompletion({
        slot: { ...paidOAuthSlot, provider: 'anthropic' },
        secret: 'sk-ant-api03-xyz',
        model: { id: 'anthropic/claude-sonnet-4-5', label: 'Claude', provider: 'anthropic', tierClass: 'balanced', availableOnFreeTier: false, contextWindow: 200000, inputCostPer1MUsd: 3, outputCostPer1MUsd: 15, upstreamModelId: 'claude-sonnet-4-5', notes: '' },
        messages: [{ role: 'user', content: 'Ping' }]
      }),
      (err: unknown) => err instanceof ProviderRequestError && err.httpStatus === 429 && err.retryAfterMs === 3000
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('SSE v1: role chunk, deltas por palavra, stop com usage e [DONE]', async () => {
  const { sendOpenAiSseCompletion } = await import('../src/adapters/gateway_helpers.ts');
  const lines: string[] = [];
  const res = { writeHead() {}, write(s: string) { lines.push(s); return true; }, end() {} };
  const outcome = { model: { id: 'm' }, completion: { text: 'ola mundo cruel', inputTokens: 3, outputTokens: 5 } };
  sendOpenAiSseCompletion(res as never, outcome as never);
  const payloads = lines.map((l) => l.replace(/^data: /, '').trim()).filter(Boolean);
  assert.equal(payloads.at(-1), '[DONE]');
  const chunks = payloads.slice(0, -1).map((p) => JSON.parse(p));
  assert.equal(chunks[0].choices[0].delta.role, 'assistant');
  assert.equal(chunks.slice(1, -1).map((c) => c.choices[0].delta.content).join(''), 'ola mundo cruel');
  assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop');
  assert.equal(chunks.at(-1).usage.total_tokens, 8);
  assert.ok(chunks.slice(0, -1).every((c) => c.choices[0].finish_reason === null));
});

test('Gateway HUD Pill, relay de eventos MCP e import Gemini CLI opt-in', async () => {
  const prevNoHud = process.env.KITSUNE_NO_HUD;
  process.env.KITSUNE_NO_HUD = '1';
  const fakeHome = tmp();
  mkdirSync(path.join(fakeHome, '.gemini'), { recursive: true });
  writeFileSync(
    path.join(fakeHome, '.gemini', 'oauth_creds.json'),
    JSON.stringify({ access_token: 'ya29.SECRET_RAW_CLI_TOKEN_XYZ', expiry_date: Date.now() + 600_000 }),
    'utf8'
  );

  const { orch, vault } = await setup();
  const gw = new HttpGatewayAdapter(orch, { port: 0, uiDir: path.resolve('src/ui'), dataDir: fakeHome, geminiCliHomeDir: fakeHome });
  const port = await gw.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    const pillPage = await fetch(`${base}/pill`);
    assert.equal(pillPage.status, 200);
    assert.match(await pillPage.text(), /pillKitsune/);

    const loginBad = await fetch(`${base}/api/accounts/open-login`, { method: 'POST', body: JSON.stringify({ target: 'evil' }) });
    assert.equal(loginBad.status, 400);
    const loginOk = await fetch(`${base}/api/accounts/open-login`, { method: 'POST', body: JSON.stringify({ target: 'google-oauth' }) });
    assert.equal(loginOk.status, 200);

    const imported = await fetch(`${base}/api/accounts/import-gemini-cli`, { method: 'POST', body: '{}' });
    assert.equal(imported.status, 201);
    const impRaw = await imported.text();
    assert.ok(!impRaw.includes('SECRET_RAW_CLI_TOKEN_XYZ'));
    assert.equal(await vault.getSecret('google-oauth-gemini-cli'), 'ya29.SECRET_RAW_CLI_TOKEN_XYZ');

    writeFileSync(
      path.join(fakeHome, '.gemini', 'oauth_creds.json'),
      JSON.stringify({ access_token: 'ya29.expired', expiry_date: Date.now() - 60_000 }),
      'utf8'
    );
    const impExpired = await fetch(`${base}/api/accounts/import-gemini-cli`, { method: 'POST', body: '{}' });
    assert.equal(impExpired.status, 409);

    const relayed = await fetch(`${base}/api/internal/event`, {
      method: 'POST',
      body: JSON.stringify({ type: 'mood', mood: 'routing', reason: 'Antigravity MCP ativo' })
    });
    assert.equal(relayed.status, 200);
    assert.equal(orch.getStateSnapshot().activeMood.mood, 'routing');
    assert.equal(orch.getStateSnapshot().activeMood.reason, 'Antigravity MCP ativo');
  } finally {
    await gw.stop();
    if (prevNoHud === undefined) delete process.env.KITSUNE_NO_HUD;
    else process.env.KITSUNE_NO_HUD = prevNoHud;
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
