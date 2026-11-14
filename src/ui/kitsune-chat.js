// Kitsune Chat Web - Interface Conversacional com Tela Cheia Zen e Sessões Persistidas
// Integrado ao Antigravity IDE Transcripts, Projetos Reais de Downloads e Diretiva Eesel AI
const SESSIONS_KEY = 'kitsune_chat_sessions_v2';
const ACTIVE_KEY = 'kitsune_active_session_id';

let sessions = [];
let antigravityConvs = [];
let activeSessionId = null;
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

function loadSessionsFromStorage() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    sessions = raw ? JSON.parse(raw) : [];
  } catch {
    sessions = [];
  }
  if (!Array.isArray(sessions) || sessions.length === 0) {
    sessions = [createSessionObject('Nova Conversa')];
  }
  activeSessionId = localStorage.getItem(ACTIVE_KEY) || sessions[0].id;
  if (!sessions.some((s) => s.id === activeSessionId)) activeSessionId = sessions[0].id;
}

function persistSessions() {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    localStorage.setItem(ACTIVE_KEY, activeSessionId);
  } catch {}
}

function createSessionObject(title = 'Nova Conversa') {
  return {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspace: currentWorkspace || '',
    model: document.getElementById('chatModelSelect')?.value || 'gemini-3.8-pro',
    messages: []
  };
}

function getActiveSession() {
  return sessions.find((s) => s.id === activeSessionId) || sessions[0];
}

async function fetchAntigravityConversations() {
  try {
    const res = await fetch('/api/antigravity/conversations').then((r) => r.json());
    antigravityConvs = res.conversations || [];
    renderAntigravitySessionsList();
  } catch (err) {
    console.error('Erro ao ler conversas Antigravity:', err);
  }
}

function renderAntigravitySessionsList() {
  const container = document.getElementById('antigravitySessionsList');
  if (!container) return;
  if (!antigravityConvs.length) {
    container.innerHTML = '<span class="hint" style="padding:4px 8px;font-size:11px;">Nenhuma conversa recente</span>';
    return;
  }
  container.innerHTML = antigravityConvs.map((c) => {
    const isLinked = getActiveSession()?.linkedAntigravityId === c.id;
    const timeStr = new Date(c.lastModifiedMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const badge = c.isCurrent ? ' <span class="bubble-tag" style="font-size:9px;padding:1px 4px;">Atual</span>' : '';
    return `<div class="session-item ${isLinked ? 'active' : ''}" data-ag-id="${escapeHtml(c.id)}" title="${escapeHtml(c.title)}"><div class="session-info"><span class="session-title">⚡ ${escapeHtml(c.title)}${badge}</span><span class="session-meta">${c.messageCount} msgs · ${timeStr}</span></div></div>`;
  }).join('');
}

async function loadAntigravityConversationIntoSession(convId) {
  const conv = antigravityConvs.find((c) => c.id === convId);
  try {
    const res = await fetch(`/api/antigravity/messages?id=${encodeURIComponent(convId)}`).then((r) => r.json());
    const rawMsgs = res.messages || [];
    const sess = createSessionObject(conv ? conv.title : 'Conversa Antigravity');
    sess.linkedAntigravityId = convId;
    sess.messages = rawMsgs.map((m) => ({
      role: m.role,
      content: m.content,
      model: m.model || (m.role === 'assistant' ? 'Antigravity IDE' : ''),
      timestamp: Date.now()
    }));
    sessions.unshift(sess);
    activeSessionId = sess.id;
    persistSessions();
    renderSessionsList();
    renderAntigravitySessionsList();
    renderActiveSessionMessages();
    window.fox?.speak?.('Conversa do Antigravity carregada!', 'celebrating');
  } catch (err) {
    alert(`Erro ao ler mensagens do Antigravity: ${err.message}`);
  }
}

function renderSessionsList() {
  const container = document.getElementById('chatSessionsList');
  const countEl = document.getElementById('sessionCount');
  if (countEl) countEl.textContent = String(sessions.length);
  if (!container) return;

  container.innerHTML = sessions.map((s) => {
    const isActive = s.id === activeSessionId;
    const msgCount = s.messages.length;
    const timeStr = new Date(s.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const agTag = s.linkedAntigravityId ? '⚡ ' : '💬 ';
    return `<div class="session-item ${isActive ? 'active' : ''}" data-sess-id="${escapeHtml(s.id)}"><div class="session-info"><span class="session-title">${agTag}${escapeHtml(s.title || 'Conversa')}</span><span class="session-meta">${msgCount} msgs · ${timeStr}</span></div>${sessions.length > 1 ? `<button type="button" class="session-del-btn" data-del-id="${escapeHtml(s.id)}" title="Excluir">🗑️</button>` : ''}</div>`;
  }).join('');
}

function renderActiveSessionMessages() {
  const sess = getActiveSession();
  const container = document.getElementById('chatMessages');
  const titleEl = document.getElementById('zenSessionTitle');
  if (titleEl) titleEl.textContent = sess.title || 'Conversa Atual';
  if (!container) return;

  container.innerHTML = '';
  if (!sess.messages.length) {
    const intro = document.createElement('div');
    intro.className = 'chat-bubble kitsune-bubble intro-msg';
    intro.innerHTML = `<div class="bubble-header"><span class="bubble-author">🦊 Kitsune Companion</span><span class="bubble-tag">ONLINE · COTA INDEPENDENTE</span></div><div class="bubble-body"><p>Chat com tela cheia estilo Meu Amigo Jornalista, histórico completo de conversas e integração real com seus projetos na pasta Downloads.</p><div class="quick-prompts"><button type="button" class="quick-pill" data-prompt="Liste os arquivos e a arquitetura geral do projeto ativo">📂 Analisar este projeto</button><button type="button" class="quick-pill" data-prompt="Crie um script TypeScript para demonstrar o uso do Kitsune Router">💡 Exemplo TypeScript</button><button type="button" class="quick-pill" data-prompt="Como funciona a rotação automática quando uma conta recebe erro HTTP 429?">🛡️ Explique o 429 Failover</button></div></div>`;
    container.appendChild(intro);
  } else {
    for (const m of sess.messages) appendBubble(m.role, m.content, { model: m.model, skipSave: true });
  }

  updateMessageCount();
  scrollToBottom();
}

function switchSession(sessId) {
  if (sessId === activeSessionId) return;
  activeSessionId = sessId;
  persistSessions();
  renderSessionsList();
  renderAntigravitySessionsList();
  renderActiveSessionMessages();
}

function startNewSession() {
  const newSess = createSessionObject('Nova Conversa');
  sessions.unshift(newSess);
  activeSessionId = newSess.id;
  persistSessions();
  renderSessionsList();
  renderAntigravitySessionsList();
  renderActiveSessionMessages();
  document.getElementById('chatInput')?.focus();
}

function deleteSession(sessId) {
  if (sessions.length <= 1) return;
  sessions = sessions.filter((s) => s.id !== sessId);
  if (activeSessionId === sessId) activeSessionId = sessions[0].id;
  persistSessions();
  renderSessionsList();
  renderAntigravitySessionsList();
  renderActiveSessionMessages();
}

function updateMessageCount() {
  const counter = document.getElementById('chatTokensCounter');
  const sess = getActiveSession();
  if (counter) counter.textContent = `${sess.messages.length} msgs`;
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

  if (!meta.skipSave) {
    const sess = getActiveSession();
    sess.messages.push({ role, content, model: meta.model || '', timestamp: Date.now() });
    sess.updatedAt = Date.now();
    if (sess.messages.length === 1 && role === 'user') {
      sess.title = content.slice(0, 36).trim() + (content.length > 36 ? '...' : '');
    }
    persistSessions();
    renderSessionsList();
  }
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
  listEl.innerHTML = '<span class="hint">Carregando arquivos do projeto em Downloads...</span>';
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
    alert('Selecione um projeto ativo primeiro.');
    return;
  }
  try {
    const res = await fetch('/api/workspaces/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: ws, relativePath: relPath, content: rawCode })
    }).then((r) => r.json());
    if (res.ok) alert(`Arquivo ${relPath} gravado com sucesso (${res.sizeBytes} bytes)!`);
    else alert(`Erro ao gravar: ${res.error?.message || 'Falha'}`);
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

  const sess = getActiveSession();
  sess.messages.push({ role: 'assistant', content: accumulated, model: modelId, timestamp: Date.now() });
  sess.updatedAt = Date.now();
  persistSessions();
  renderSessionsList();
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

  appendBubble('user', prompt);
  if (input) input.value = '';
  updateMessageCount();
  isStreaming = true;
  if (btn) btn.disabled = true;
  window.fox?.setMood?.('routing');

  const botBubble = appendBubble('assistant', 'Pensando...', { model: modelId, skipSave: true });
  const bubbleBody = botBubble.querySelector('.bubble-body');
  const sess = getActiveSession();

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
        messages: sess.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      bubbleBody.innerHTML = `<span class="err-text">❌ ${escapeHtml(errData?.error?.message || `Erro HTTP ${res.status}`)}</span>`;
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

function openFullscreenChat() {
  const section = document.getElementById('chatSection');
  if (section) {
    section.classList.add('is-fullscreen');
    document.body.style.overflow = 'hidden';
    document.getElementById('chatInput')?.focus();
  }
}

function closeFullscreenChat() {
  const section = document.getElementById('chatSection');
  if (section) {
    section.classList.remove('is-fullscreen');
    document.body.style.overflow = '';
  }
}

function bindChatFormEvents() {
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
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
}

function bindChatControlEvents() {
  document.getElementById('chatExpandBtn')?.addEventListener('click', openFullscreenChat);
  document.getElementById('chatCollapseBtn')?.addEventListener('click', closeFullscreenChat);
  document.getElementById('newChatSessionBtn')?.addEventListener('click', startNewSession);
  document.getElementById('syncAntigravityBtn')?.addEventListener('click', fetchAntigravityConversations);
  document.getElementById('chatClearBtn')?.addEventListener('click', () => {
    const sess = getActiveSession();
    sess.messages = [];
    sess.updatedAt = Date.now();
    persistSessions();
    renderActiveSessionMessages();
  });
  document.getElementById('chatWorkspaceSelect')?.addEventListener('change', (e) => {
    currentWorkspace = e.target.value;
  });
  document.getElementById('chatExploreFilesBtn')?.addEventListener('click', () => {
    const ws = document.getElementById('chatWorkspaceSelect')?.value || currentWorkspace;
    if (ws) loadWorkspaceTree(ws);
  });
  document.getElementById('closeDrawerBtn')?.addEventListener('click', () => {
    document.getElementById('chatFilesDrawer').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFullscreenChat();
  });
}

function bindChatGlobalClickEvents() {
  document.addEventListener('click', (e) => {
    const agItem = e.target.closest('[data-ag-id]');
    if (agItem?.dataset?.agId) return loadAntigravityConversationIntoSession(agItem.dataset.agId);

    const sessItem = e.target.closest('.session-item');
    const delBtn = e.target.closest('.session-del-btn');
    if (delBtn?.dataset?.delId) return deleteSession(delBtn.dataset.delId);
    if (sessItem?.dataset?.sessId) return switchSession(sessItem.dataset.sessId);

    const pill = e.target.closest('.quick-pill');
    if (pill?.dataset?.prompt) submitChat(pill.dataset.prompt);

    const attachBtn = e.target.closest('.attach-file-btn');
    if (attachBtn?.dataset?.rel) attachFileToChat(attachBtn.dataset.rel);

    const saveBtn = e.target.closest('.save-file-btn');
    if (saveBtn?.dataset?.file) {
      const codeWrap = saveBtn.closest('.code-block-wrap');
      saveFileDirectly(saveBtn.dataset.file, codeWrap?.querySelector('.raw-code')?.textContent || '');
    }
  });
}

function initChatListeners() {
  bindChatFormEvents();
  bindChatControlEvents();
  bindChatGlobalClickEvents();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'chat' || window.location.pathname === '/chat') {
    openFullscreenChat();
  }
}

window.kitsuneChat = {
  openFullscreen: openFullscreenChat,
  closeFullscreen: closeFullscreenChat,
  newSession: startNewSession
};

loadSessionsFromStorage();
populateModelsAndWorkspaces().then(() => {
  renderSessionsList();
  renderActiveSessionMessages();
  fetchAntigravityConversations();
});
initChatListeners();
