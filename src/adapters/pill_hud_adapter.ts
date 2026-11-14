import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MascotEventPayload, RouterOrchestrator } from '../app/router_orchestrator.ts';

export interface PillLaunchResult {
  launched: boolean;
  url: string;
  reason: string;
}

const HUD_COOLDOWN_MS = 8_000;

export function findWindowsAppBrowser(): string | null {
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const localApp = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localApp ? path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe') : ''
  ];
  for (const exe of candidates) {
    if (exe && fsSync.existsSync(exe)) {
      return exe;
    }
  }
  return null;
}

async function isWithinCooldown(lockPath: string, force: boolean): Promise<boolean> {
  if (force) return false;
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as { ts?: unknown };
    return typeof parsed.ts === 'number' && Date.now() - parsed.ts < HUD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export async function launchPillWindow(
  port: number,
  dataDir: string,
  options: { force?: boolean } = {}
): Promise<PillLaunchResult> {
  const url = `http://127.0.0.1:${port}/?mode=pill`;
  if (process.env.KITSUNE_NO_HUD === '1') {
    return { launched: false, url, reason: 'HUD suprimido via KITSUNE_NO_HUD=1' };
  }
  if (process.platform !== 'win32') {
    return { launched: false, url, reason: `Abra ${url} no navegador` };
  }

  await fs.mkdir(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, 'pill-hud.lock.json');
  if (await isWithinCooldown(lockPath, Boolean(options.force))) {
    return { launched: false, url, reason: 'Widget Pill ja aberto recentemente' };
  }

  const browserExe = findWindowsAppBrowser();
  const profileDir = path.join(dataDir, 'pill-profile');
  const command = browserExe ?? 'cmd.exe';
  const args = browserExe
    ? [`--app=${url}`, `--user-data-dir=${profileDir}`, '--window-size=840,116', '--window-position=280,14']
    : ['/c', 'start', '', url];

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: !browserExe
  });
  child.unref();
  await fs.writeFile(lockPath, JSON.stringify({ ts: Date.now(), url }), 'utf8');
  return { launched: true, url, reason: browserExe ? 'Widget Pill flutuante aberto' : 'Aberto no navegador padrao' };
}

export async function isGatewayListening(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(700)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function subscribeMcpEventRelay(orchestrator: RouterOrchestrator, port: number): () => void {
  const endpoint = `http://127.0.0.1:${port}/api/internal/event`;
  let chain = Promise.resolve();

  const postEvent = async (event: MascotEventPayload): Promise<void> => {
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(800)
      });
    } catch {
      // Relay nunca pode interromper o canal stdio do MCP
    }
  };

  return orchestrator.subscribe((event) => {
    chain = chain.then(() => postEvent(event));
  });
}
