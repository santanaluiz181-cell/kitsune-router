import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type OfficialLoginTarget =
  | 'google-oauth'
  | 'gemini-web'
  | 'google-ai-studio'
  | 'anthropic'
  | 'deepseek'
  | 'openrouter';

const OFFICIAL_LOGIN_URLS: Readonly<Record<OfficialLoginTarget, string>> = {
  'google-oauth': 'https://accounts.google.com/',
  'gemini-web': 'https://gemini.google.com/app',
  'google-ai-studio': 'https://aistudio.google.com/apikey',
  anthropic: 'https://console.anthropic.com/',
  deepseek: 'https://platform.deepseek.com/api_keys',
  openrouter: 'https://openrouter.ai/keys'
};

export interface GeminiCliCredsResult {
  found: boolean;
  accessToken: string;
  expired: boolean;
  detail: string;
}

export function resolveOfficialLoginUrl(target: string): string | null {
  if (Object.prototype.hasOwnProperty.call(OFFICIAL_LOGIN_URLS, target)) {
    return OFFICIAL_LOGIN_URLS[target as OfficialLoginTarget];
  }
  return null;
}

export function openOfficialLoginBrowser(target: string): { ok: boolean; url: string; detail: string } {
  const url = resolveOfficialLoginUrl(target);
  if (!url) {
    return { ok: false, url: '', detail: `Destino de login nao suportado: ${target}` };
  }

  if (process.env.KITSUNE_NO_HUD === '1' || process.platform !== 'win32') {
    return { ok: true, url, detail: `URL oficial pronta: ${url}` };
  }

  try {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    return { ok: true, url, detail: `Navegador aberto em ${url}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido';
    return { ok: false, url, detail: `Falha ao abrir navegador: ${msg}` };
  }
}

export async function readGeminiCliOAuthCreds(homeDir: string = os.homedir()): Promise<GeminiCliCredsResult> {
  const credsPath = path.join(homeDir, '.gemini', 'oauth_creds.json');
  try {
    const raw = await fs.readFile(credsPath, 'utf8');
    const parsed = JSON.parse(raw) as { access_token?: unknown; expiry_date?: unknown };
    const token = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : '';
    if (!token) {
      return { found: false, accessToken: '', expired: false, detail: 'Arquivo oauth_creds.json sem access_token.' };
    }
    const expiry = typeof parsed.expiry_date === 'number' ? parsed.expiry_date : 0;
    const expired = expiry > 0 && expiry <= Date.now() + 30_000;
    return {
      found: true,
      accessToken: token,
      expired,
      detail: expired
        ? 'Sessao Gemini CLI encontrada, mas o token expirou. Rode auth no Gemini CLI ou cole um token novo.'
        : 'Sessao local Google Gemini CLI detectada.'
    };
  } catch {
    return {
      found: false,
      accessToken: '',
      expired: false,
      detail: 'Nenhuma sessao local em ~/.gemini/oauth_creds.json.'
    };
  }
}
