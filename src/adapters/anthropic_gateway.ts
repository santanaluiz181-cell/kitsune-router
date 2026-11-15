// Handlers especificos para a API Anthropic Messages (POST /v1/messages e GET /v1/models aliased).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouterOrchestrator } from '../app/router_orchestrator.ts';
import {
  buildAnthropicMessage,
  buildAnthropicSseEvents,
  estimateInputTokens,
  mapRoutingErrorToAnthropic,
  parseAnthropicRequest
} from '../domain/anthropic_translator.ts';
import { aliasForModel, resolveClientModel } from '../domain/model_alias.ts';
import { listActiveModels } from '../domain/router_engine.ts';
import type { RoutingPolicy, SensitivityLevel } from '../domain/types.ts';
import {
  readJsonBody,
  sendJson,
  VALID_POLICIES,
  VALID_SENSITIVITIES
} from './gateway_helpers.ts';

export async function handleAnthropicModels(
  orch: RouterOrchestrator,
  res: ServerResponse
): Promise<void> {
  const snapshot = orch.getStateSnapshot();
  const active = listActiveModels(snapshot.slots);
  const custom = snapshot.config.modelAliases ?? {};
  const data = active.map((m) => ({
    id: aliasForModel(m.id, active, custom),
    type: 'model',
    display_name: m.label,
    created_at: Math.floor(Date.now() / 1000)
  }));
  sendJson(res, 200, { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data[data.length - 1]?.id ?? null });
}

export async function handleAnthropicMessages(
  orch: RouterOrchestrator,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await readJsonBody(req);
  const parsed = parseAnthropicRequest(body);
  if (!parsed.ok) {
    sendJson(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: parsed.message } });
    return;
  }
  const snapshot = orch.getStateSnapshot();
  const active = listActiveModels(snapshot.slots);
  const custom = snapshot.config.modelAliases ?? {};
  const resolved = resolveClientModel(parsed.value.model, active, custom);
  const requestedModel = resolved.targetId || parsed.value.model;
  const returnedAlias = resolved.alias || aliasForModel(requestedModel, active, custom);

  const headerSens = String(req.headers['x-kitsune-sensitivity'] ?? '');
  const headerPol = String(req.headers['x-kitsune-policy'] ?? '');
  const outcome = await orch.executeCompletion({
    source: 'http-v1',
    requestedModel,
    policy: VALID_POLICIES.has(headerPol as RoutingPolicy) ? (headerPol as RoutingPolicy) : undefined,
    sensitivity: VALID_SENSITIVITIES.has(headerSens as SensitivityLevel) ? (headerSens as SensitivityLevel) : undefined,
    messages: parsed.value.messages,
    tools: parsed.value.tools,
    toolChoice: parsed.value.toolChoice,
    temperature: parsed.value.temperature,
    maxTokens: parsed.value.maxTokens
  });

  if (!outcome.ok) {
    if (outcome.retryAfterMs > 0) res.setHeader('Retry-After', String(Math.ceil(outcome.retryAfterMs / 1000)));
    const mapped = mapRoutingErrorToAnthropic(outcome.httpStatus, outcome.message);
    sendJson(res, mapped.status, mapped.body);
    return;
  }

  const completion = outcome.completion;
  if (!completion.inputTokens || completion.inputTokens <= 0) {
    completion.inputTokens = estimateInputTokens(parsed.value.messages, parsed.value.tools);
  }
  const anthropicMsg = buildAnthropicMessage(completion, returnedAlias);
  if (parsed.value.stream) {
    sendAnthropicSseStream(res, anthropicMsg);
    return;
  }
  sendJson(res, 200, anthropicMsg);
}

function sendAnthropicSseStream(res: ServerResponse, message: Record<string, unknown>): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const events = buildAnthropicSseEvents(message);
  for (const ev of events) {
    res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
  }
  res.end();
}
