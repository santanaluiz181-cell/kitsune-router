import { DEFAULT_BASE_URLS } from '../domain/model_catalog.ts';
import type { CompletionResponse, KeySlotMetadata } from '../domain/types.ts';
import { ProviderRequestError } from '../ports/contracts.ts';
import type { ProviderPort, ProviderSendInput } from '../ports/contracts.ts';
import {
  combineSignals,
  fetchWithNetworkGuard,
  normalizeBaseUrl,
  parseRetryAfterMs,
  safeInt,
  safeJsonParse
} from './gemini_adapter.ts';

interface OpenAiChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

interface OpenAiResponseJson {
  choices?: OpenAiChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export class OpenAICompatAdapter implements ProviderPort {
  private readonly defaultTimeoutMs: number;

  constructor(defaultTimeoutMs: number = 45_000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async sendCompletion(input: ProviderSendInput): Promise<CompletionResponse> {
    const startedAt = Date.now();
    const base = ensureV1BaseUrl(
      normalizeBaseUrl(input.slot.baseUrl, DEFAULT_BASE_URLS[input.slot.provider])
    );
    const url = `${base}/chat/completions`;
    const headers = buildOpenAiHeaders(input.slot, input.secret);
    const payload = buildOpenAiPayload(input);
    const signal = combineSignals(input.signal, this.defaultTimeoutMs);

    const response = await fetchWithNetworkGuard(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal
    });

    const parsed = safeJsonParse<OpenAiResponseJson>(await response.text());
    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      const errorMsg = parsed?.error?.message || `Upstream ${input.slot.provider} HTTP ${response.status}`;
      throw new ProviderRequestError(errorMsg, response.status, retryAfterMs);
    }

    const firstChoice = parsed?.choices?.[0];
    const rawText = (firstChoice?.message?.content ?? '').trim();
    const text = stripAdsIfFreebuff(input.slot.provider, rawText);
    if (!text) {
      throw new ProviderRequestError(`Provedor ${input.slot.provider} retornou resposta vazia`, 502, null);
    }

    return {
      text,
      modelId: input.model.id,
      provider: input.slot.provider,
      inputTokens: safeInt(parsed?.usage?.prompt_tokens),
      outputTokens: safeInt(parsed?.usage?.completion_tokens),
      latencyMs: Math.max(1, Date.now() - startedAt),
      finishReason: firstChoice?.finish_reason ?? 'stop'
    };
  }

  async healthCheck(slot: KeySlotMetadata, secret: string): Promise<{ ok: boolean; status: number; detail: string }> {
    const base = normalizeBaseUrl(slot.baseUrl, DEFAULT_BASE_URLS[slot.provider]);
    const url = slot.provider === 'ollama' ? `${base}/api/tags` : `${ensureV1BaseUrl(base)}/models`;
    const headers: Record<string, string> = {};
    if (secret.trim()) {
      headers.Authorization = `Bearer ${secret.trim()}`;
    }

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10_000)
      });
      if (res.ok) {
        return { ok: true, status: res.status, detail: `${slot.provider} ativo (HTTP ${res.status})` };
      }
      const parsed = safeJsonParse<OpenAiResponseJson>(await res.text());
      return {
        ok: false,
        status: res.status,
        detail: parsed?.error?.message || `Falha ${slot.provider} (HTTP ${res.status})`
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro de rede';
      return { ok: false, status: 503, detail: `${slot.provider} inacessivel: ${msg}` };
    }
  }
}

function buildOpenAiHeaders(slot: KeySlotMetadata, secret: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret.trim()) {
    headers.Authorization = `Bearer ${secret.trim()}`;
  }
  if (slot.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'http://127.0.0.1:4319';
    headers['X-Title'] = 'Kitsune Router';
  }
  return headers;
}

function buildOpenAiPayload(input: ProviderSendInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: input.model.upstreamModelId,
    messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false
  };
  if (typeof input.temperature === 'number' && Number.isFinite(input.temperature)) {
    payload.temperature = input.temperature;
  }
  if (typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0) {
    payload.max_tokens = Math.floor(input.maxTokens);
  }
  return payload;
}

function ensureV1BaseUrl(baseUrl: string): string {
  return /\/v1$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
}

function stripAdsIfFreebuff(provider: string, text: string): string {
  if (provider !== 'freebuff') return text;
  return text
    .replace(/\[Sponsored by [^\]]+\]/gi, '')
    .replace(/Free tier powered by [^\n]+/gi, '')
    .replace(/Ad:\s*[^\n]+/gi, '')
    .trim();
}
