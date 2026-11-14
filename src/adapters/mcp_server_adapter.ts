import type { RouterOrchestrator } from '../app/router_orchestrator.ts';
import { MODEL_CATALOG } from '../domain/model_catalog.ts';
import type { ChatMessage, RoutingPolicy, SensitivityLevel } from '../domain/types.ts';
import {
  findKnownWorkspaces,
  listWorkspaceFiles,
  readWorkspaceFileSafe,
  writeWorkspaceFileSafe
} from './antigravity_workspace_adapter.ts';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const VALID_POLICIES = new Set<RoutingPolicy>(['economy', 'balanced', 'frontier', 'manual']);
const VALID_SENSITIVITIES = new Set<SensitivityLevel>(['confidential', 'public']);

const MCP_TOOLS = [
  {
    name: 'kitsune_route_prompt',
    description: 'Executes a prompt through Kitsune BYOK Multi-Provider Router with PrivacyGuard and automatic 429 rotation.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'User prompt text to execute.' },
        system_prompt: { type: 'string', description: 'Optional system instruction.' },
        model: { type: 'string', description: 'Optional model ID override.' },
        policy: { type: 'string', enum: ['economy', 'balanced', 'frontier', 'manual'] },
        sensitivity: { type: 'string', enum: ['confidential', 'public'] },
        temperature: { type: 'number' },
        max_tokens: { type: 'number' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'kitsune_list_models',
    description: 'Lists curated models, active router profile, and sanitized slot health counts.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'kitsune_usage_summary',
    description: 'Returns SQLite token usage, cost, savings vs Frontier baseline, and recent audit log.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max recent ledger rows (1-200).' } }
    }
  },
  {
    name: 'kitsune_set_active_profile',
    description: 'Updates active model, routing policy, or default sensitivity level.',
    inputSchema: {
      type: 'object',
      properties: {
        activeModelId: { type: 'string' },
        policy: { type: 'string', enum: ['economy', 'balanced', 'frontier', 'manual'] },
        defaultSensitivity: { type: 'string', enum: ['confidential', 'public'] }
      }
    }
  },
  {
    name: 'kitsune_open_pill',
    description: 'Opens the floating Kitsune Compact Pill HUD window showing live mascot and Antigravity MCP request states.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'kitsune_list_workspace_files',
    description: 'Lists files in the active Antigravity project or workspace.',
    inputSchema: {
      type: 'object',
      properties: { workspacePath: { type: 'string', description: 'Absolute workspace path (optional).' } }
    }
  },
  {
    name: 'kitsune_read_workspace_file',
    description: 'Reads a file from an Antigravity project or workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: 'Relative file path inside the workspace.' },
        workspacePath: { type: 'string', description: 'Absolute workspace root path (optional).' }
      },
      required: ['relativePath']
    }
  },
  {
    name: 'kitsune_write_workspace_file',
    description: 'Writes or updates a file in an Antigravity project or workspace with full code.',
    inputSchema: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: 'Relative file path inside the workspace.' },
        content: { type: 'string', description: 'Complete file text content to write.' },
        workspacePath: { type: 'string', description: 'Absolute workspace root path (optional).' }
      },
      required: ['relativePath', 'content']
    }
  }
];

export interface McpServerOptions {
  onOpenPill?: () => Promise<{ launched: boolean; url: string; reason: string }>;
}

export class McpServerAdapter {
  private readonly orchestrator: RouterOrchestrator;
  private readonly options: McpServerOptions;

  constructor(orchestrator: RouterOrchestrator, options: McpServerOptions = {}) {
    this.orchestrator = orchestrator;
    this.options = options;
  }

  async handleMessage(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (!msg || typeof msg !== 'object') {
      return rpcError(null, -32600, 'Invalid JSON-RPC request.');
    }
    const id = msg.id === undefined ? null : msg.id;
    const isNotification = msg.id === undefined;

    if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') {
      return null;
    }

    if (msg.method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'kitsune-router', version: '0.1.0' }
      });
    }

    if (msg.method === 'ping') {
      return rpcResult(id, {});
    }

    const cfg = this.orchestrator.getConfig();
    if (cfg.mcpEnabled === false) {
      if (msg.method === 'tools/list') {
        return rpcResult(id, { tools: [] });
      }
      if (msg.method === 'tools/call') {
        return rpcResult(id, {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Kitsune MCP está DESATIVADO no painel. O Antigravity operará diretamente com seus recursos padrão sem interferência do Kitsune.'
            }
          ]
        });
      }
    }

    if (msg.method === 'tools/list') {
      return rpcResult(id, { tools: MCP_TOOLS });
    }

    if (msg.method === 'tools/call') {
      return this.handleToolCall(id, msg.params ?? {});
    }

    return isNotification ? null : rpcError(id, -32601, `Method not found: ${String(msg.method ?? '')}`);
  }

  startStdio(): void {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      buffer = this.drainBuffer(buffer);
    });
  }

  private drainBuffer(buffer: string): string {
    let rest = buffer;
    while (true) {
      const nlIdx = rest.indexOf('\n');
      if (nlIdx < 0) break;
      const line = rest.slice(0, nlIdx).trim();
      rest = rest.slice(nlIdx + 1);
      if (!line) continue;
      this.processRawLine(line);
    }
    return rest;
  }

  private processRawLine(line: string): void {
    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(line) as JsonRpcRequest;
    } catch {
      writeStdio(rpcError(null, -32700, 'Parse error'));
      return;
    }
    void this.handleMessage(parsed).then((response) => {
      if (response) {
        writeStdio(response);
      }
    });
  }

  private async handleToolCall(id: string | number | null, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const name = typeof params.name === 'string' ? params.name : '';
    const args = isRecord(params.arguments) ? params.arguments : {};

    if (name === 'kitsune_list_models') {
      return this.toolListModels(id);
    }
    if (name === 'kitsune_usage_summary') {
      return this.toolUsageSummary(id, args);
    }
    if (name === 'kitsune_set_active_profile') {
      return this.toolSetProfile(id, args);
    }
    if (name === 'kitsune_route_prompt') {
      return this.toolRoutePrompt(id, args);
    }
    if (name === 'kitsune_open_pill') {
      return this.toolOpenPill(id);
    }
    if (name === 'kitsune_list_workspace_files') {
      return this.toolListWorkspaceFiles(id, args);
    }
    if (name === 'kitsune_read_workspace_file') {
      return this.toolReadWorkspaceFile(id, args);
    }
    if (name === 'kitsune_write_workspace_file') {
      return this.toolWriteWorkspaceFile(id, args);
    }
    return rpcError(id, -32602, `Unknown tool: ${name}`);
  }

  private async toolOpenPill(id: string | number | null): Promise<JsonRpcResponse> {
    if (!this.options.onOpenPill) {
      const port = this.orchestrator.getStateSnapshot(1).config.httpPort;
      return toolTextResult(id, JSON.stringify({ launched: false, url: `http://127.0.0.1:${port}/?mode=pill`, reason: 'HUD indisponivel neste contexto' }, null, 2), false);
    }
    const result = await this.options.onOpenPill();
    return toolTextResult(id, JSON.stringify(result, null, 2), false);
  }

  private toolListModels(id: string | number | null): JsonRpcResponse {
    const snapshot = this.orchestrator.getStateSnapshot(5);
    const payload = {
      activeConfig: snapshot.config,
      configuredSlots: snapshot.slots.map((s) => ({
        id: s.id,
        label: s.label,
        provider: s.provider,
        tier: s.tier,
        enabled: s.enabled,
        priority: s.priority
      })),
      models: MODEL_CATALOG
    };
    return toolTextResult(id, JSON.stringify(payload, null, 2), false);
  }

  private toolUsageSummary(id: string | number | null, args: Record<string, unknown>): JsonRpcResponse {
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 20;
    const summary = this.orchestrator.getStateSnapshot(limit).usage;
    return toolTextResult(id, JSON.stringify(summary, null, 2), false);
  }

  private async toolSetProfile(id: string | number | null, args: Record<string, unknown>): Promise<JsonRpcResponse> {
    const policyRaw = typeof args.policy === 'string' ? (args.policy as RoutingPolicy) : undefined;
    const sensRaw = typeof args.defaultSensitivity === 'string' ? (args.defaultSensitivity as SensitivityLevel) : undefined;
    const activeModelId = typeof args.activeModelId === 'string' ? args.activeModelId : undefined;

    if (policyRaw && !VALID_POLICIES.has(policyRaw)) {
      return toolTextResult(id, `Politica invalida: ${policyRaw}`, true);
    }
    if (sensRaw && !VALID_SENSITIVITIES.has(sensRaw)) {
      return toolTextResult(id, `Sensibilidade invalida: ${sensRaw}`, true);
    }

    const updated = await this.orchestrator.setActiveProfile({
      activeModelId,
      policy: policyRaw,
      defaultSensitivity: sensRaw
    });
    return toolTextResult(id, JSON.stringify(updated, null, 2), false);
  }

  private async toolRoutePrompt(id: string | number | null, args: Record<string, unknown>): Promise<JsonRpcResponse> {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) {
      return toolTextResult(id, 'Parametro obrigatorio "prompt" ausente ou vazio.', true);
    }

    const messages: ChatMessage[] = [];
    if (typeof args.system_prompt === 'string' && args.system_prompt.trim()) {
      messages.push({ role: 'system', content: args.system_prompt.trim() });
    }
    messages.push({ role: 'user', content: prompt });

    const policy = typeof args.policy === 'string' && VALID_POLICIES.has(args.policy as RoutingPolicy)
      ? (args.policy as RoutingPolicy)
      : undefined;
    const sensitivity = typeof args.sensitivity === 'string' && VALID_SENSITIVITIES.has(args.sensitivity as SensitivityLevel)
      ? (args.sensitivity as SensitivityLevel)
      : undefined;

    const outcome = await this.orchestrator.executeCompletion({
      source: 'mcp',
      requestedModel: typeof args.model === 'string' ? args.model : undefined,
      policy,
      sensitivity,
      messages,
      temperature: typeof args.temperature === 'number' ? args.temperature : undefined,
      maxTokens: typeof args.max_tokens === 'number' ? args.max_tokens : undefined
    });

    if (!outcome.ok) {
      return toolTextResult(id, `[${outcome.code}] ${outcome.message}`, true);
    }

    const footer = [
      `---`,
      `slot=${outcome.slot.label} | model=${outcome.model.id} | fallback=${outcome.fallbackUsed}`,
      `tokens=${outcome.completion.inputTokens}in/${outcome.completion.outputTokens}out | cost=$${outcome.estimatedCostUsd} | saved=$${outcome.estimatedSavingsUsd}`
    ].join('\n');

    return toolTextResult(id, `${outcome.completion.text}\n\n${footer}`, false);
  }

  private toolListWorkspaceFiles(id: string | number | null, args: Record<string, unknown>): JsonRpcResponse {
    const ws = typeof args.workspacePath === 'string' && args.workspacePath ? args.workspacePath : process.cwd();
    const files = listWorkspaceFiles(ws, 150);
    return toolTextResult(id, JSON.stringify({ workspace: ws, files }, null, 2), false);
  }

  private async toolReadWorkspaceFile(
    id: string | number | null,
    args: Record<string, unknown>
  ): Promise<JsonRpcResponse> {
    const rel = typeof args.relativePath === 'string' ? args.relativePath : '';
    const ws = typeof args.workspacePath === 'string' && args.workspacePath ? args.workspacePath : process.cwd();
    if (!rel) return toolTextResult(id, 'relativePath obrigatorio', true);
    try {
      const content = await readWorkspaceFileSafe(ws, rel);
      return toolTextResult(id, content, false);
    } catch (err: unknown) {
      return toolTextResult(id, `Erro ao ler arquivo: ${(err as Error).message}`, true);
    }
  }

  private async toolWriteWorkspaceFile(
    id: string | number | null,
    args: Record<string, unknown>
  ): Promise<JsonRpcResponse> {
    const rel = typeof args.relativePath === 'string' ? args.relativePath : '';
    const content = typeof args.content === 'string' ? args.content : '';
    const ws = typeof args.workspacePath === 'string' && args.workspacePath ? args.workspacePath : process.cwd();
    if (!rel) return toolTextResult(id, 'relativePath obrigatorio', true);
    try {
      const res = await writeWorkspaceFileSafe(ws, rel, content);
      return toolTextResult(id, JSON.stringify({ ok: true, file: rel, size: res.sizeBytes }), false);
    } catch (err: unknown) {
      return toolTextResult(id, `Erro ao gravar: ${(err as Error).message}`, true);
    }
  }
}

function writeStdio(obj: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolTextResult(id: string | number | null, text: string, isError: boolean): JsonRpcResponse {
  return rpcResult(id, {
    content: [{ type: 'text', text }],
    isError
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
