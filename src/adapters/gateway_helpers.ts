import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MascotEventPayload, RouterOrchestrator } from '../app/router_orchestrator.ts';
import { DEFAULT_BASE_URLS } from '../domain/model_catalog.ts';
import type {
  AccountTier,
  ChatMessage,
  MascotMood,
  ProviderKind,
  RoutingPolicy,
  SensitivityLevel
} from '../domain/types.ts';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const VALID_PROVIDERS = new Set<ProviderKind>([
  'google-ai-studio',
  'google-oauth',
  'anthropic',
  'deepseek',
  'openrouter',
  'ollama',
  'openai-compat',
  'nvidia',
  'freebuff',
  'wusrouter'
]);
export const VALID_TIERS = new Set<AccountTier>(['free', 'paid', 'local']);
export const VALID_POLICIES = new Set<RoutingPolicy>(['economy', 'balanced', 'frontier', 'manual']);
export const VALID_SENSITIVITIES = new Set<SensitivityLevel>(['confidential', 'public']);
export const VALID_MOODS = new Set<MascotMood>([
  'idle',
  'routing',
  'celebrating',
  'warning',
  'blocked',
  'exhausted',
  'dizzy',
  'vault_save',
  'key_trash'
]);

const VALID_EVENT_TYPES = new Set<MascotEventPayload['type']>([
  'mood',
  'slots_updated',
  'usage_updated',
  'config_updated'
]);

export class BodyLimitError extends Error {}
export class InvalidJsonError extends Error {}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new BodyLimitError('Payload excede o limite de 2 MB.');
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new InvalidJsonError('JSON invalido no corpo da requisicao.');
  }
}

export function validateSlotPayload(body: Record<string, unknown>) {
  const provider = body.provider as ProviderKind;
  const tier = body.tier as AccountTier;
  if (!VALID_PROVIDERS.has(provider)) {
    return { ok: false as const, message: 'Provedor invalido.' };
  }
  if (!VALID_TIERS.has(tier)) {
    return { ok: false as const, message: 'Tier invalido (use free, paid ou local).' };
  }
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const secret = typeof body.secret === 'string' ? body.secret : '';
  const id = typeof body.id === 'string' && body.id.trim()
    ? body.id.trim()
    : `${provider}-${Date.now().toString(36)}`;
  if (!label) {
    return { ok: false as const, message: 'Nome do slot obrigatorio.' };
  }
  if (provider !== 'ollama' && !secret.trim() && !(typeof body.id === 'string' && body.id.trim())) {
    return { ok: false as const, message: 'Informe a chave ou token do provedor.' };
  }

  const allowedModels = Array.isArray(body.allowedModels)
    ? body.allowedModels.map((item) => String(item).trim()).filter(Boolean)
    : [];

  return {
    ok: true as const,
    data: {
      id,
      label,
      provider,
      tier,
      baseUrl: typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : DEFAULT_BASE_URLS[provider],
      secret,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      priority: typeof body.priority === 'number' && Number.isFinite(body.priority) ? body.priority : 10,
      allowedModels
    }
  };
}

export function parseInternalEvent(body: Record<string, unknown>): MascotEventPayload | null {
  const type = body.type as MascotEventPayload['type'];
  if (!VALID_EVENT_TYPES.has(type)) {
    return null;
  }
  const moodRaw = typeof body.mood === 'string' ? (body.mood as MascotMood) : undefined;
  if (moodRaw && !VALID_MOODS.has(moodRaw)) {
    return null;
  }
  return {
    type,
    mood: moodRaw,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    modelId: typeof body.modelId === 'string' ? body.modelId : undefined,
    slotLabel: typeof body.slotLabel === 'string' ? body.slotLabel : undefined,
    retryAfterMs: typeof body.retryAfterMs === 'number' ? body.retryAfterMs : undefined,
    costUsd: typeof body.costUsd === 'number' ? body.costUsd : undefined,
    savingsUsd: typeof body.savingsUsd === 'number' ? body.savingsUsd : undefined,
    timestampIso: typeof body.timestampIso === 'string' ? body.timestampIso : new Date().toISOString()
  };
}

export function parseOpenAiMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const list: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const role = obj.role === 'system' || obj.role === 'assistant' ? obj.role : 'user';
    const content = typeof obj.content === 'string' ? obj.content : '';
    if (content.trim()) {
      list.push({ role, content });
    }
  }
  return list;
}

export function buildOpenAiCompletionJson(
  outcome: Extract<Awaited<ReturnType<RouterOrchestrator['executeCompletion']>>, { ok: true }>
) {
  return {
    id: `chatcmpl-kitsune-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: outcome.model.id,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: outcome.completion.text },
        finish_reason: outcome.completion.finishReason.toLowerCase()
      }
    ],
    usage: {
      prompt_tokens: outcome.completion.inputTokens,
      completion_tokens: outcome.completion.outputTokens,
      total_tokens: outcome.completion.inputTokens + outcome.completion.outputTokens
    },
    kitsune: {
      slotId: outcome.slot.id,
      slotLabel: outcome.slot.label,
      provider: outcome.slot.provider,
      fallbackUsed: outcome.fallbackUsed,
      estimatedCostUsd: outcome.estimatedCostUsd,
      estimatedSavingsUsd: outcome.estimatedSavingsUsd
    }
  };
}

export function sendOpenAiSseCompletion(
  res: ServerResponse,
  outcome: Extract<Awaited<ReturnType<RouterOrchestrator['executeCompletion']>>, { ok: true }>
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const base = {
    id: `chatcmpl-kitsune-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: outcome.model.id
  };
  const emit = (delta: Record<string, string>, finish: string | null, extra: object = {}): void => {
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
  };
  emit({ role: 'assistant', content: '' }, null);
  for (const piece of outcome.completion.text.match(/\S+\s*|\s+/g) ?? []) {
    emit({ content: piece }, null);
  }
  emit({}, 'stop', {
    usage: {
      prompt_tokens: outcome.completion.inputTokens,
      completion_tokens: outcome.completion.outputTokens,
      total_tokens: outcome.completion.inputTokens + outcome.completion.outputTokens
    }
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

export function buildIntegrationSnippets(port: number, cliEntryPath: string) {
  return {
    baseUrlV1: `http://127.0.0.1:${port}/v1`,
    claudeDesktopUrl: `http://127.0.0.1:${port}/v1`,
    pillUrl: `http://127.0.0.1:${port}/?mode=pill`,
    mcpConfigJson: JSON.stringify(
      {
        mcpServers: {
          'kitsune-router': {
            command: 'node',
            args: [cliEntryPath, 'mcp']
          }
        }
      },
      null,
      2
    )
  };
}

export function setLoopbackCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Kitsune-Policy, X-Kitsune-Sensitivity');
  }
}

export function writeSse(res: ServerResponse, eventName: string, data: unknown): void {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
