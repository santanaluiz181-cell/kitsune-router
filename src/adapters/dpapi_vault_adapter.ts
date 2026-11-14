import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_BASE_URLS } from '../domain/model_catalog.ts';
import type { KeySlotMetadata, RouterConfig } from '../domain/types.ts';
import type { SlotCreateInput, VaultPort } from '../ports/contracts.ts';
import { maskKey } from './memory_adapters.ts';

interface EncryptedSecretRecord {
  scheme: 'dpapi-win' | 'aes-256-gcm';
  payload: string;
}

interface PersistedVaultDocument {
  version: 1;
  config: RouterConfig;
  slots: KeySlotMetadata[];
  secrets: Record<string, EncryptedSecretRecord>;
}

export interface SecretCipher {
  encrypt(plaintext: string): Promise<EncryptedSecretRecord>;
  decrypt(record: EncryptedSecretRecord): Promise<string>;
}

const DEFAULT_CONFIG: RouterConfig = {
  activeModelId: 'gemini-3.8-flash',
  policy: 'balanced',
  defaultSensitivity: 'public',
  httpPort: 4319
};

export function resolveKitsuneDataDir(explicitDir?: string): string {
  if (explicitDir && explicitDir.trim()) {
    return path.resolve(explicitDir.trim());
  }
  if (process.env.KITSUNE_DATA_DIR && process.env.KITSUNE_DATA_DIR.trim()) {
    return path.resolve(process.env.KITSUNE_DATA_DIR.trim());
  }
  return path.resolve(process.cwd(), 'data');
}

export class WindowsDpapiCipher implements SecretCipher {
  async encrypt(plaintext: string): Promise<EncryptedSecretRecord> {
    if (process.platform !== 'win32') {
      return encryptAesFallback(plaintext);
    }
    const script = [
      '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Security',
      '$raw = [Console]::In.ReadToEnd()',
      '$bytes = [System.Text.Encoding]::UTF8.GetBytes($raw)',
      '$prot = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[Console]::Out.Write([Convert]::ToBase64String($prot))'
    ].join('; ');
    const payload = await runEncodedPowerShell(script, plaintext);
    return { scheme: 'dpapi-win', payload };
  }

  async decrypt(record: EncryptedSecretRecord): Promise<string> {
    if (record.scheme === 'aes-256-gcm') {
      return decryptAesFallback(record.payload);
    }
    if (process.platform !== 'win32') {
      throw new Error('Registros dpapi-win nao podem ser descriptografados fora do Windows.');
    }
    const script = [
      '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Security',
      '$b64 = [Console]::In.ReadToEnd().Trim()',
      '$bytes = [Convert]::FromBase64String($b64)',
      '$unprot = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($unprot))'
    ].join('; ');
    return runEncodedPowerShell(script, record.payload);
  }
}

export class DpapiVaultAdapter implements VaultPort {
  private readonly filePath: string;
  private readonly cipher: SecretCipher;
  private doc: PersistedVaultDocument;
  private writeQueue: Promise<void>;

  constructor(dataDir: string = resolveKitsuneDataDir(), cipher: SecretCipher = new WindowsDpapiCipher()) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'vault.enc.json');
    this.cipher = cipher;
    this.doc = loadVaultDocument(this.filePath);
    this.writeQueue = Promise.resolve();
  }

  listSlotMetadata(): KeySlotMetadata[] {
    return this.doc.slots.map((slot) => ({ ...slot, allowedModels: [...slot.allowedModels] }));
  }

  getSlotMetadata(slotId: string): KeySlotMetadata | undefined {
    const found = this.doc.slots.find((slot) => slot.id === slotId);
    return found ? { ...found, allowedModels: [...found.allowedModels] } : undefined;
  }

  async upsertSlot(input: SlotCreateInput): Promise<KeySlotMetadata> {
    const id = sanitizeSlotId(input.id);
    const existing = this.doc.slots.find((item) => item.id === id);
    const trimmedSecret = input.secret.trim();

    if (trimmedSecret) {
      this.doc.secrets[id] = await this.cipher.encrypt(trimmedSecret);
    } else if (!existing && input.provider === 'ollama') {
      this.doc.secrets[id] = await this.cipher.encrypt('');
    } else if (!existing && input.provider !== 'ollama') {
      throw new Error('Novo slot exige chave API preenchida.');
    }

    const secretForMask = trimmedSecret || (existing ? await this.safePeekSecret(id) : '');
    const nextSlot: KeySlotMetadata = {
      id,
      label: input.label.trim() || id,
      provider: input.provider,
      tier: input.tier,
      baseUrl: input.baseUrl.trim() || DEFAULT_BASE_URLS[input.provider],
      maskedSecret: maskKey(secretForMask, input.provider),
      enabled: input.enabled,
      priority: Number.isFinite(input.priority) ? Math.floor(input.priority) : 10,
      allowedModels: cleanModelList(input.allowedModels),
      cooldownUntilMs: existing?.cooldownUntilMs ?? 0,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      authInvalid: trimmedSecret ? false : (existing?.authInvalid ?? false),
      lastError: trimmedSecret ? null : (existing?.lastError ?? null),
      createdAtIso: existing?.createdAtIso ?? new Date().toISOString(),
      lastUsedAtIso: existing?.lastUsedAtIso ?? null
    };

    const idx = this.doc.slots.findIndex((item) => item.id === id);
    if (idx >= 0) {
      this.doc.slots[idx] = nextSlot;
    } else {
      this.doc.slots.push(nextSlot);
    }

    await this.persist();
    return { ...nextSlot, allowedModels: [...nextSlot.allowedModels] };
  }

  async updateSlotMetadata(slot: KeySlotMetadata): Promise<void> {
    const idx = this.doc.slots.findIndex((item) => item.id === slot.id);
    if (idx < 0) return;
    this.doc.slots[idx] = { ...slot, allowedModels: [...slot.allowedModels] };
    await this.persist();
  }

  async deleteSlot(slotId: string): Promise<boolean> {
    const initialLen = this.doc.slots.length;
    this.doc.slots = this.doc.slots.filter((item) => item.id !== slotId);
    delete this.doc.secrets[slotId];
    if (this.doc.slots.length === initialLen) {
      return false;
    }
    await this.persist();
    return true;
  }

  async getSecret(slotId: string): Promise<string | null> {
    const record = this.doc.secrets[slotId];
    if (!record) return null;
    return this.cipher.decrypt(record);
  }

  getConfig(): RouterConfig {
    return { ...this.doc.config };
  }

  async saveConfig(config: RouterConfig): Promise<void> {
    this.doc.config = { ...config };
    await this.persist();
  }

  private async safePeekSecret(slotId: string): Promise<string> {
    try {
      return (await this.getSecret(slotId)) ?? '';
    } catch {
      return '';
    }
  }

  private persist(): Promise<void> {
    const serialized = JSON.stringify(this.doc, null, 2);
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    this.writeQueue = this.writeQueue.then(async () => {
      await writeFile(tmpPath, serialized, { encoding: 'utf8', mode: 0o600 });
      await rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }
}

function loadVaultDocument(filePath: string): PersistedVaultDocument {
  if (!existsSync(filePath)) {
    return {
      version: 1,
      config: { ...DEFAULT_CONFIG },
      slots: [],
      secrets: {}
    };
  }
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    return {
      version: 1,
      config: { ...DEFAULT_CONFIG },
      slots: [],
      secrets: {}
    };
  }
  const parsed = JSON.parse(raw) as Partial<PersistedVaultDocument>;
  return {
    version: 1,
    config: {
      activeModelId: parsed.config?.activeModelId || DEFAULT_CONFIG.activeModelId,
      policy: parsed.config?.policy || DEFAULT_CONFIG.policy,
      defaultSensitivity: parsed.config?.defaultSensitivity || DEFAULT_CONFIG.defaultSensitivity,
      httpPort: parsed.config?.httpPort || DEFAULT_CONFIG.httpPort
    },
    slots: Array.isArray(parsed.slots) ? parsed.slots : [],
    secrets: parsed.secrets && typeof parsed.secrets === 'object' ? parsed.secrets : {}
  };
}

function sanitizeSlotId(rawId: string): string {
  const clean = rawId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!clean) {
    return `slot-${Date.now().toString(36)}`;
  }
  return clean;
}

function cleanModelList(models: ReadonlyArray<string>): string[] {
  return [...new Set(models.map((item) => item.trim()).filter(Boolean))];
}

function runEncodedPowerShell(script: string, stdinUtf8: string): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`DPAPI PowerShell falhou (codigo ${code}): ${stderr || 'erro desconhecido'}`));
      }
    });

    child.stdin.end(stdinUtf8, 'utf8');
  });
}

function deriveLocalMachineKey(): Buffer {
  const seed = `${os.hostname()}:${os.userInfo().username}:kitsune-vault-v1`;
  return createHash('sha256').update(seed).digest();
}

function encryptAesFallback(plaintext: string): EncryptedSecretRecord {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveLocalMachineKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    scheme: 'aes-256-gcm',
    payload: Buffer.concat([iv, tag, encrypted]).toString('base64')
  };
}

function decryptAesFallback(payloadB64: string): string {
  const raw = Buffer.from(payloadB64, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', deriveLocalMachineKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
