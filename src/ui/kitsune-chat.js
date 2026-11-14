// Kitsune Chat Web - Interface Conversacional 100% Independente da IDE
// Integracao de Workspaces Antigravity, Streaming SSE e Diretiva Eesel AI

const history = [];
let isStreaming = false;
let currentWorkspace = '';

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

function formatContent(text) {
  const parts = String(text).split(/(```[\s\S]*?```)/g);
  return parts.map((part) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const firstLine = part.slice(3, part.indexOf('\n')).trim();
      const code = part.slice(part.indexOf('\n') + 1, -3);
      const filePathMatch = firstLine.match(/(?:file|path|arquivo):\s*([^\s]+)/i);
      const filePath = filePathMatch ? filePathMatch[1] : '';
      const saveBtn = filePath
        ? `<button type="button" class="carimbo-mini save-file-btn" data-file="${escapeHtml(filePath)}">💾 Salvar em ${escapeHtml(filePath)}</button>`
        : '';
      return `<div class="code-block-wrap"><div class="code-lang"><span>${escapeHtml(firstLine || 'code')}</span>${saveBtn}</div><pre><code class="raw-code">${escapeHtml(code)}</code></pre></div>`;
    }
    return escapeHtml(part).replace(/\n/g, '<br>');
  }).join('');
}

function updateMessageCount() {
  const counter = document.getElementById('chatTokensCounter');
  if (counter) counter.textContent = `${history.length} msgs`;
}

function scrollToBottom() {
  const container = document.getElementById('chatMessages');
  if (container) container.scrollTop = container.scrollHeight;
}

function appendBubble(role, content, meta = {}) {
  const container = document.getElementById('chatMessages');
  if (!container) return null;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role === 'user' ? 'user-bubble' : 'kitsune-bubble'}`;
  const author = role === 'user' ? '👤 Você' : '🦊 Kitsune';
  const tag = meta.model ? `<span class="bubble-tag">${escapeHtml(meta.model)}</span>` : '';
  bubble.innerHTML = `<div class="bubble-header"><span class="bubble-author">${author}</span>${tag}</div><div class="bubble-body">${formatContent(content)}</div>`;
  container.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

async function populateModelsAndWorkspaces() {
  const selModel = document.getElementById('chatModelSelect');
  const selWs = document.getElementById('chatWorkspaceSelect');
  try {
    const stateRes = await fetch('/api/state').then((r) => r.json());
    if (selModel && stateRes?.catalog) {
      selModel.innerHTML = stateRes.catalog.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('');
      if (stateRes.config?.activeModelId) selModel.value = stateRes.config.activeModelId;
    }
  } catch {}

  try {
    const wsRes = await fetch('/api/workspaces').then((r) => r.json());
    if (selWs && wsRes?.workspaces?.length) {
      selWs.innerHTML = wsRes.workspaces.map((w) => `<option value="${escapeHtml(w.path)}">${escapeHtml(w.name)} (${escapeHtml(w.path)})</option>`).join('');
      currentWorkspace = wsRes.workspaces[0].path;
    }
  } catch {}
}

async function loadWorkspaceTree(wsPath) {
  const listEl = document.getElementById('drawerFileList');
  const drawer = document.getElementById('chatFilesDrawer');
  if (!listEl || !drawer) return;
  drawer.hidden = false;
  listEl.innerHTML = '<span class="hint">Carregando arquivos do projeto...</span>';
  try {
    const res = await fetch(`/api/workspaces/tree?path=${encodeURIComponent(wsPath)}`).then((r) => r.json());
    if (!res.files?.length) {
      listEl.innerHTML = '<span class="hint">Nenhum arquivo encontrado.</span>';
      return;
    }
    listEl.innerHTML = res.files.map((f) => `
      <div class="drawer-file-row ${f.isDirectory ? 'is-dir' : 'is-file'}">
        <span class="file-name">${f.isDirectory ? '📁' : '📄'} ${escapeHtml(f.relativePath)}</span>
        ${!f.isDirectory ? `<button type="button" class="carimbo-mini attach-file-btn" data-rel="${escapeHtml(f.relativePath)}">+ Anexar</button>` : ''}
      </div>
    `).join('');
  } catch (err) {
    listEl.innerHTML = `<span class="err-text">Erro ao ler arquivos: ${escapeHtml(err.message)}</span>`;
  }
}

async function attachFileToChat(relPath) {
  const input = document.getElementById('chatInput');
  const ws = document.getElementById('chatWorkspaceSelect')?.value || currentWorkspace;
  if (!input || !ws) return;
  try {
    const res = await fetch('/api/workspaces/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: ws, relativePath: relPath })
    }).then((r) => r.json());
    if (res.content) {
      const snippet = `\n[Contexto do Arquivo: ${relPath}]\n\`\`\`\n${res.content.slice(0, 4000)}\n\`\`\`\n`;
      input.value = (input.value ? input.value + '\n' : '') + snippet;
      input.focus();
      document.getElementById('chatFilesDrawer').hidden = true;
    }
  } catch (err) {
    alert(`Erro ao ler arquivo: ${err.message}`);
  }
}

async function saveFileDirectly(relPath, rawCode) {
  const ws = document.getElementById('chatWorkspaceSelect')?.value || currentWorkspace;
  if (!ws) {
    alert('Selecione um projeto Antigravity ativo primeiro.');
    return;
  }
  try {
    const res = await fetch('/api/workspaces/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: ws, relativePath: relPath, content: rawCode })
    }).then((r) => r.json());
    if (res.ok) {
      alert(`Arquivo ${relPath} gravado com sucesso no projeto (${res.sizeBytes} bytes)!`);
    } else {
      alert(`Erro ao gravar arquivo: ${res.error?.message || 'Falha'}`);
    }
  } catch (err) {
    alert(`Erro ao salvar: ${err.message}`);
  }
}

async function handleStreamResponse(res, bubbleBody, modelId) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') break;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || '';
        accumulated += delta;
        bubbleBody.innerHTML = formatContent(accumulated);
        scrollToBottom();
      } catch {}
    }
  }

  history.push({ role: 'assistant', content: accumulated });
  updateMessageCount();
  window.fox?.setMood?.('celebrating');
}

async function submitChat(prompt) {
  if (!prompt.trim() || isStreaming) return;
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('chatSendBtn');
  const modelSel = document.getElementById('chatModelSelect');
  const humanToggle = document.getElementById('chatHumanModeToggle');
  const modelId = modelSel?.value || 'gemini-3.8-pro';

  history.push({ role: 'user', content: prompt });
  appendBubble('user', prompt);
  if (input) input.value = '';
  updateMessageCount();

  isStreaming = true;
  if (btn) btn.disabled = true;
  window.fox?.setMood?.('routing');

  const botBubble = appendBubble('assistant', 'Pensando...', { model: modelId });
  const bubbleBody = botBubble.querySelector('.bubble-body');

  try {
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kitsune-human-mode': humanToggle?.checked !== false ? '1' : '0'
      },
      body: JSON.stringify({
        model: modelId,
        stream: true,
        messages: history.map((m) => ({ role: m.role, content: m.content }))
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData?.error?.message || `Erro HTTP ${res.status}`;
      bubbleBody.innerHTML = `<span class="err-text">❌ ${escapeHtml(msg)}</span>`;
      window.fox?.setMood?.('dizzy');
      return;
    }

    await handleStreamResponse(res, bubbleBody, modelId);
  } catch (err) {
    bubbleBody.innerHTML = `<span class="err-text">❌ Falha na conexão: ${escapeHtml(err.message)}</span>`;
    window.fox?.setMood?.('dizzy');
  } finally {
    isStreaming = false;
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
}

function initChatListeners() {
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  const clearBtn = document.getElementById('chatClearBtn');
  const wsSelect = document.getElementById('chatWorkspaceSelect');
  const exploreBtn = document.getElementById('chatExploreFilesBtn');
  const closeDrawer = document.getElementById('closeDrawerBtn');

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input) submitChat(input.value);
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form?.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  clearBtn?.addEventListener('click', () => {
    history.length = 0;
    const msgContainer = document.getElementById('chatMessages');
    if (msgContainer) {
      msgContainer.querySelectorAll('.chat-bubble:not(.intro-msg)').forEach((el) => el.remove());
    }
    updateMessageCount();
  });

  wsSelect?.addEventListener('change', (e) => {
    currentWorkspace = e.target.value;
  });

  exploreBtn?.addEventListener('click', () => {
    const ws = wsSelect?.value || currentWorkspace;
    if (ws) loadWorkspaceTree(ws);
  });

  closeDrawer?.addEventListener('click', () => {
    document.getElementById('chatFilesDrawer').hidden = true;
  });

  document.addEventListener('click', (e) => {
    const pill = e.target.closest('.quick-pill');
    if (pill?.dataset?.prompt) submitChat(pill.dataset.prompt);

    const attachBtn = e.target.closest('.attach-file-btn');
    if (attachBtn?.dataset?.rel) attachFileToChat(attachBtn.dataset.rel);

    const saveBtn = e.target.closest('.save-file-btn');
    if (saveBtn?.dataset?.file) {
      const codeWrap = saveBtn.closest('.code-block-wrap');
      const rawCode = codeWrap?.querySelector('.raw-code')?.textContent || '';
      saveFileDirectly(saveBtn.dataset.file, rawCode);
    }
  });
}

populateModelsAndWorkspaces();
initChatListeners();
