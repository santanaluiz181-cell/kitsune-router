// Aliases `claude-*` para o filtro de model discovery do Claude Desktop / Claude Code.
// O cliente recebe o alias; o provider recebe sempre o ID real do upstream.
import type { ModelProfile } from './types.ts';

export const VENDOR_BLOCKLIST = /gpt|mistral|minimax|openai/i;
const ALIAS_SHAPE = /^claude-[a-z0-9][a-z0-9.-]{0,56}$/;

export interface ResolvedClientModel {
  targetId: string | null;
  alias: string | null;
}

function slugify(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/gpt|mistral|minimax|openai/g, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

export function validateAlias(alias: string): string | null {
  if (!ALIAS_SHAPE.test(alias)) return 'Alias deve casar ^claude-[a-z0-9][a-z0-9.-]{0,56}$.';
  if (VENDOR_BLOCKLIST.test(alias)) return 'Alias nao pode conter gpt, mistral, minimax ou openai.';
  return null;
}

export function normalizeCustomAliases(raw: unknown): { ok: true; value: Record<string, string> } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'modelAliases deve ser um objeto alias -> modelo.' };
  const value: Record<string, string> = {};
  for (const [aliasRaw, targetRaw] of Object.entries(raw as Record<string, unknown>)) {
    const alias = aliasRaw.trim().toLowerCase();
    const target = typeof targetRaw === 'string' ? targetRaw.trim() : '';
    const err = validateAlias(alias);
    if (err) return { ok: false, message: `${alias}: ${err}` };
    if (!target) return { ok: false, message: `${alias}: modelo de destino vazio.` };
    value[alias] = target;
  }
  return { ok: true, value };
}

export function buildAutoAliasTable(models: ReadonlyArray<Pick<ModelProfile, 'id'>>): Map<string, string> {
  const table = new Map<string, string>();
  const ids = [...new Set(models.map((m) => m.id))].sort();
  for (const id of ids) {
    const base = `claude-${slugify(id) || 'model'}`.slice(0, 56);
    let alias = base;
    for (let n = 2; table.has(alias); n++) alias = `${base}-${n}`;
    table.set(alias, id);
  }
  return table;
}

export function aliasForModel(
  modelId: string,
  models: ReadonlyArray<Pick<ModelProfile, 'id'>>,
  custom: Record<string, string> = {}
): string {
  for (const [alias, target] of Object.entries(custom)) if (target === modelId) return alias;
  for (const [alias, target] of buildAutoAliasTable(models)) if (target === modelId) return alias;
  return `claude-${slugify(modelId) || 'model'}`;
}

export function resolveClientModel(
  requested: string,
  models: ReadonlyArray<Pick<ModelProfile, 'id' | 'upstreamModelId'>>,
  custom: Record<string, string> = {}
): ResolvedClientModel {
  const wanted = requested.trim();
  if (!wanted) return { targetId: null, alias: null };
  const lowered = wanted.toLowerCase();
  if (custom[lowered]) return { targetId: custom[lowered], alias: lowered };
  const auto = buildAutoAliasTable(models).get(lowered);
  if (auto) return { targetId: auto, alias: lowered };
  const direct = models.find((m) => m.id === wanted || m.upstreamModelId === wanted);
  if (direct) return { targetId: direct.id, alias: aliasForModel(direct.id, models, custom) };
  return { targetId: null, alias: null };
}
