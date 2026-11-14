// Adaptador de Workspaces e Arquivos do Antigravity IDE
// Permite ao Chat Kitsune Web navegar, inspecionar e editar arquivos de projetos

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface AntigravityWorkspaceInfo {
  id: string;
  name: string;
  path: string;
  exists: boolean;
}

export interface WorkspaceFileNode {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes?: number;
}

const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  '.venv',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.kitsune-data',
  'pill-profile'
]);

function decodeUriFolder(rawUri: string): string {
  try {
    let clean = rawUri.replace(/^file:\/\/\/?/, '');
    clean = decodeURIComponent(clean);
    return path.normalize(clean);
  } catch {
    return rawUri;
  }
}

export function findKnownWorkspaces(): AntigravityWorkspaceInfo[] {
  const found = new Map<string, AntigravityWorkspaceInfo>();
  const addPath = (rawPath: string) => {
    const norm = path.normalize(rawPath);
    if (!found.has(norm)) {
      found.set(norm, {
        id: Buffer.from(norm).toString('base64url').slice(0, 16),
        name: path.basename(norm) || norm,
        path: norm,
        exists: existsSync(norm)
      });
    }
  };

  addPath(process.cwd());
  const homeDir = os.homedir();
  const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
  const antigravityUser = path.join(appData, 'Antigravity IDE', 'User');

  parseStorageWorkspaces(antigravityUser, addPath);
  parseWorkspaceStorage(antigravityUser, addPath);

  const downloads = path.join(homeDir, 'Downloads');
  ['meu-amigo-jornalista', 'MJ NOTCH COMPANION', 'OpenCut-main', 'API rotativa Gemini'].forEach((sub) => {
    const candidate = path.join(downloads, sub);
    if (existsSync(candidate)) addPath(candidate);
  });
  if (existsSync(path.join(homeDir, 'kitsune-router'))) {
    addPath(path.join(homeDir, 'kitsune-router'));
  }

  return Array.from(found.values()).filter((w) => w.exists);
}

function parseStorageWorkspaces(antigravityUser: string, addPath: (p: string) => void): void {
  const storageJson = path.join(antigravityUser, 'globalStorage', 'storage.json');
  if (!existsSync(storageJson)) return;
  try {
    const parsed = JSON.parse(readFileSync(storageJson, 'utf8'));
    const folders = parsed?.backupWorkspaces?.folders ?? [];
    for (const f of folders) {
      if (typeof f?.folderUri === 'string') addPath(decodeUriFolder(f.folderUri));
    }
  } catch {
    // Ignora erros de leitura de storage.json
  }
}

function parseWorkspaceStorage(antigravityUser: string, addPath: (p: string) => void): void {
  const wsStorageDir = path.join(antigravityUser, 'workspaceStorage');
  if (!existsSync(wsStorageDir)) return;
  try {
    const entries = readdirSync(wsStorageDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wsFile = path.join(wsStorageDir, entry.name, 'workspace.json');
      if (existsSync(wsFile)) {
        try {
          const content = JSON.parse(readFileSync(wsFile, 'utf8'));
          if (typeof content?.folder === 'string') addPath(decodeUriFolder(content.folder));
        } catch {
          // Ignora entradas corrompidas
        }
      }
    }
  } catch {
    // Ignora erros ao listar workspaceStorage
  }
}

export function listWorkspaceFiles(workspaceRoot: string, maxFiles = 100): WorkspaceFileNode[] {
  if (!existsSync(workspaceRoot)) return [];
  const results: WorkspaceFileNode[] = [];

  function scan(currentDir: string, depth: number) {
    if (depth > 3 || results.length >= maxFiles) return;
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const e of entries) {
        if (IGNORED_NAMES.has(e.name) || results.length >= maxFiles) continue;
        const full = path.join(currentDir, e.name);
        const rel = path.relative(workspaceRoot, full);
        if (e.isDirectory()) {
          results.push({ name: e.name, relativePath: rel, isDirectory: true });
          scan(full, depth + 1);
        } else {
          let size = 0;
          try { size = statSync(full).size; } catch {}
          results.push({ name: e.name, relativePath: rel, isDirectory: false, sizeBytes: size });
        }
      }
    } catch {
      // Ignora pastas inacessiveis
    }
  }

  scan(workspaceRoot, 1);
  return results;
}

export async function readWorkspaceFileSafe(workspaceRoot: string, relativePath: string): Promise<string> {
  const safeRoot = path.resolve(workspaceRoot);
  const target = path.resolve(safeRoot, relativePath);
  if (!target.startsWith(safeRoot + path.sep) && target !== safeRoot) {
    throw new Error('Acesso a arquivo fora do workspace proibido.');
  }
  return readFile(target, 'utf8');
}

export async function writeWorkspaceFileSafe(
  workspaceRoot: string,
  relativePath: string,
  content: string
): Promise<{ ok: boolean; sizeBytes: number }> {
  const safeRoot = path.resolve(workspaceRoot);
  const target = path.resolve(safeRoot, relativePath);
  if (!target.startsWith(safeRoot + path.sep)) {
    throw new Error('Tentativa de escrita fora do workspace proibida.');
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  return { ok: true, sizeBytes: Buffer.byteLength(content, 'utf8') };
}
