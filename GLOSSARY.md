# Domain Glossary (Kitsune Router)

Vocabulary aligned with `codebase-design`: **module**, **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**, **locality**.

- **RouterEngine (`Module`):** Deep domain module exposing a small **interface** (`selectRoute`, `evaluateFailure`, `estimateCostUsd`) that hides privacy enforcement, model capability matching, circuit-breaker cooldowns, and fallback order.
- **ProviderPort (`Seam`):** Interface for outbound model inference (`sendCompletion`, `listModels`, `healthCheck`). Justified by multiple concrete **adapters**: `GeminiApiAdapter`, `OpenAICompatAdapter` (OpenRouter / Ollama / custom `/v1`), and `MemoryProviderAdapter` (tests).
- **VaultPort (`Seam`):** Interface for encrypted credential storage (`setSecret`, `getSecret`, `deleteSecret`, `listSlotMetadata`). Justified by `DpapiVaultAdapter` (Windows DPAPI + AES-256-GCM) and `MemoryVaultAdapter` (tests).
- **LedgerPort (`Seam`):** Interface for real request telemetry and token accounting (`record`, `querySummary`, `reset`). Justified by `SqliteLedgerAdapter` (`node:sqlite`) and `MemoryLedgerAdapter` (tests).
- **Inbound Adapters (`McpServerAdapter`, `HttpGatewayAdapter`):** Two real entrypoints sharing the same `RouterEngine` **leverage**: stdio MCP tools for Google Antigravity (`mcp_config.json`) and local HTTP (`127.0.0.1:4319`) serving both OpenAI `/v1/chat/completions` and the Control Plane UI.
- **KeySlot:** User-supplied BYOK credential record containing provider type, tier (`free` or `paid`), masked suffix, allowed models, priority, and transient cooldown state. Never stores or exposes raw secrets in readable state payloads.
- **Sensitivity (`confidential` | `public`):** Payload classification enforced by `PrivacyGuard` inside `RouterEngine`. Blocks `google-ai-studio` `free` tier slots when `confidential` is active so private repositories or LGPD data cannot enter model-training quotas.
- **Kitsune Fox:** Vector mascot built on the 1:1 geometric DNA of MJ Notch (`56x44` space, `1.9px` `#2B2B2B` ink contour, double-catchlight eyes, `Math.atan2` + `0.22` lerp cursor tracking, organic blinks, and live SSE state moods).
