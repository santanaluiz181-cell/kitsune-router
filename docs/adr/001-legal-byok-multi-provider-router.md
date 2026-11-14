# ADR 001: Legal BYOK Multi-Provider Router via MCP and Local HTTP Gateway

- **Status:** Accepted
- **Date:** 2026-11-13
- **Context:** The original concept proposed creating and rotating multiple free Google AI Studio accounts and scraping the web UI to bypass Antigravity rate limits. Technical and policy audit revealed three blockers: (1) Antigravity's core agent model picker does not accept custom `OPENAI_BASE_URL` overrides; (2) pooling free accounts to evade rate limits violates Google Gemini API Terms of Service and triggers cascade bans; (3) Google AI Studio Free Tier allows human review and model training on submitted prompts/code.
- **Decision:** Narrow the system into **Kitsune Router**, a local BYOK multi-provider router with:
  1. **Two native entrypoints (`McpServerAdapter` + `HttpGatewayAdapter`):** Antigravity delegates sub-tasks via official MCP tools (`kitsune_route_prompt`), while external IDEs/scripts connect via OpenAI-compatible `/v1/chat/completions`.
  2. **Multi-Provider Legal Routing:** Supports Google AI Studio (Free or Paid Tier 1), OpenRouter, and local Ollama behind one `ProviderPort` seam with automatic HTTP 429 cooldown failover.
  3. **Deterministic `PrivacyGuard`:** Blocks `google-ai-studio` `free` slots whenever `sensitivity === "confidential"`.
  4. **Local Encrypted `KeyVault`:** Encrypts keys at rest using Windows DPAPI (`ProtectedData`) with AES-256-GCM fallback.
- **Rejected Alternatives:** Web UI Playwright automation of Google AI Studio; multi-account free-tier farming; binary patching of Antigravity.
- **Consequences:** Zero ToS circumvention risk, deterministic confidential-code protection, native Antigravity integration via `mcp_config.json`, and sub-second startup on Node 24 without heavy dependencies.
