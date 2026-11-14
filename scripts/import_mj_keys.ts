// Script seguro de importacao de chaves do Meu Amigo Jornalista para o Cofre DPAPI do Kitsune Router
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DpapiVaultAdapter, resolveKitsuneDataDir } from '../src/adapters/dpapi_vault_adapter.ts';

async function importMjKeys(): Promise<void> {
  const envPath = 'C:/Users/tharcio/Downloads/meu-amigo-jornalista/.env';
  if (!existsSync(envPath)) {
    console.error('Arquivo .env do Meu Amigo Jornalista nao encontrado em:', envPath);
    return;
  }

  const dataDir = resolveKitsuneDataDir(undefined);
  const vault = new DpapiVaultAdapter(dataDir);
  const content = readFileSync(envPath, 'utf8');
  const lines = content.split('\n');

  const envVars = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) {
      const val = match[2].trim();
      if (val) envVars.set(match[1], val);
    }
  }

  const geminiKeys = [
    envVars.get('VITE_GEMINI_API_KEY_1') || envVars.get('GEMINI_API_KEY'),
    envVars.get('VITE_GEMINI_API_KEY_2'),
    envVars.get('VITE_GEMINI_API_KEY_3'),
    envVars.get('VITE_GEMINI_API_KEY_4')
  ].filter(Boolean) as string[];

  console.log(`Encontradas ${geminiKeys.length} chaves do Google Gemini.`);
  for (let i = 0; i < geminiKeys.length; i++) {
    const key = geminiKeys[i];
    await vault.upsertSlot({
      id: `gemini-mj-${i + 1}`,
      label: `Google AI Studio MJ #${i + 1}`,
      provider: 'google-ai-studio',
      tier: 'free',
      secret: key,
      notes: 'Importada do .env do Meu Amigo Jornalista'
    });
    console.log(`Slot cadastrado no cofre DPAPI: gemini-mj-${i + 1} (${key.slice(0, 4)}...${key.slice(-4)})`);
  }

  const nvidiaKey = envVars.get('VITE_NVIDIA_API_KEY') || envVars.get('NVIDIA_API_KEY');
  if (nvidiaKey) {
    await vault.upsertSlot({
      id: 'nvidia-nemotron-mj',
      label: 'NVIDIA Nemotron MJ',
      provider: 'nvidia' as any,
      tier: 'free',
      secret: nvidiaKey,
      notes: 'Chave NVIDIA Build / NIM Nemotron importada do MJ'
    });
    console.log(`Slot cadastrado no cofre DPAPI: nvidia-nemotron-mj (${nvidiaKey.slice(0, 4)}...${nvidiaKey.slice(-4)})`);
  }

  const deepseekKey = envVars.get('VITE_DEEPSEEK_API_KEY') || envVars.get('DEEPSEEK_API_KEY');
  if (deepseekKey) {
    await vault.upsertSlot({
      id: 'deepseek-mj',
      label: 'DeepSeek MJ',
      provider: 'deepseek',
      tier: 'paid',
      secret: deepseekKey,
      notes: 'Chave DeepSeek Platform importada do MJ'
    });
    console.log(`Slot cadastrado no cofre DPAPI: deepseek-mj (${deepseekKey.slice(0, 4)}...${deepseekKey.slice(-4)})`);
  }

  const anthropicKey = envVars.get('VITE_ANTHROPIC_API_KEY') || envVars.get('ANTHROPIC_API_KEY');
  if (anthropicKey) {
    await vault.upsertSlot({
      id: 'anthropic-mj',
      label: 'Claude Anthropic MJ',
      provider: 'anthropic',
      tier: 'paid',
      secret: anthropicKey,
      notes: 'Chave Anthropic importada do MJ'
    });
    console.log(`Slot cadastrado no cofre DPAPI: anthropic-mj (${anthropicKey.slice(0, 4)}...${anthropicKey.slice(-4)})`);
  }

  // Registra o Free Buffer Comunitario com ad-blocking nativo
  await vault.upsertSlot({
    id: 'freebuff-community',
    label: 'Free Buffer Comunitario (Ad-Block)',
    provider: 'freebuff' as any,
    tier: 'free',
    secret: 'freebuff_public_token',
    notes: 'Gateway publico comunitario com sanitizacao de anuncios'
  });
  console.log('Slot cadastrado no cofre DPAPI: freebuff-community');

  console.log('Todas as chaves do Meu Amigo Jornalista foram salvas com sucesso no cofre DPAPI local!');
}

importMjKeys().catch(console.error);
