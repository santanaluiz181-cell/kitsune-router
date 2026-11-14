// Adaptador de Conversas e Transcripts do Antigravity IDE
// Permite ao Chat Kitsune Web abrir e continuar conversas ativas do Antigravity

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AntigravityConversationSummary {
  id: string;
  title: string;
  lastModifiedMs: number;
  messageCount: number;
  preview: string;
  isCurrent: boolean;
}

export interface AntigravityMessage {
  role: 'user' | 'assistant';
  content: string;
  timestampIso?: string;
  model?: string;
}

export function resolveAntigravityBrainDir(): string {
  const home = os.homedir();
  const candidate = path.join(home, '.gemini', 'antigravity', 'brain');
  return existsSync(candidate) ? candidate : '';
}

function cleanUserContent(raw: string): string {
  let text = raw.replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/gi, '$1');
  text = text.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '');
  text = text.replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '');
  return text.trim();
}

function extractFirstPromptTitle(firstLineJson: string): string {
  try {
    const parsed = JSON.parse(firstLineJson);
    const content = cleanUserContent(parsed.content || '');
    if (!content) return 'Conversa Antigravity';
    return content.slice(0, 42).trim() + (content.length > 42 ? '...' : '');
  } catch {
    return 'Conversa Antigravity';
  }
}

export function listAntigravityConversations(limit = 15, brainDirOverride?: string): AntigravityConversationSummary[] {
  const brainDir = brainDirOverride || resolveAntigravityBrainDir();
  if (!brainDir || !existsSync(brainDir)) return [];

  let entries: string[] = [];
  try {
    entries = readdirSync(brainDir);
  } catch {
    return [];
  }

  const result: AntigravityConversationSummary[] = [];
  for (const name of entries) {
    if (name.startsWith('.') || name === 'tempmediaStorage') continue;
    const convPath = path.join(brainDir, name);
    const transcriptPath = path.join(convPath, '.system_generated', 'logs', 'transcript.jsonl');
    if (!existsSync(transcriptPath)) continue;

    try {
      const stats = statSync(transcriptPath);
      const head = readFileSync(transcriptPath, 'utf8').split('\n');
      const firstUserLine = head.find((l) => l.includes('"type":"USER_INPUT"')) || '';
      const title = firstUserLine ? extractFirstPromptTitle(firstUserLine) : `Conversa ${name.slice(0, 8)}`;
      const messageCount = head.filter((l) => l.includes('"type":"USER_INPUT"') || l.includes('"type":"PLANNER_RESPONSE"')).length;

      result.push({
        id: name,
        title,
        lastModifiedMs: stats.mtimeMs,
        messageCount,
        preview: title,
        isCurrent: false
      });
    } catch {
      // Ignora erro de leitura de transcript corrompido
    }
  }

  result.sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  if (result.length > 0) {
    result[0].isCurrent = true;
  }
  return result.slice(0, limit);
}

export function getAntigravityTranscriptMessages(conversationId: string, maxMessages = 100, brainDirOverride?: string): AntigravityMessage[] {
  const brainDir = brainDirOverride || resolveAntigravityBrainDir();
  if (!brainDir || !existsSync(brainDir)) return [];

  const cleanId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '');
  const transcriptPath = path.join(brainDir, cleanId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!existsSync(transcriptPath)) return [];

  const messages: AntigravityMessage[] = [];
  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.type === 'USER_INPUT' && item.content) {
          const cleanText = cleanUserContent(item.content);
          if (cleanText) {
            messages.push({
              role: 'user',
              content: cleanText,
              timestampIso: item.created_at
            });
          }
        } else if (item.type === 'PLANNER_RESPONSE' && item.content) {
          messages.push({
            role: 'assistant',
            content: item.content,
            timestampIso: item.created_at,
            model: 'antigravity-ide'
          });
        }
      } catch {
        // Ignora linhas mal formatadas
      }
    }
  } catch {
    return [];
  }

  return messages.slice(-maxMessages);
}
