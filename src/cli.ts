import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DpapiVaultAdapter, resolveKitsuneDataDir } from './adapters/dpapi_vault_adapter.ts';
import { HttpGatewayAdapter } from './adapters/http_gateway_adapter.ts';
import { McpServerAdapter } from './adapters/mcp_server_adapter.ts';
import { MultiProviderAdapter } from './adapters/multi_provider_adapter.ts';
import {
  isGatewayListening,
  launchPillWindow,
  subscribeMcpEventRelay
} from './adapters/pill_hud_adapter.ts';
import { SqliteLedgerAdapter } from './adapters/sqlite_ledger_adapter.ts';
import { RouterOrchestrator } from './app/router_orchestrator.ts';

interface CliArgs {
  command: string;
  port?: number;
  dataDir?: string;
  noHud: boolean;
}

function reportPortInUse(err: unknown, port: number): boolean {
  if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
    return false;
  }
  process.stderr.write(
    `ERRO: porta ${port} ja esta em uso por uma instancia ANTIGA do Kitsune (codigo velho, sem imagens).\n` +
      `Feche-a e rode de novo:  powershell -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"\n` +
      `Ou use outra porta:       node src/cli.ts serve --port ${port + 1}\n`
  );
  process.exitCode = 1;
  return true;
}

function parseCliArgs(argv: string[]): CliArgs {
  const [command = 'serve', ...rest] = argv;
  let port: number | undefined;
  let dataDir: string | undefined;
  let noHud = false;

  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--port' && rest[i + 1]) {
      const parsed = Number(rest[++i]);
      if (Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535) {
        port = parsed;
      }
    } else if (flag === '--data-dir' && rest[i + 1]) {
      dataDir = rest[++i];
    } else if (flag === '--no-hud') {
      noHud = true;
    }
  }
  return { command, port, dataDir, noHud };
}

async function startMcpSession(
  orchestrator: RouterOrchestrator,
  ledger: SqliteLedgerAdapter,
  targetPort: number,
  resolvedDataDir: string,
  noHud: boolean
): Promise<void> {
  const cliEntryPath = fileURLToPath(import.meta.url);
  const uiDir = path.join(path.resolve(path.dirname(cliEntryPath), '..'), 'src', 'ui');
  let localGateway: HttpGatewayAdapter | null = null;
  let stopRelay: (() => void) | null = null;

  if (await isGatewayListening(targetPort)) {
    stopRelay = subscribeMcpEventRelay(orchestrator, targetPort);
  } else {
    try {
      localGateway = new HttpGatewayAdapter(orchestrator, {
        port: targetPort,
        uiDir,
        cliEntryPath,
        dataDir: resolvedDataDir
      });
      await localGateway.start();
    } catch {
      localGateway = null;
      stopRelay = subscribeMcpEventRelay(orchestrator, targetPort);
    }
  }

  const onOpenPill = () => launchPillWindow(targetPort, resolvedDataDir, { force: true });
  const mcp = new McpServerAdapter(orchestrator, { onOpenPill });
  mcp.startStdio();

  if (!noHud) {
    void launchPillWindow(targetPort, resolvedDataDir, { force: false });
  }

  const cleanup = async () => {
    stopRelay?.();
    if (localGateway) {
      await localGateway.stop();
    }
    ledger.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void cleanup());
  process.on('SIGTERM', () => void cleanup());
}

async function startGatewayServer(
  orchestrator: RouterOrchestrator,
  ledger: SqliteLedgerAdapter,
  targetPort: number,
  resolvedDataDir: string,
  isHud: boolean
): Promise<void> {
  const cliEntryPath = fileURLToPath(import.meta.url);
  const uiDir = path.join(path.resolve(path.dirname(cliEntryPath), '..'), 'src', 'ui');
  const gateway = new HttpGatewayAdapter(orchestrator, {
    port: targetPort,
    uiDir,
    cliEntryPath,
    dataDir: resolvedDataDir
  });

  const activePort = await gateway.start().catch((err: unknown) => {
    if (!reportPortInUse(err, targetPort)) throw err;
    return -1;
  });
  if (activePort < 0) {
    ledger.close();
    return;
  }
  process.stdout.write(`Kitsune Router online em http://127.0.0.1:${activePort}\n`);
  process.stdout.write(`Widget Pill HUD em http://127.0.0.1:${activePort}/?mode=pill\n`);
  process.stdout.write(`Endpoint OpenAI /v1 em http://127.0.0.1:${activePort}/v1\n`);

  if (isHud) {
    await launchPillWindow(activePort, resolvedDataDir, { force: true });
  }

  const shutdown = async () => {
    await gateway.stop();
    ledger.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function main(): Promise<void> {
  const { command, port, dataDir, noHud } = parseCliArgs(process.argv.slice(2));
  const resolvedDataDir = resolveKitsuneDataDir(dataDir);
  const vault = new DpapiVaultAdapter(resolvedDataDir);
  const ledger = new SqliteLedgerAdapter(resolvedDataDir);
  const provider = new MultiProviderAdapter();
  const orchestrator = new RouterOrchestrator({ vault, ledger, provider });
  const targetPort = port ?? vault.getConfig().httpPort;

  if (command === 'mcp') {
    await startMcpSession(orchestrator, ledger, targetPort, resolvedDataDir, noHud);
    return;
  }
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(orchestrator.getStateSnapshot(10), null, 2)}\n`);
    ledger.close();
    return;
  }
  if (command === 'hud' && (await isGatewayListening(targetPort))) {
    const res = await launchPillWindow(targetPort, resolvedDataDir, { force: true });
    process.stdout.write(`${res.reason}: ${res.url}\n`);
    ledger.close();
    return;
  }

  await startGatewayServer(orchestrator, ledger, targetPort, resolvedDataDir, command === 'hud');
}
  process.on('SIGTERM', () => void shutdown());
}

void main();
