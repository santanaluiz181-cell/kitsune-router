// Tradutor Anthropic tools <-> modelo interno
import type { ChatMessage, ToolCall, ToolChoice, ToolDef } from '../domain/types.ts';

type Obj = Record<string, unknown>;

export interface AnthropicContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Obj;
}

export function buildAnthropicTools(tools?: ToolDef[]): Obj[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description || t.name,
    input_schema: t.inputSchema
  }));
}

export function buildAnthropicToolChoice(choice?: ToolChoice): Obj | undefined {
  if (!choice) return undefined;
  if (choice.type === 'tool') return { type: 'tool', name: choice.name };
  if (choice.type === 'any') return { type: 'any' };
  if (choice.type === 'auto') return { type: 'auto' };
  return undefined;
}

export function buildAnthropicMessages(messages: ChatMessage[]): {
  systemParts: string[];
  turns: Array<{ role: 'user' | 'assistant'; content: unknown }>;
} {
  const systemParts: string[] = [];
  const turns: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content.trim()) systemParts.push(m.content.trim());
      continue;
    }
    if (m.role === 'tool') {
      turns.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId || '', content: m.content }]
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: Obj[] = [];
      if (m.content.trim()) blocks.push({ type: 'text', text: m.content.trim() });
      for (const call of m.toolCalls) {
        let input: Obj = {};
        try {
          input = JSON.parse(call.arguments || '{}') as Obj;
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input });
      }
      turns.push({ role: 'assistant', content: blocks });
      continue;
    }
    turns.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  return { systemParts, turns };
}

export function extractAnthropicResponse(content?: AnthropicContentBlock[]): { text: string; toolCalls?: ToolCall[] } {
  const blocks = content ?? [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') textParts.push(b.text);
    else if (b.type === 'tool_use' && typeof b.name === 'string') {
      toolCalls.push({
        id: b.id || `toolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        name: b.name,
        arguments: JSON.stringify(b.input ?? {})
      });
    }
  }
  return { text: textParts.join('').trim(), ...(toolCalls.length > 0 ? { toolCalls } : {}) };
}
