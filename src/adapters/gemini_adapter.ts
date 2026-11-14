import type { ChatMessage, CompletionResponse, KeySlotMetadata, ProviderKind } from '../domain/types.ts';
import { ProviderRequestError } from '../ports/contracts.ts';
import type { ProviderPort, ProviderSendInput } from '../ports/contracts.ts';

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiResponseJson {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: {
    message?: string;
    status?: string;
  };
}

export class GeminiApiAdapter implements ProviderPort {
  private readonly defaultTimeoutMs: number;

  constructor(defaultTimeoutMs: number = 45_000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async sendCompletion(input: ProviderSendInput): Promise<CompletionResponse> {
    const startedAt = Date.now();
    const baseUrl = ensureGeminiV1Beta(normalizeBaseUrl(input.slot.baseUrl, 'https://generativelanguage.googleapis.com'));
    const url = `${baseUrl}/models/${encodeURIComponent(input.model.upstreamModelId)}:generateContent`;
    const body = buildGeminiPayload(input);
    const signal = combineSignals(input.signal, this.defaultTimeoutMs);

    const response = await fetchWithNetworkGuard(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildGeminiAuthHeaders(input.slot.provider, input.secret)
      },
      body: JSON.stringify(body),
      signal
    });

    const rawText = await response.text();
    const parsed = safeJsonParse<GeminiResponseJson>(rawText);

    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      const providerName = input.slot.provider === 'google-oauth' ? 'Google OAuth' : 'Google AI Studio';
      const errorMsg = parsed?.error?.message || `${providerName} HTTP ${response.status}`;
      throw new ProviderRequestError(errorMsg, response.status, retryAfterMs);
    }

    const firstCandidate = parsed?.candidates?.[0];
    const parts = firstCandidate?.content?.parts ?? [];
    const text = parts
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();

    if (!text) {
      const reason = firstCandidate?.finishReason || 'EMPTY_CANDIDATE';
      throw new ProviderRequestError(`Gemini retornou resposta vazia (${reason})`, 502, null);
    }

    return {
      text,
      modelId: input.model.id,
      provider: input.slot.provider,
      inputTokens: safeInt(parsed?.usageMetadata?.promptTokenCount),
      outputTokens: safeInt(parsed?.usageMetadata?.candidatesTokenCount),
      latencyMs: Math.max(1, Date.now() - startedAt),
      finishReason: firstCandidate?.finishReason ?? 'STOP'
    };
  }

  async healthCheck(slot: KeySlotMetadata, secret: string): Promise<{ ok: boolean; status: number; detail: string }> {
    const baseUrl = ensureGeminiV1Beta(normalizeBaseUrl(slot.baseUrl, 'https://generativelanguage.googleapis.com'));
    const url = `${baseUrl}/models?pageSize=3`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: buildGeminiAuthHeaders(slot.provider, secret),
        signal: AbortSignal.timeout(10_000)
      });
      const label = slot.provider === 'google-oauth' ? 'Google Account OAuth' : 'Google AI Studio';
      if (res.ok) {
        return { ok: true, status: res.status, detail: `${label} ativo (HTTP ${res.status})` };
      }
      const parsed = safeJsonParse<GeminiResponseJson>(await res.text());
      return {
        ok: false,
        status: res.status,
        detail: parsed?.error?.message || `Falha ${label} (HTTP ${res.status})`
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro de rede';
      return { ok: false, status: 503, detail: `Timeout ou rede indisponivel: ${msg}` };
    }
  }
}

function buildGeminiPayload(input: ProviderSendInput): Record<string, unknown> {
  const systemTexts: string[] = [];
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (const msg of input.messages) {
    const clean = msg.content.trim();
    if (!clean) continue;
    if (msg.role === 'system') {
      systemTexts.push(clean);
      continue;
    }
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: clean }]
    });
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Ping' }] });
  }

  const generationConfig: Record<string, number> = {};
  if (typeof input.temperature === 'number' && Number.isFinite(input.temperature)) {
    generationConfig.temperature = input.temperature;
  }
  if (typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0) {
    generationConfig.maxOutputTokens = Math.floor(input.maxTokens);
  }

  const payload: Record<string, unknown> = { contents };
  if (systemTexts.length > 0) {
    payload.systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] };
  }
  if (Object.keys(generationConfig).length > 0) {
    payload.generationConfig = generationConfig;
  }
  return payload;
}

export function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }
  return null;
}

export function combineSignals(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timer = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timer]) : timer;
}

export async function fetchWithNetworkGuard(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido de rede';
    throw new ProviderRequestError(`Erro de rede ao conectar provedor: ${message}`, 503, 5_000);
  }
}

export function safeJsonParse<T>(raw: string): T | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function normalizeBaseUrl(rawUrl: string, fallback: string): string {
  const cleaned = rawUrl.trim().replace(/\/+$/, '');
  return cleaned || fallback;
}

function ensureGeminiV1Beta(baseUrl: string): string {
  return /\/v1(beta)?$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1beta`;
}

export function extractTokenValue(rawSecret: string): string {
  const trimmed = rawSecret.trim().replace(/^Bearer\s+/i, '').trim();
  if (trimmed.startsWith('{')) {
    const json = safeJsonParse<{ access_token?: string; token?: string }>(trimmed);
    if (json && typeof json.access_token === 'string' && json.access_token.trim()) {
      return json.access_token.trim();
    }
    if (json && typeof json.token === 'string' && json.token.trim()) {
      return json.token.trim();
    }
  }
  return trimmed;
}

export function buildGeminiAuthHeaders(provider: ProviderKind, rawSecret: string): Record<string, string> {
  const token = extractTokenValue(rawSecret);
  if (provider === 'google-oauth' || token.startsWith('ya29.')) {
    return { Authorization: `Bearer ${token}` };
  }
  return { 'x-goog-api-key': token };
}

export function safeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export type { ChatMessage };
