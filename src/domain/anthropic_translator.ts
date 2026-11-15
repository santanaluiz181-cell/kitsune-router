// Tradutor puro Anthropic Messages API <-> modelo interno (ChatMessage / ToolCall / CompletionResponse).
import type { ChatMessage, CompletionResponse, ToolCall, ToolChoice, ToolDef } from './types.ts';

type Obj = Record<string, unknown>;

export interface AnthropicParsedRequest {
  model: string;
  stream: boolean;
  maxTokens?: number;
  temperature?: number;
  messages: ChatMessage[];
  tools?: ToolDef[];
  toolChoice?: ToolChoice;
}

export type AnthropicParseResult =
  | { ok: true; value: AnthropicParsedRequest }
  | { ok: false; message: string };

export interface AnthropicSseEvent {
  event: string;
  data: unknown;
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (isObj(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : isObj(b) && b.type === 'image' ? '[imagem omitida]' : ''))
    .filter(Boolean)
    .join('\n');
}

function parseUserBlocks(blocks: unknown[]): ChatMessage[] {
  const results: ChatMessage[] = [];
  const texts: string[] = [];
  for (const b of blocks) {
    if (!isObj(b)) continue;
    if (b.type === 'tool_result') {
      const body = blocksToText(b.content);
      results.push({
        role: 'tool',
        toolCallId: typeof b.tool_use_id === 'string' ? b.tool_use_id : '',
        content: b.is_error === true ? `Error: ${body}` : body || '(sem saida)'
      });
    } else if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    else if (b.type === 'image') texts.push('[imagem omitida]');
  }
  const text = texts.join('\n').trim();
  return text ? [...results, { role: 'user', content: text }] : results;
}

function parseAssistantBlocks(blocks: unknown[]): ChatMessage | null {
  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const b of blocks) {
    if (!isObj(b)) continue;
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    else if (b.type === 'tool_use' && typeof b.name === 'string') {
      toolCalls.push({
        id: typeof b.id === 'string' && b.id ? b.id : newId('toolu'),
        name: b.name,
        arguments: JSON.stringify(isObj(b.input) ? b.input : {})
      });
    }
  }
  const content = texts.join('\n').trim();
  if (!content && toolCalls.length === 0) return null;
  return toolCalls.length > 0 ? { role: 'assistant', content, toolCalls } : { role: 'assistant', content };
}

function parseMessages(raw: unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!isObj(item)) continue;
    const role = item.role === 'assistant' ? 'assistant' : 'user';
    if (typeof item.content === 'string') {
      if (item.content.trim()) out.push({ role, content: item.content });
      continue;
    }
    if (!Array.isArray(item.content)) continue;
    if (role === 'assistant') {
      const msg = parseAssistantBlocks(item.content);
      if (msg) out.push(msg);
    } else out.push(...parseUserBlocks(item.content));
  }
  return out;
}

function parseTools(raw: unknown): ToolDef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tools: ToolDef[] = [];
  for (const t of raw) {
    if (!isObj(t) || typeof t.name !== 'string' || !t.name) continue;
    tools.push({
      name: t.name,
      description: typeof t.description === 'string' ? t.description : '',
      inputSchema: isObj(t.input_schema) ? t.input_schema : { type: 'object', properties: {} }
    });
  }
  return tools.length > 0 ? tools : undefined;
}

function parseToolChoice(raw: unknown): ToolChoice | undefined {
  if (!isObj(raw)) return undefined;
  if (raw.type === 'tool' && typeof raw.name === 'string') return { type: 'tool', name: raw.name };
  if (raw.type === 'auto' || raw.type === 'any' || raw.type === 'none') return { type: raw.type };
  return undefined;
}

export function parseAnthropicRequest(body: Obj): AnthropicParseResult {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, message: 'messages: field required with at least one message.' };
  }
  const system = blocksToText(body.system).trim();
  const turns = parseMessages(body.messages);
  if (turns.length === 0) return { ok: false, message: 'messages: no non-empty content found.' };
  const messages: ChatMessage[] = system ? [{ role: 'system', content: system }, ...turns] : turns;
  const toolChoice = parseToolChoice(body.tool_choice);
  return {
    ok: true,
    value: {
      model: typeof body.model === 'string' ? body.model : '',
      stream: body.stream === true,
      maxTokens: typeof body.max_tokens === 'number' && body.max_tokens > 0 ? body.max_tokens : undefined,
      temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
      messages,
      tools: parseTools(body.tools),
      ...(toolChoice ? { toolChoice } : {})
    }
  };
}

export function estimateInputTokens(messages: ChatMessage[], tools?: ToolDef[]): number {
  let chars = JSON.stringify(tools ?? []).length;
  for (const m of messages) chars += m.content.length + JSON.stringify(m.toolCalls ?? []).length;
  return Math.max(1, Math.ceil(chars / 4));
}

export function safeParseObject(raw: string): Obj {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return isObj(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function stopReasonFor(c: Pick<CompletionResponse, 'toolCalls' | 'finishReason'>): string {
  if (c.toolCalls && c.toolCalls.length > 0) return 'tool_use';
  return /length|max_tokens/i.test(c.finishReason) ? 'max_tokens' : 'end_turn';
}

export function buildAnthropicMessage(c: CompletionResponse, modelAlias: string, id: string = newId('msg')): Obj {
  const content: Obj[] = [];
  if (c.text.trim()) content.push({ type: 'text', text: c.text });
  for (const t of c.toolCalls ?? []) {
    content.push({ type: 'tool_use', id: t.id || newId('toolu'), name: t.name, input: safeParseObject(t.arguments) });
  }
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: modelAlias,
    content,
    stop_reason: stopReasonFor(c),
    stop_sequence: null,
    usage: { input_tokens: c.inputTokens, output_tokens: c.outputTokens }
  };
}

export function buildAnthropicSseEvents(message: Obj): AnthropicSseEvent[] {
  const blocks = (message.content as Obj[]) ?? [];
  const usage = (message.usage as { input_tokens: number; output_tokens: number }) ?? { input_tokens: 0, output_tokens: 0 };
  const events: AnthropicSseEvent[] = [
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: { ...message, content: [], stop_reason: null, usage: { input_tokens: usage.input_tokens, output_tokens: 0 } }
      }
    }
  ];
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({ event: 'content_block_start', data: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } });
      for (const piece of String(block.text).match(/\S+\s*|\s+/g) ?? []) {
        events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } } });
      }
    } else {
      events.push({
        event: 'content_block_start',
        data: { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }
      });
      events.push({
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) } }
      });
    }
    events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index } });
  });
  events.push({
    event: 'message_delta',
    data: { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }
  });
  events.push({ event: 'message_stop', data: { type: 'message_stop' } });
  return events;
}

export function mapRoutingErrorToAnthropic(httpStatus: number, message: string): { status: number; body: Obj } {
  let type = 'api_error';
  if (httpStatus === 400) type = 'invalid_request_error';
  else if (httpStatus === 401) type = 'authentication_error';
  else if (httpStatus === 403) type = 'permission_error';
  else if (httpStatus === 404) type = 'not_found_error';
  else if (httpStatus === 429) type = 'rate_limit_error';
  else if (httpStatus === 503 || httpStatus === 529) type = 'overloaded_error';
  return { status: httpStatus, body: { type: 'error', error: { type, message } } };
}
