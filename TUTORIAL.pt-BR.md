# Tutorial: Kitsune Router no seu PC com varias chaves do Google AI Studio

Tempo estimado: 10 minutos. Windows 10/11.

## Passo 1. Pre-requisitos

1. Node.js 24 ou superior: `node --version` deve mostrar `v24.x`. Baixe em https://nodejs.org se precisar.
2. Git (opcional, so para clonar).

## Passo 2. Baixar e iniciar

```powershell
git clone https://github.com/santanaluiz181-cell/kitsune-router.git
cd kitsune-router
npm start
```

Ou de duplo clique em `start-kitsune.bat`. Abra **http://127.0.0.1:4319**.
Para a pilula flutuante: **http://127.0.0.1:4319/?mode=pill** ou `node src/cli.ts hud`.

## Passo 3. Gerar varias chaves no Google AI Studio

1. Entre em https://aistudio.google.com/apikey com a **conta Google A**.
2. Clique em **Create API key** e copie a chave (`AIza...`).
3. Repita em outras contas (B, C, D) usando janela anonima ou trocando de conta.
4. Cada conta tem sua propria cota gratuita. O Kitsune alterna entre elas quando uma recebe `429`.

> [!IMPORTANT]
> Cada chave deve pertencer a uma conta sua. Respeite os termos do Google AI Studio. Chaves free tier podem ter prompts usados para treino, por isso o PrivacyGuard bloqueia prompts `confidential` nelas.

## Passo 4. Cadastrar as chaves no painel

1. No painel, abra **03 // COFRE DPAPI**.
2. Provider: `google-ai-studio`. Cole a chave. De um rotulo (`conta-A`, `conta-B`...). Tier: `free`.
3. Salve. A raposa guarda a chave no cofre se for valida e joga na lixeira se falhar.
4. Repita para cada conta. A chave fica cifrada com Windows DPAPI e nunca volta em texto puro.

## Passo 5. Testar no Playground

Mande um prompt de teste no painel. O `Slot` usado e o modelo aparecem na resposta. Se uma chave bater cota, o proximo slot assume (fallback).

## Passo 6. Usar como API OpenAI (com streaming)

```powershell
curl http://127.0.0.1:4319/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d '{"model":"gemini-3.8-pro","stream":true,"messages":[{"role":"user","content":"Oi, Kitsune"}]}'
```

Em qualquer cliente compativel com OpenAI: Base URL `http://127.0.0.1:4319/v1`, API key qualquer texto.

Cabecalhos opcionais:
- `x-kitsune-sensitivity: confidential` (bloqueia slots free Google)
- `x-kitsune-policy: manual | frontier`

## Passo 7. Conectar no Antigravity (MCP)

Adicione ao `mcp_config.json`, ajustando o caminho:

```json
{
  "mcpServers": {
    "kitsune-router": {
      "command": "node",
      "args": ["C:/CAMINHO/kitsune-router/src/cli.ts", "mcp"]
    }
  }
}
```

Reinicie o Antigravity. A pilula abre sozinha e acompanha cada requisicao.

## Passo 8. Verificar saude

```powershell
npm test
npm run audit:gates
```

## Problemas comuns

| Sintoma | Solucao |
| :--- | :--- |
| `node` nao reconhecido | Reinstale Node 24+ e reabra o terminal |
| Porta 4319 ocupada | Outro Kitsune ja esta rodando; use-o |
| Painel sem imagens/mascote, modo escuro nao muda, nada clica | Quase sempre e uma **instancia antiga** do Kitsune presa na porta 4319 servindo codigo velho. De duplo clique em `start-kitsune.bat` (ele mata a antiga e sobe a nova) e aperte `Ctrl+F5` no navegador |
| `ERRO: porta 4319 ja esta em uso` | Rode o comando que a propria mensagem mostra, ou use `--port 4320` |
| Tudo retorna 429 | Todas as chaves esgotaram a cota; aguarde o `Retry-After` ou adicione mais contas |
| Prompt bloqueado | Era `confidential` e so ha chaves free; use Ollama ou chave paga, ou marque como `public` |

## Usar chave gratuita mesmo com dados revisados pelo Google

Pode, sem problema. O PrivacyGuard so bloqueia prompts marcados como `confidential`. O padrao ja e `defaultSensitivity: public`, entao chaves free funcionam direto. Tenha em mente que o Google pode revisar e treinar com o que passa por chaves free. Nao envie dados sensiveis por elas.

## Passo extra: Antigravity IDE (MCP)

1. Abra o Antigravity, va em **Settings > MCP Servers > Manage / View raw config** (arquivo `mcp_config.json`).
2. Cole o bloco do Passo 7 com o caminho absoluto da pasta, usando `/` e sem erros de digitacao.
3. Salve e reinicie o Antigravity. As ferramentas `kitsune_route_prompt` etc. aparecem na lista de MCP.
4. Se a pilula nao aparecer, rode `node src/cli.ts hud` ou abra `http://127.0.0.1:4319/?mode=pill`.

## Limite conhecido

O streaming SSE e **simulado**: o Kitsune recebe a resposta completa do provedor e a reenvia em chunks por palavra. Streaming real token a token do upstream ainda nao existe.
