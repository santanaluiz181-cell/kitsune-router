# Plan 001: Kitsune Router MVP (Deep Domain + Dual Inbound Adapters + Fox UI)

- **Status:** DONE
- **Category:** Depth
- **Vocabulary Impact (`GLOSSARY.md`):** `RouterEngine`, `ProviderPort`, `VaultPort`, `LedgerPort`, `McpServerAdapter`, `HttpGatewayAdapter`
- **Allowed Write Scope:**
  - `src/**/*.ts`
  - `src/ui/**/*`
  - `tests/**/*.ts`
  - `scripts/**/*.mjs`

## Problem and Evidence
- Empty workspace starting from scratch. Risk of building shallow CRUD wrappers or leaking secrets/privacy flags across HTTP and MCP layers.

## Target Interface and Deepening Design
- `RouterEngine`: pure functions with small interface (`selectRoute`, `evaluateFailure`, `estimateCostUsd`) hiding privacy guardrails, circuit-breaker cooldowns, and policy ranking.
- `ProviderPort`: satisfied by `GeminiApiAdapter`, `OpenAICompatAdapter`, and `MemoryProviderAdapter`.
- `VaultPort`: satisfied by `DpapiVaultAdapter` and `MemoryVaultAdapter`.
- `LedgerPort`: satisfied by `SqliteLedgerAdapter` and `MemoryLedgerAdapter`.

## Pre-Mortem Guardrails
1. **Null / Edge Inputs:** Reject empty prompt, negative tokens, unknown model policy, or invalid HTTP status without crashing.
2. **Concurrency / Idempotency:** SQLite WAL mode for concurrent reads/writes; per-slot cooldown map updated atomically on HTTP 429/503; DPAPI vault write uses atomic temp-file rename.
3. **Windows / UTF-8 Safety:** UTF-8 everywhere (`chcp` independent via Base64 PowerShell `-EncodedCommand` for DPAPI); `path.join` for all filesystem paths; bind exclusively to `127.0.0.1`.

## Acceptance and Uncle Bob Gate Criteria
1. All unit, integration, and negative/mutation tests pass via `node --test --experimental-test-coverage tests/*.test.ts`.
2. Dependency DAG script confirms zero cycles and zero upward imports (`domain` imports nothing outside `domain`).
3. Function complexity/length audit flags zero functions > 60 lines or nesting > 3 in `src/domain` and `src/adapters`.
4. Live headless Playwright verification on `1440px` and `375px` confirms zero console errors, zero horizontal overflow, real Kitsune mouse tracking, and working Light/Dark theme + interactive flows.
