// Portoes Uncle Bob estaticos: DAG aciclico, LOC por modulo, funcoes longas, em dash, camadas.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAX_MODULE_LOC = 520;
const MAX_FUNCTION_LOC = 60;
const LAYER_RULES = { domain: ['domain'], ports: ['domain', 'ports'], app: ['domain', 'ports', 'app'] };

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === 'node_modules' || name === 'data' || name.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const failures = [];
const srcFiles = walk(path.join(ROOT, 'src'), ['.ts', '.js']);
const graph = new Map();

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replaceAll('\\', '/');
  const lines = text.split('\n').length;
  if (lines > MAX_MODULE_LOC) failures.push(`LOC ${rel}: ${lines} > ${MAX_MODULE_LOC}`);

  const deps = [...text.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) =>
    path.relative(ROOT, path.resolve(path.dirname(file), m[1])).replaceAll('\\', '/'));
  graph.set(rel, deps);

  const layer = rel.split('/')[1];
  if (LAYER_RULES[layer]) {
    for (const d of deps) {
      const depLayer = d.split('/')[1];
      if (!LAYER_RULES[layer].includes(depLayer)) failures.push(`CAMADA ${rel} importa ${d}`);
    }
  }
  checkFunctionLengths(rel, text);
}

function checkFunctionLengths(rel, text) {
  const lines = text.split('\n');
  const startRe = /^\s*(export\s+)?(async\s+)?(function\s+\w+|(private\s+|public\s+)?(async\s+)?\w+\s*\([^)]*\)[^=;]*\{\s*$)/;
  for (let i = 0; i < lines.length; i++) {
    if (!startRe.test(lines[i]) || /^\s*(if|for|while|switch|catch)\b/.test(lines[i])) continue;
    let depth = 0; let started = false; let j = i;
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
      if (started && depth <= 0) break;
    }
    if (j - i + 1 > MAX_FUNCTION_LOC) failures.push(`FUNCAO ${rel}:${i + 1} tem ${j - i + 1} linhas > ${MAX_FUNCTION_LOC}`);
  }
}

const state = new Map();
function dfs(node, stack) {
  state.set(node, 1);
  for (const d of graph.get(node) ?? []) {
    if (state.get(d) === 1) failures.push(`CICLO ${[...stack, node, d].join(' -> ')}`);
    else if (!state.has(d) && graph.has(d)) dfs(d, [...stack, node]);
  }
  state.set(node, 2);
}
for (const n of graph.keys()) if (!state.has(n)) dfs(n, []);

const textFiles = [...walk(path.join(ROOT, 'src'), ['.ts', '.js', '.html', '.css']), ...walk(ROOT, ['.md']).filter((f) => !f.includes('node_modules'))];
for (const f of textFiles) {
  if (readFileSync(f, 'utf8').includes('\u2014')) failures.push(`EM_DASH ${path.relative(ROOT, f)}`);
}

console.log(`modulos=${srcFiles.length} arestas=${[...graph.values()].flat().length}`);
if (failures.length) {
  console.error(`FALHOU (${failures.length})\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('GATES OK: DAG aciclico, camadas, LOC, funcoes, zero em dash');
