// Kitsune Chat Web - Interface Conversacional 100% Independente da IDE
// Conecta direto ao gateway local /v1/chat/completions com Streaming SSE

const history = [];
let isStreaming = false;

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
      return `<div class="code-block-wrap"><div class="code-lang">${escapeHtml(firstLine || 'code')}</div><pre><code>${escapeHtml(code)}</code></pre></div>`;
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
  
  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="bubble-author">${author}</span>
      ${tag}
    </div>
    <div class="bubble-body">${formatContent(content)}</div>
  `;
  container.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

async function populateModels() {
  const sel = document.getElementById('chatModelSelect');
  if (!sel) return;
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    if (data?.catalog) {
      sel.innerHTML = data.catalog.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('');
      if (data.config?.activeModelId) sel.value = data.config.activeModelId;
    }
  } catch {
    sel.innerHTML = '<option value="gemini-3.8-pro">Gemini 3.8 Pro (Google)</option>';
  }
}

async function handleStreamResponse(res, bubbleBody, modelId, startTime) {
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
      } catch {
        // Ignora chunks incompletos
      }
    }
  }

  const elapsed = Date.now() - startTime;
  history.push({ role: 'assistant', content: accumulated });
  updateMessageCount();
  window.fox?.setMood?.('celebrating');
}

async function submitChat(prompt) {
  if (!prompt.trim() || isStreaming) return;
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('chatSendBtn');
  const modelSel = document.getElementById('chatModelSelect');
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
  const startTime = Date.now();

  try {
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    await handleStreamResponse(res, bubbleBody, modelId, startTime);
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

  document.addEventListener('click', (e) => {
    const pill = e.target.closest('.quick-pill');
    if (pill?.dataset?.prompt) {
      submitChat(pill.dataset.prompt);
    }
  });
}

populateModels();
initChatListeners();
