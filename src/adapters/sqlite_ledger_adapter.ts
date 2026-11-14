import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { UsageLedgerEntry, UsageSummary } from '../domain/types.ts';
import type { LedgerPort } from '../ports/contracts.ts';
import { resolveKitsuneDataDir } from './dpapi_vault_adapter.ts';

interface AggregateRow {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  privacyBlockedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalSavingsUsd: number;
}

interface EntryRow {
  id: number;
  timestampIso: string;
  source: UsageLedgerEntry['source'];
  slotId: string;
  slotLabel: string;
  provider: UsageLedgerEntry['provider'];
  modelId: string;
  sensitivity: UsageLedgerEntry['sensitivity'];
  status: UsageLedgerEntry['status'];
  httpStatus: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  estimatedSavingsUsd: number;
  errorMessage: string | null;
}

export class SqliteLedgerAdapter implements LedgerPort {
  private readonly db: DatabaseSync;

  constructor(dataDir: string = resolveKitsuneDataDir()) {
    mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'ledger.sqlite');
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS usage_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp_iso TEXT NOT NULL,
        source TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        slot_label TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        status TEXT NOT NULL,
        http_status INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        estimated_cost_usd REAL NOT NULL,
        estimated_savings_usd REAL NOT NULL,
        error_message TEXT
      );
    `);
  }

  record(entry: UsageLedgerEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO usage_ledger (
        timestamp_iso, source, slot_id, slot_label, provider, model_id,
        sensitivity, status, http_status, latency_ms, input_tokens,
        output_tokens, estimated_cost_usd, estimated_savings_usd, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.timestampIso,
      entry.source,
      entry.slotId,
      entry.slotLabel,
      entry.provider,
      entry.modelId,
      entry.sensitivity,
      entry.status,
      entry.httpStatus,
      entry.latencyMs,
      entry.inputTokens,
      entry.outputTokens,
      entry.estimatedCostUsd,
      entry.estimatedSavingsUsd,
      entry.errorMessage
    );
  }

  querySummary(limit: number = 30): UsageSummary {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const agg = this.db
      .prepare(`
        SELECT
          COUNT(*) AS totalRequests,
          COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS successfulRequests,
          COALESCE(SUM(CASE WHEN status IN ('fallback_failed', 'error') THEN 1 ELSE 0 END), 0) AS failedRequests,
          COALESCE(SUM(CASE WHEN status = 'privacy_blocked' THEN 1 ELSE 0 END), 0) AS privacyBlockedRequests,
          COALESCE(SUM(input_tokens), 0) AS totalInputTokens,
          COALESCE(SUM(output_tokens), 0) AS totalOutputTokens,
          COALESCE(SUM(estimated_cost_usd), 0) AS totalCostUsd,
          COALESCE(SUM(estimated_savings_usd), 0) AS totalSavingsUsd
        FROM usage_ledger
      `)
      .get() as unknown as AggregateRow;

    const rows = this.db
      .prepare(`
        SELECT
          id,
          timestamp_iso AS timestampIso,
          source,
          slot_id AS slotId,
          slot_label AS slotLabel,
          provider,
          model_id AS modelId,
          sensitivity,
          status,
          http_status AS httpStatus,
          latency_ms AS latencyMs,
          input_tokens AS inputTokens,
          output_tokens AS outputTokens,
          estimated_cost_usd AS estimatedCostUsd,
          estimated_savings_usd AS estimatedSavingsUsd,
          error_message AS errorMessage
        FROM usage_ledger
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(safeLimit) as unknown as EntryRow[];

    return {
      totalRequests: Number(agg?.totalRequests ?? 0),
      successfulRequests: Number(agg?.successfulRequests ?? 0),
      failedRequests: Number(agg?.failedRequests ?? 0),
      privacyBlockedRequests: Number(agg?.privacyBlockedRequests ?? 0),
      totalInputTokens: Number(agg?.totalInputTokens ?? 0),
      totalOutputTokens: Number(agg?.totalOutputTokens ?? 0),
      totalCostUsd: Number(Number(agg?.totalCostUsd ?? 0).toFixed(6)),
      totalSavingsUsd: Number(Number(agg?.totalSavingsUsd ?? 0).toFixed(6)),
      recentEntries: rows.map((row) => ({ ...row }))
    };
  }

  reset(): void {
    this.db.exec('DELETE FROM usage_ledger');
  }

  close(): void {
    this.db.close();
  }
}
