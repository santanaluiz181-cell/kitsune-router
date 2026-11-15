// Traducao ferramentas/mensagens do modelo interno para o formato Gemini (functionDeclarations).
import type { ChatMessage, ToolCall, ToolChoice, ToolDef } from '../domain/types.ts';

type Obj = Record<string, unknown>;

export interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Obj };
  functionResponse?: { name: string; response: Obj };
  thoughtSignature?: string;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

const SCHEMA_KEYS = new Set(['type', 'description', 'enum', 'properties', 'required', 'items', 'nullable', 'format', 'minimum', 'maximum', 'minItems', 'maxItems', 'anyOf']);
const SIGNATURE_CACHE_MAX = 500;
const signatureByCallId = new Map<string, string>();
const DUMMY_SIGNATURE = 'skip_thought_signature_validator';

function rememberSignature(callId: string, signature: string): void {
  if (signatureByCallId.size >= SIGNATURE_CACHE_MAX) {
    const oldest = signatureByCallId.keys().next().value;
    if (oldest !== undefined) signatureByCallId.delete(oldest);
  }
  signatureByCallId.set(callId, signature);
}

export function sanitizeGeminiSchema(schema: unknown): Obj {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'object', properties: {} };
  const src = schema as Obj;
  const out: Obj = {};
  for (const [key, value] of Object.entries(src)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === 'type' && Array.isArray(value)) {
      const real = value.filter((v) => v !== 'null');
      out.type = real[0] ?? 'string';
      if (real.length !== value.length) out.nullable = true;
    } else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value as Obj).map(([k, v]) => [k, sanitizeGeminiSchema(v)]));
    } else if (key === 'items') out.items = sanitizeGeminiSchema(value);
    else if (key === 'anyOf' && Array.isArray(value)) out.anyOf = value.map((v) => sanitizeGeminiSchema(v));
    else out[key] = value;
  }
  if (out.type === undefined && out.anyOf === undefined) out.type = 'object';
  return out;
}

export function buildGeminiTools(tools?: ToolDef[]): Obj[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => {
        const parameters = sanitizeGeminiSchema(t.inputSchema);
        const hasProps = parameters.properties && Object.keys(parameters.properties as Obj).length > 0;
        return { name: t.name, description: t.description || t.name, ...(hasProps ? { parameters } : {}) };
      })
    }
  ];
}

export function buildGeminiToolConfig(choice?: ToolChoice): Obj | undefined {
  if (!choice) return undefined;
  if (choice.type === 'none') return { functionCallingConfig: { mode: 'NONE' } };
  if (choice.type === 'any') return { functionCallingConfig: { mode: 'ANY' } };
  if (choice.type === 'tool') return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.name] } };
  return { functionCallingConfig: { mode: 'AUTO' } };
}

function assistantParts(msg: ChatMessage, useDummySignature: boolean): GeminiPart[] {
  const parts: GeminiPart[] = [];
  if (msg.content.trim()) parts.push({ text: msg.content.trim() });
  for (const call of msg.toolCalls ?? []) {
    let args: Obj = {};
    try {
      const parsed: unknown = JSON.parse(call.arguments || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Obj;
    } catch {
      args = {};
    }
    const signature = signatureByCallId.get(call.id) ?? (useDummySignature ? DUMMY_SIGNATURE : undefined);
    parts.push({ functionCall: { name: call.name, args }, ...(signature ? { thoughtSignature: signature } : {}) });
  }
  return parts;
}

export function buildGeminiContents(messages: ChatMessage[], upstreamModelId: string): { systemTexts: string[]; contents: GeminiContent[] } {
  const systemTexts: string[] = [];
  const contents: GeminiContent[] = [];
  const nameByCallId = new Map<string, string>();
  const useDummy = /gemini-3/i.test(upstreamModelId);
  for (const msg of messages) {
    const clean = msg.content.trim();
    if (msg.role === 'system') {
      if (clean) systemTexts.push(clean);
    } else if (msg.role === 'tool') {
      const part: GeminiPart = {
        functionResponse: { name: nameByCallId.get(msg.toolCallId ?? '') ?? 'tool', response: { content: msg.content } }
      };
      const last = contents[contents.length - 1];
      if (last && last.role === 'user' && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    } else if (msg.role === 'assistant') {
      for (const call of msg.toolCalls ?? []) nameByCallId.set(call.id, call.name);
      const parts = assistantParts(msg, useDummy);
      if (parts.length > 0) contents.push({ role: 'model', parts });
    } else if (clean) contents.push({ role: 'user', parts: [{ text: clean }] });
  }
  return { systemTexts, contents };
}

export function extractGeminiParts(parts: GeminiPart[]): { text: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let text = '';
  for (const part of parts) {
    if (typeof part.text === 'string') text += part.text;
    if (part.functionCall?.name) {
      const id = `toolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      toolCalls.push({ id, name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) });
      if (part.thoughtSignature) rememberSignature(id, part.thoughtSignature);
    }
  }
  return { text: text.trim(), toolCalls };
}
