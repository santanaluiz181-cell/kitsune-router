// Tradutor OpenAI-compat tools <-> modelo interno
import type { ChatMessage, ToolCall, ToolChoice, ToolDef } from '../domain/types.ts';

type Obj = Record<string, unknown>;

export interface OpenAiChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string;
}

export function buildOpenAiTools(tools?: ToolDef[]): Obj[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || t.name,
      parameters: t.inputSchema
    }
  }));
}

export function buildOpenAiToolChoice(choice?: ToolChoice): unknown {
  if (!choice) return undefined;
  if (choice.type === 'tool') return { type: 'function', function: { name: choice.name } };
  if (choice.type === 'any') return 'required';
  return choice.type;
}

export function buildOpenAiMessages(messages: ChatMessage[]): Obj[] {
  const result: Obj[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      result.push({ role: 'tool', tool_call_id: m.toolCallId || '', content: m.content });
      continue;
    }
    const base: Obj = { role: m.role, content: m.content || '' };
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments }
      }));
    }
    result.push(base);
  }
  return result;
}

export function extractOpenAiResponse(firstChoice?: OpenAiChoice): { text: string; toolCalls?: ToolCall[] } {
  const msg = firstChoice?.message;
  const rawContent = msg?.content ?? '';
  const text = typeof rawContent === 'string' ? rawContent.trim() : '';
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(msg?.tool_calls)) {
    for (const tc of msg.tool_calls) {
      const name = tc.function?.name;
      if (typeof name === 'string' && name) {
        toolCalls.push({
          id: tc.id || `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
          name,
          arguments: tc.function?.arguments || '{}'
        });
      }
    }
  }
  return { text, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
}
