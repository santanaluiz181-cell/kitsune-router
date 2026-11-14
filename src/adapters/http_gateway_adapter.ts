import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { MascotEventPayload, RouterOrchestrator } from '../app/router_orchestrator.ts';
import { DEFAULT_BASE_URLS, MODEL_CATALOG } from '../domain/model_catalog.ts';
import type {
  ChatMessage,
  MascotMood,
  RoutingPolicy,
  SensitivityLevel
} from '../domain/types.ts';
import { resolveKitsuneDataDir } from './dpapi_vault_adapter.ts';
import {
  BodyLimitError,
  InvalidJsonError,
  VALID_MOODS,
  VALID_POLICIES,
  VALID_SENSITIVITIES,
  buildIntegrationSnippets,
  buildOpenAiCompletionJson,
  parseInternalEvent,
  parseOpenAiMessages,
  readJsonBody,
  sendJson,
  sendOpenAiSseCompletion,
  setLoopbackCorsHeaders,
  validateSlotPayload,
  writeSse
} from './gateway_helpers.ts';
import { launchPillWindow } from './pill_hud_adapter.ts';
import { openOfficialLoginBrowser, readGeminiCliOAuthCreds } from './session_connect_adapter.ts';

const STATIC_FILES: Readonly<Record<string, { file: string; mime: string }>> = {
  '/': { file: 'index.html', mime: 'text/html; charset=utf-8' },
  '/pill': { file: 'index.html', mime: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', mime: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', mime: 'text/css; charset=utf-8' },
  '/kitsune-svg.js': { file: 'kitsune-svg.js', mime: 'application/javascript; charset=utf-8' },
  '/kitsune-mascot.js': { file: 'kitsune-mascot.js', mime: 'application/javascript; charset=utf-8' },
  '/app.js': { file: 'app.js', mime: 'application/javascript; charset=utf-8' },
  '/kitsune-logo.png': { file: 'kitsune-logo.png', mime: 'image/png' },
  '/favicon.ico': { file: 'kitsune-logo.png', mime: 'image/png' },
  '/fonts/fraunces-900.woff2': { file: 'fonts/fraunces-900.woff2', mime: 'font/woff2' },
  '/fonts/bricolage.woff2': { file: 'fonts/bricolage.woff2', mime: 'font/woff2' },
  '/fonts/jetbrains-mono.woff2': { file: 'fonts/jetbrains-mono.woff2', mime: 'font/woff2' }
};

export interface HttpGatewayOptions {
  host?: string;
  port?: number;
  uiDir?: string;
  cliEntryPath?: string;
  dataDir?: string;
  geminiCliHomeDir?: string;
}

export class HttpGatewayAdapter {
  private readonly orchestrator: RouterOrchestrator;
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly uiDir: string;
  private readonly cliEntryPath: string;
  private readonly dataDir: string;
  private readonly geminiCliHomeDir: string;
  private server: Server | null;
  private boundPort: number;

  constructor(orchestrator: RouterOrchestrator, options: HttpGatewayOptions = {}) {
    this.orchestrator = orchestrator;
    this.host = options.host ?? '127.0.0.1';
    this.requestedPort = options.port ?? 4319;
    this.uiDir = path.resolve(options.uiDir ?? path.resolve(process.cwd(), 'src', 'ui'));
    this.cliEntryPath = path.resolve(options.cliEntryPath ?? path.resolve(process.cwd(), 'src', 'cli.ts'));
    this.dataDir = path.resolve(options.dataDir ?? resolveKitsuneDataDir());
    this.geminiCliHomeDir = path.resolve(options.geminiCliHomeDir ?? os.homedir());
    this.server = null;
    this.boundPort = this.requestedPort;
  }

  getPort(): number {
    return this.boundPort;
  }

  async start(): Promise<number> {
    if (this.server) return this.boundPort;
    const server = http.createServer((req, res) => {
      void this.routeHttp(req, res);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.requestedPort, this.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const addr = server.address();
    this.boundPort = addr && typeof addr === 'object' ? addr.port : this.requestedPort;
    return this.boundPort;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const current = this.server;
    this.server = null;
    await new Promise<void>((resolve) => {
      current.close(() => resolve());
    });
  }

  private async routeHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setLoopbackCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlObj = new URL(req.url ?? '/', `http://${this.host}:${this.boundPort}`);
    const pathname = urlObj.pathname;

    try {
      if (req.method === 'GET' && STATIC_FILES[pathname]) {
        await this.serveStatic(res, STATIC_FILES[pathname]);
        return;
      }
      if (req.method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true, service: 'kitsune-router', host: this.host, port: this.boundPort });
        return;
      }
      if (req.method === 'GET' && pathname === '/api/events') {
        this.handleSseEvents(req, res);
        return;
      }
      if (pathname.startsWith('/v1/')) {
        await this.handleOpenAiRoute(req, res, pathname);
        return;
      }
      if (pathname.startsWith('/api/')) {
        await this.handleControlRoute(req, res, pathname);
        return;
      }
      sendJson(res, 404, { error: { message: 'Endpoint nao encontrado', code: 'NOT_FOUND' } });
    } catch (err) {
      const status = err instanceof BodyLimitError ? 413 : err instanceof InvalidJsonError ? 400 : 500;
      const msg = err instanceof Error ? err.message : 'Erro interno do gateway';
      sendJson(res, status, { error: { message: msg, code: 'GATEWAY_ERROR' } });
    }
  }

  private async serveStatic(res: ServerResponse, spec: { file: string; mime: string }): Promise<void> {
    const resolved = path.resolve(this.uiDir, spec.file);
    if (!resolved.startsWith(`${this.uiDir}${path.sep}`)) {
      sendJson(res, 403, { error: { message: 'Caminho proibido' } });
      return;
    }
    const content = await readFile(resolved);
    res.writeHead(200, { 'Content-Type': spec.mime, 'Cache-Control': 'no-store' });
    res.end(content);
  }

  private handleSseEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    writeSse(res, 'mood', this.orchestrator.getStateSnapshot().activeMood);
    const unsubscribe = this.orchestrator.subscribe((event: MascotEventPayload) => {
      writeSse(res, event.type, event);
    });
    const timer = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 20_000);
    req.on('close', () => {
      clearInterval(timer);
      unsubscribe();
    });
  }

  private async handleOpenAiRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (req.method === 'GET' && pathname === '/v1/models') {
      const nowSec = Math.floor(Date.now() / 1000);
      sendJson(res, 200, {
        object: 'list',
        data: MODEL_CATALOG.map((m) => ({ id: m.id, object: 'model', created: nowSec, owned_by: m.provider }))
      });
      return;
    }
    if (req.method === 'POST' && pathname === '/v1/chat/completions') {
      await this.executeOpenAiCompletion(req, res);
      return;
    }
    sendJson(res, 404, { error: { message: 'Rota /v1 nao encontrada' } });
  }

  private async executeOpenAiCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    const messages = parseOpenAiMessages(body.messages);
    if (messages.length === 0) {
      sendJson(res, 400, { error: { message: 'Field "messages" must have at least one message.', type: 'invalid_request_error' } });
      return;
    }
    const headerSens = String(req.headers['x-kitsune-sensitivity'] ?? '');
    const headerPol = String(req.headers['x-kitsune-policy'] ?? '');
    const outcome = await this.orchestrator.executeCompletion({
      source: 'http-v1',
      requestedModel: typeof body.model === 'string' ? body.model : undefined,
      policy: VALID_POLICIES.has(headerPol as RoutingPolicy) ? (headerPol as RoutingPolicy) : undefined,
      sensitivity: VALID_SENSITIVITIES.has(headerSens as SensitivityLevel) ? (headerSens as SensitivityLevel) : undefined,
      messages,
      temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
      maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : undefined
    });
    if (!outcome.ok) {
      if (outcome.retryAfterMs > 0) {
        res.setHeader('Retry-After', String(Math.ceil(outcome.retryAfterMs / 1000)));
      }
      sendJson(res, outcome.httpStatus, { error: { message: outcome.message, type: 'kitsune_routing_error', code: outcome.code } });
      return;
    }
    if (body.stream === true) {
      sendOpenAiSseCompletion(res, outcome);
      return;
    }
    sendJson(res, 200, buildOpenAiCompletionJson(outcome));
  }

  private async handleControlRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (req.method === 'GET' && pathname === '/api/state') {
      const snapshot = this.orchestrator.getStateSnapshot(35);
      sendJson(res, 200, { ...snapshot, integration: buildIntegrationSnippets(this.boundPort, this.cliEntryPath) });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/slots') {
      const parsed = validateSlotPayload(await readJsonBody(req));
      if (!parsed.ok) {
        sendJson(res, 400, { error: { message: parsed.message } });
        return;
      }
      sendJson(res, 201, { slot: await this.orchestrator.upsertSlot(parsed.data) });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/config') {
      const body = await readJsonBody(req);
      const updated = await this.orchestrator.setActiveProfile({
        activeModelId: typeof body.activeModelId === 'string' ? body.activeModelId : undefined,
        policy: VALID_POLICIES.has(body.policy as RoutingPolicy) ? (body.policy as RoutingPolicy) : undefined,
        defaultSensitivity: VALID_SENSITIVITIES.has(body.defaultSensitivity as SensitivityLevel)
          ? (body.defaultSensitivity as SensitivityLevel)
          : undefined
      });
      sendJson(res, 200, { config: updated });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/playground') {
      await this.handlePlaygroundPost(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/mascot/mood') {
      const body = await readJsonBody(req);
      const mood = VALID_MOODS.has(body.mood as MascotMood) ? (body.mood as MascotMood) : 'celebrating';
      const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Interacao no painel';
      this.orchestrator.triggerMood(mood, reason);
      sendJson(res, 200, { ok: true, mood, reason });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/ledger/reset') {
      this.orchestrator.resetLedger();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (await this.handleIntegrationRoute(req, res, pathname)) {
      return;
    }
    await this.handleSlotActionRoute(req, res, pathname);
  }

  private async handleIntegrationRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (req.method === 'POST' && pathname === '/api/internal/event') {
      const parsed = parseInternalEvent(await readJsonBody(req));
      if (!parsed) {
        sendJson(res, 400, { error: { message: 'Evento interno invalido.' } });
        return true;
      }
      this.orchestrator.relayExternalEvent(parsed);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (req.method === 'POST' && pathname === '/api/pill/open') {
      const launched = await launchPillWindow(this.boundPort, this.dataDir, { force: true });
      sendJson(res, 200, launched);
      return true;
    }
    if (req.method === 'POST' && pathname === '/api/accounts/open-login') {
      const body = await readJsonBody(req);
      const target = typeof body.target === 'string' ? body.target : '';
      const result = openOfficialLoginBrowser(target);
      sendJson(res, result.ok ? 200 : 400, result);
      return true;
    }
    if (req.method === 'POST' && pathname === '/api/accounts/import-gemini-cli') {
      await this.handleImportGeminiCli(req, res);
      return true;
    }
    return false;
  }

  private async handleImportGeminiCli(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    const creds = await readGeminiCliOAuthCreds(this.geminiCliHomeDir);
    if (!creds.found || creds.expired) {
      sendJson(res, creds.found ? 409 : 404, { ok: false, expired: creds.expired, detail: creds.detail });
      return;
    }
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Google Account (Gemini CLI)';
    const slot = await this.orchestrator.upsertSlot({
      id: 'google-oauth-gemini-cli',
      label,
      provider: 'google-oauth',
      tier: 'paid',
      baseUrl: DEFAULT_BASE_URLS['google-oauth'],
      secret: creds.accessToken,
      enabled: true,
      priority: 5,
      allowedModels: []
    });
    sendJson(res, 201, { ok: true, expired: false, slot, detail: creds.detail });
  }

  private async handlePlaygroundPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      sendJson(res, 400, { error: { message: 'Digite um prompt para testar o roteador.' } });
      return;
    }
    const messages: ChatMessage[] = [];
    if (typeof body.systemPrompt === 'string' && body.systemPrompt.trim()) {
      messages.push({ role: 'system', content: body.systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: prompt });
    const outcome = await this.orchestrator.executeCompletion({
      source: 'playground',
      requestedModel: typeof body.model === 'string' ? body.model : undefined,
      policy: VALID_POLICIES.has(body.policy as RoutingPolicy) ? (body.policy as RoutingPolicy) : undefined,
      sensitivity: VALID_SENSITIVITIES.has(body.sensitivity as SensitivityLevel) ? (body.sensitivity as SensitivityLevel) : undefined,
      messages
    });
    if (!outcome.ok) {
      sendJson(res, outcome.httpStatus, { ok: false, error: outcome });
      return;
    }
    sendJson(res, 200, outcome);
  }

  private async handleSlotActionRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'api' && parts[1] === 'slots' && parts[2]) {
      const slotId = decodeURIComponent(parts[2]);
      if (req.method === 'DELETE' && parts.length === 3) {
        const deleted = await this.orchestrator.deleteSlot(slotId);
        sendJson(res, deleted ? 200 : 404, { ok: deleted });
        return;
      }
      if (req.method === 'POST' && parts[3] === 'toggle') {
        const body = await readJsonBody(req);
        const slot = await this.orchestrator.toggleSlotEnabled(slotId, Boolean(body.enabled));
        sendJson(res, slot ? 200 : 404, slot ? { slot } : { error: { message: 'Slot nao encontrado' } });
        return;
      }
      if (req.method === 'POST' && parts[3] === 'test') {
        const probe = await this.orchestrator.testSlot(slotId);
        sendJson(res, probe.status === 404 ? 404 : 200, probe);
        return;
      }
    }
    sendJson(res, 404, { error: { message: 'Rota de controle nao encontrada' } });
  }
}
