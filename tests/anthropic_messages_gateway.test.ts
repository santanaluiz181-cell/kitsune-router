import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { HttpGatewayAdapter } from '../src/adapters/http_gateway_adapter.ts';
import { MemoryLedgerAdapter, MemoryProviderAdapter, MemoryVaultAdapter } from '../src/adapters/memory_adapters.ts';
import { RouterOrchestrator } from '../src/app/router_orchestrator.ts';
import {
  buildAnthropicMessage,
  buildAnthropicSseEvents,
  parseAnthropicRequest
} from '../src/domain/anthropic_translator.ts';
import { aliasForModel, buildAutoAliasTable, resolveClientModel } from '../src/domain/model_alias.ts';
import { listActiveModels } from '../src/domain/router_engine.ts';

async function setupGateway() {
  const vault = new MemoryVaultAdapter();
  const ledger = new MemoryLedgerAdapter();
  const provider = new MemoryProviderAdapter();
  const orch = new RouterOrchestrator({ vault, ledger, provider });
  const base = { tier: 'paid' as const, baseUrl: '', enabled: true, allowedModels: [] };
  await orch.upsertSlot({ ...base, id: 'claude-slot', provider: 'anthropic', label: 'Claude Console', secret: 'sk-ant-1234', priority: 20 });
  await orch.upsertSlot({ ...base, id: 'gemini-slot', provider: 'google-ai-studio', label: 'Gemini Slot', secret: 'AIza1234', priority: 10 });
  await orch.upsertSlot({ ...base, id: 'wus-slot', provider: 'wusrouter', label: 'WusRouter Slot', secret: 'sk-wus-1234', priority: 5 });
  const gw = new HttpGatewayAdapter(orch, { port: 0, uiDir: path.resolve('src/ui') });
  const port = await gw.start();
  return { vault, ledger, provider, orch, gw, port, baseHttp: `http://127.0.0.1:${port}` };
}

test('model_alias mapeia claude-* bypassando filtros de vendors terceiros', () => {
  const models = [{ id: 'gemini-3.8-flash' }, { id: 'deepseek/deepseek-chat' }, { id: 'nvidia/nemotron' }];
  const table = buildAutoAliasTable(models);
  assert.ok(table.has('claude-gemini-3.8-flash'));
  assert.ok(table.has('claude-deepseek-deepseek-chat'));
  assert.ok(table.has('claude-nvidia-nemotron'));

  const resolved = resolveClientModel('claude-gemini-3.8-flash', [{ id: 'gemini-3.8-flash', upstreamModelId: 'gemini-3.8-flash' }]);
  assert.equal(resolved.targetId, 'gemini-3.8-flash');
  assert.equal(resolved.alias, 'claude-gemini-3.8-flash');

  const custom = { 'claude-sonnet-custom': 'gemini-3.8-flash' };
  const customResolved = resolveClientModel('claude-sonnet-custom', [{ id: 'gemini-3.8-flash', upstreamModelId: 'gemini-3.8-flash' }], custom);
  assert.equal(customResolved.targetId, 'gemini-3.8-flash');
  assert.equal(customResolved.alias, 'claude-sonnet-custom');
  assert.equal(aliasForModel('gemini-3.8-flash', [{ id: 'gemini-3.8-flash' }], custom), 'claude-sonnet-custom');
});

test('anthropic_translator lida com tool_use, tool_result e SSE events', () => {
  const req = parseAnthropicRequest({
    model: 'claude-3-5-sonnet',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Calcule' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Vou chamar a tool' },
          { type: 'tool_use', id: 'call_1', name: 'calc', input: { a: 2, b: 2 } }
        ]
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '4' }]
      }
    ],
    tools: [
      { name: 'calc', description: 'Calcula', input_schema: { type: 'object', properties: { a: { type: 'number' } } } }
    ]
  });
  assert.equal(req.ok, true);
  if (req.ok) {
    assert.equal(req.value.messages.length, 3);
    assert.equal(req.value.messages[1].role, 'assistant');
    assert.equal(req.value.messages[1].toolCalls?.[0].name, 'calc');
    assert.equal(req.value.messages[2].role, 'tool');
    assert.equal(req.value.messages[2].content, '4');
    assert.equal(req.value.tools?.[0].name, 'calc');
  }

  const msg = buildAnthropicMessage(
    {
      text: 'O resultado e 4',
      toolCalls: [{ id: 'c_99', name: 'save', arguments: '{"ok":true}' }],
      modelId: 'gemini-3.8-flash',
      provider: 'google-ai-studio',
      inputTokens: 15,
      outputTokens: 8,
      latencyMs: 10,
      finishReason: 'tool_use'
    },
    'claude-gemini-3-8-flash'
  );
  assert.equal(msg.model, 'claude-gemini-3-8-flash');
  assert.equal(msg.stop_reason, 'tool_use');
  assert.equal((msg.content as unknown[]).length, 2);

  const sseEvents = buildAnthropicSseEvents(msg);
  const names = sseEvents.map((e) => e.event);
  assert.deepEqual(names.slice(0, 3), ['message_start', 'content_block_start', 'content_block_delta']);
  assert.ok(names.includes('message_delta'));
  assert.ok(names.includes('message_stop'));
});

test('HTTP gateway /v1/messages e /v1/models para Claude Desktop e Claude Code', async () => {
  const { gw, baseHttp } = await setupGateway();
  try {
    const modelsRes = await fetch(`${baseHttp}/v1/models`, {
      headers: {
        'User-Agent': 'Claude-Desktop/1.0',
        'anthropic-version': '2023-06-01'
      }
    });
    assert.equal(modelsRes.status, 200);
    const modelsData = (await modelsRes.json()) as { data: Array<{ id: string }> };
    assert.ok(modelsData.data.length >= 2);
    assert.ok(modelsData.data.every((m) => m.id.startsWith('claude-')));

    const msgRes = await fetch(`${baseHttp}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: modelsData.data[0].id,
        messages: [{ role: 'user', content: 'Ola Claude Gateway' }],
        max_tokens: 100
      })
    });
    assert.equal(msgRes.status, 200);
    const msgJson = (await msgRes.json()) as { role: string; content: Array<{ type: string; text?: string }> };
    assert.equal(msgJson.role, 'assistant');
    assert.ok(msgJson.content[0].text);

    const streamRes = await fetch(`${baseHttp}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: modelsData.data[0].id,
        stream: true,
        messages: [{ role: 'user', content: 'Teste stream' }]
      })
    });
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.headers.get('content-type') || '', /text\/event-stream/);
    const textStream = await streamRes.text();
    assert.match(textStream, /event: message_start/);
    assert.match(textStream, /event: content_block_delta/);
    assert.match(textStream, /event: message_stop/);
  } finally {
    await gw.stop();
  }
});

test('testSlot probe executa ping e full mode com latency', async () => {
  const { orch } = await setupGateway();
  const ping = await orch.testSlot('claude-slot', 'ping');
  assert.equal(ping.ok, true);
  assert.equal(ping.mode, 'ping');
  assert.ok(typeof ping.latencyMs === 'number');

  const full = await orch.testSlot('claude-slot', 'full');
  assert.equal(full.ok, true);
  assert.equal(full.mode, 'full');
  assert.equal(full.streamOk, true);
  assert.equal(full.toolCallOk, true);
});
