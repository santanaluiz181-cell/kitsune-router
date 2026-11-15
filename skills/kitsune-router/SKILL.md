---
name: kitsune-router
description: Route prompts across linked Google OAuth/AI Studio (Gemini 3.8 Pro, 3.5 Flash, Deep Research), Claude Anthropic, DeepSeek, OpenRouter, and local Ollama accounts through Kitsune Router MCP with PrivacyGuard and live Compact Pill HUD feedback.
---

# Kitsune Router Skill (Antigravity / Codex / Claude CLI Bridge)

Use `kitsune-router` when the user wants to delegate inference across multiple paid or free accounts (Google OAuth, Gemini 3.8 Pro / Deep Research, Claude Sonnet 4.5 / Opus 4, DeepSeek V3 / R1, OpenRouter, or offline Ollama) without leaving confidential code unprotected.

## MCP Tools

1. `kitsune_open_pill`: Launches the floating Kitsune Compact Pill HUD (`http://127.0.0.1:4319/?mode=pill`) so the user can watch live mascot states (`startle`, `routing`, `celebrating`, `dizzy`, `sleeping`) while requests execute.
2. `kitsune_list_models`: Lists available curated models, active router policy, and sanitized account slot health.
3. `kitsune_route_prompt`: Sends `{ prompt, system_prompt, model, policy, sensitivity }` through the priority + 429 failover engine.
   - Always pass `sensitivity: "confidential"` when code or documents contain private keys, PII, or judicial records so `PrivacyGuard` restricts execution to local `ollama` slots only.
   - Use `sensitivity: "public"` for general coding, synthesis, or web-scale research using cloud accounts (`gemini-3.8-pro`, `gemini-deep-research`, `anthropic/claude-sonnet-4-5`, `deepseek/deepseek-reasoner`).
4. `kitsune_set_active_profile`: Changes default `activeModelId`, `policy` (`economy | balanced | frontier | manual`), or `defaultSensitivity`.
5. `kitsune_usage_summary`: Returns token counts, USD spend, and estimated Frontier savings from local SQLite audit ledger.

## Real-Time Pill HUD Architecture

When `node src/cli.ts mcp` runs inside Antigravity or Codex:
- If port `4319` is free, `Kitsune` binds the local HTTP gateway + UI + SSE stream in-process.
- If port `4319` is already served by a running dashboard daemon, the MCP process relays live mood and usage telemetry over loopback `POST /api/internal/event`, animating the floating Pill HUD in real time.

## Account Onboarding Policy

Never read browser cookies silently. Guide the user to open `http://127.0.0.1:4319` -> section `03 // COFRE DPAPI` and either:
- Click **Importar sessao Gemini CLI** (explicit opt-in from `~/.gemini/oauth_creds.json`), or
- Click **Abrir login oficial** to sign into Google, Gemini Web, Claude Console, or DeepSeek and paste their official token into Windows DPAPI encrypted storage.

## Protocolo de Decisão de Roteamento (Gemini 3.8 Flash Low / Eco Mode)

Ao operar no **Gemini 3.8 Flash (Low)** ou ao iniciar tarefas com alta demanda de tokens/cota, o agente DEVE acionar a caixa de múltipla escolha (`ask_question`) para o usuário decidir:
1. **Ligar Kitsune Router MCP**: Ativa as APIs rotativas do cofre (Google AI Studio, WusRouter, NVIDIA, FreeBuffer, Ollama) com failover 429 e proteção de cotas da IDE.
2. **Desligar MCP**: Mantém o fluxo direto no Gemini 3.8 Flash Low nativo da IDE, sem intermediários.

## Feedback de Status Obrigatório

Em respostas de governança ou status do roteador, o assistente deve anexar no encerramento o bloco de feedback demonstrando o estado atual e o comando para alternância:

- **Quando DESLIGADO**:
  ```
  Decisão do Usuário: Desligar MCP (Usar o Gemini 3.8 Flash Low nativo da IDE Antigravity).
  Estado do Servidor: POST /api/config/mcp-toggle acionado → mcpEnabled: false.
  Comportamento Atual: Zero chamadas para o MCP Kitsune Router. Todas as execuções, leituras e escritas rodam diretamente pelo modelo nativo da IDE.
  ```
  *(O usuário pode reativar a qualquer momento dizendo "ligar MCP")*

- **Quando LIGADO**:
  ```
  Decisão do Usuário: Ligar MCP (Usar as APIs rotativas do Kitsune Router).
  Estado do Servidor: POST /api/config/mcp-toggle acionado → mcpEnabled: true.
  Comportamento Atual: Requisições e chamadas roteadas com failover 429 entre as contas do cofre.
  ```
  *(O usuário pode desativar a qualquer momento dizendo "desligar MCP")*


