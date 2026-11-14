import { KitsuneMascot } from '/kitsune-mascot.js';

const $ = (id) => document.getElementById(id);
const fox = new KitsuneMascot($('kitsune'), $('bubble'), $('island'), { uid: 'stage' });
const pillFox = new KitsuneMascot($('pillKitsune'), null, $('pillAura'), { uid: 'pill', compact: true });
const PROVIDER_LABEL = {
  'google-oauth': 'Google Account OAuth',
  'google-ai-studio': 'Google AI Studio',
  anthropic: 'Claude / Anthropic',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  ollama: 'Ollama Local',
  'openai-compat': 'OpenAI compatível'
};
const PROVIDER_PLACEHOLDER = {
  'google-oauth': 'ya29... ou JSON OAuth local',
  'google-ai-studio': 'AIza...',
  anthropic: 'sk-ant-...',
  deepseek: 'sk-...',
  openrouter: 'sk-or-...',
  ollama: '(opcional para Ollama local)',
  'openai-compat': 'sk-...'
};
const TIER_LABEL = { free: 'gratuito', paid: 'pago', local: 'local' };
const MOOD_STAMP = {
  idle: 'IDLE · EM GUARDA',
  routing: 'ROTEANDO CHAVES',
  celebrating: 'SUCESSO · DANÇA!',
  warning: '429 · ROTACIONANDO',
  blocked: 'PRIVACYGUARD · BLOQUEIO',
  exhausted: 'FALHA · TONTA',
  dizzy: 'ERRO · TONTA',
  sleeping: 'AGUARDANDO · ZZZ',
  startle: 'ACORDOU · SUSTINHO',
  vault_save: 'CHAVE NO COFRE',
  key_trash: 'CHAVE NO LIXO'
};
const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const int = new Intl.NumberFormat('pt-BR');
let state = null;
let refreshTimer = 0;

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.detail || `Erro HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }
  return data;
}

async function refresh() {
  try {
    state = await api('/api/state');
    render();
  } catch {
    setConn(false);
  }
}

function render() {
  const { config, slots, catalog, usage, integration } = state;
  const sel = $('activeModel');
  if (sel.options.length !== catalog.length) {
    sel.innerHTML = catalog.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
  }
  sel.value = config.activeModelId;
  $('policy').value = config.policy;
  $('sensitivity').value = config.defaultSensitivity;

  $('mTotal').textContent = int.format(usage.totalRequests);
  $('mOk').textContent = int.format(usage.successfulRequests);
  $('mBlocked').textContent = int.format(usage.privacyBlockedRequests);
  $('mTokens').textContent = int.format(usage.totalInputTokens + usage.totalOutputTokens);
  $('mCost').textContent = usd.format(usage.totalCostUsd);
  $('mSaved').textContent = usd.format(usage.totalSavingsUsd);
  $('pillOk').textContent = int.format(usage.successfulRequests);
  $('pillTok').textContent = int.format(usage.totalInputTokens + usage.totalOutputTokens);
  $('pillModel').textContent = config.activeModelId;

  const mcpBtn = $('mcpToggleBtn');
  if (mcpBtn) {
    const isMcpOn = config.mcpEnabled !== false;
    mcpBtn.textContent = isMcpOn ? '⚡ MCP: ATIVO' : '⏸️ MCP: DESLIGADO';
    mcpBtn.className = `carimbo mcp-toggle-btn ${isMcpOn ? 'is-active' : 'is-inactive'}`;
    mcpBtn.title = isMcpOn
      ? 'MCP Kitsune ativo no Antigravity. Clique para desligar e ter zero interferência.'
      : 'MCP Kitsune desligado. Clique para reativar.';
  }

  renderSlots(slots);
  renderLedger(usage.recentEntries);
  $('mcpSnippet').textContent = integration.mcpConfigJson;
  $('v1Snippet').textContent = `${integration.baseUrlV1}\nPill HUD: ${integration.pillUrl}`;
}

function slotState(s) {
  if (!s.enabled) return ['off', 'Desativada'];
  if (s.authInvalid) return ['err', 'Recusada'];
  if (s.cooldownUntilMs > Date.now()) return ['warn', `Pausa ${Math.ceil((s.cooldownUntilMs - Date.now()) / 1000)}s`];
  return ['ok', 'Pronta'];
}

function renderSlots(slots) {
  $('slotsEmpty').hidden = slots.length > 0;
  const sorted = [...slots].sort((a, b) => b.priority - a.priority);
  $('slotList').innerHTML = sorted.map((s) => {
    const [cls, txt] = slotState(s);
    return `<li class="slot" data-id="${esc(s.id)}">
      <div class="slot-main">
        <div class="slot-name">${esc(s.label)} <span class="state ${cls}">${txt}</span></div>
        <div class="slot-meta">${PROVIDER_LABEL[s.provider] || s.provider} · ${TIER_LABEL[s.tier]} · ${esc(s.maskedSecret)} · prio ${s.priority}${s.lastError ? ` · ${esc(s.lastError)}` : ''}</div>
      </div>
      <div class="slot-actions">
        <button class="carimbo small" type="button" data-act="test">Testar</button>
        <button class="carimbo small" type="button" data-act="toggle" aria-pressed="${s.enabled}">${s.enabled ? 'Desativar' : 'Ativar'}</button>
        <button class="carimbo small danger" type="button" data-act="delete" aria-label="Remover ${esc(s.label)}">Remover</button>
      </div></li>`;
  }).join('');
}

function renderLedger(rows) {
  $('ledgerEmpty').hidden = rows.length > 0;
  $('ledgerTable').hidden = rows.length === 0;
  const statusTxt = { ok: 'OK', fallback_failed: 'Trocou', privacy_blocked: 'Bloqueada', error: 'Erro' };
  $('ledgerBody').innerHTML = rows.map((r) => `<tr>
    <td>${new Date(r.timestampIso).toLocaleTimeString('pt-BR')}</td><td>${esc(r.source)}</td><td>${esc(r.slotLabel)}</td>
    <td>${esc(r.modelId)}</td><td>${statusTxt[r.status] || r.status} (${r.httpStatus})</td>
    <td class="num">${int.format(r.inputTokens + r.outputTokens)}</td><td class="num">${int.format(r.latencyMs)}</td></tr>`).join('');
}

function setConn(live) {
  const c = $('conn');
  c.textContent = live ? 'AO VIVO' : 'DESCONECTADO';
  c.className = `chip ${live ? 'live' : 'down'}`;
  $('pillStatusText').textContent = live ? 'Antigravity · Conectado' : 'Sem conexão loopback';
}

function syncMood(mood, reason, holdMs = 3200, force = false) {
  fox.setMood(mood, reason, holdMs, force);
  pillFox.setMood(mood, '', holdMs, force);
  setMoodBanner(mood, reason);
}

function setMoodBanner(mood, reason) {
  const stamp = MOOD_STAMP[mood] || 'IDLE · EM GUARDA';
  $('moodBadge').textContent = stamp;
  $('moodLine').textContent = reason || 'Acompanhando seu cursor e requisições em tempo real.';
  $('pillAura').dataset.mood = mood || 'idle';
  $('pillMood').textContent = stamp.split(' · ')[0];
  $('pillStatusText').textContent = reason || 'Antigravity · Em guarda';
}

function debounceRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 120);
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('open', () => setConn(true));
  es.addEventListener('error', () => setConn(false));
  es.addEventListener('mood', (e) => {
    const ev = JSON.parse(e.data);
    const hold = ev.mood === 'routing' || ev.mood === 'sleeping' ? 0 : ev.mood === 'dizzy' || ev.mood === 'exhausted' ? 3800 : 2800;
    const txt = ev.mood === 'idle' ? '' : ev.reason;
    syncMood(ev.mood, txt, hold, ev.mood === 'dizzy' || ev.mood === 'exhausted');
  });
  for (const t of ['usage_updated', 'slots_updated', 'config_updated']) {
    es.addEventListener(t, debounceRefresh);
  }
}

for (const id of ['activeModel', 'policy', 'sensitivity']) {
  $(id).addEventListener('change', async () => {
    const msg = $('profileMsg');
    try {
      await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({
          activeModelId: $('activeModel').value,
          policy: $('policy').value,
          defaultSensitivity: $('sensitivity').value
        })
      });
      msg.textContent = 'Perfil salvo.';
      msg.className = 'hint ok';
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'hint err';
    }
  });
}

function toggleSlotForm(open) {
  $('slotForm').hidden = !open;
  $('addSlotBtn').setAttribute('aria-expanded', String(open));
  if (open) $('sLabel').focus();
  else $('addSlotBtn').focus();
}

$('addSlotBtn').addEventListener('click', () => toggleSlotForm($('slotForm').hidden));
$('cancelSlot').addEventListener('click', () => toggleSlotForm(false));
$('slotForm').addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleSlotForm(false); });
$('sProvider').addEventListener('change', () => {
  const p = $('sProvider').value;
  $('sSecret').placeholder = PROVIDER_PLACEHOLDER[p] || 'Chave API';
  if (p === 'ollama') $('sTier').value = 'local';
  else if (p === 'google-oauth' || p === 'anthropic' || p === 'deepseek') $('sTier').value = 'paid';
});

$('slotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('slotMsg');
  const btn = e.submitter;
  btn.disabled = true;
  msg.textContent = 'Cifrando e salvando';
  msg.className = 'hint';
  try {
    await api('/api/slots', {
      method: 'POST',
      body: JSON.stringify({
        label: $('sLabel').value,
        provider: $('sProvider').value,
        tier: $('sTier').value,
        secret: $('sSecret').value,
        priority: Number($('sPriority').value) || 10,
        baseUrl: $('sBase').value
      })
    });
    $('slotForm').reset();
    msg.textContent = '';
    toggleSlotForm(false);
    syncMood('vault_save', 'Conta salva com segurança no cofre DPAPI!', 2600, true);
    await refresh();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'hint err';
    syncMood('key_trash', 'Erro na chave! Foi direto pro lixo.', 2600, true);
  } finally {
    btn.disabled = false;
  }
});

$('openLoginBtn').addEventListener('click', async () => {
  const msg = $('accountMsg');
  try {
    const res = await api('/api/accounts/open-login', {
      method: 'POST',
      body: JSON.stringify({ target: $('loginTarget').value })
    });
    msg.textContent = res.detail;
    msg.className = 'hint ok';
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'hint err';
  }
});

$('importGeminiBtn').addEventListener('click', async () => {
  const msg = $('accountMsg');
  $('importGeminiBtn').disabled = true;
  try {
    const res = await api('/api/accounts/import-gemini-cli', { method: 'POST', body: '{}' });
    msg.textContent = res.detail;
    msg.className = 'hint ok';
    syncMood('vault_save', 'Sessão Google Gemini CLI trancada no cofre!', 2600, true);
    await refresh();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'hint err';
    syncMood('key_trash', err.message, 2600, true);
  } finally {
    $('importGeminiBtn').disabled = false;
  }
});

$('slotList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.slot').dataset.id;
  const slot = state.slots.find((s) => s.id === id);
  const act = btn.dataset.act;
  if (act === 'delete') {
    $('dlgText').textContent = `A chave "${slot?.label}" será apagada deste computador.`;
    $('confirmDlg').returnValue = '';
    $('confirmDlg').showModal();
    $('confirmDlg').addEventListener('close', async () => {
      if ($('confirmDlg').returnValue === 'ok') {
        await api(`/api/slots/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
        await refresh();
      }
    }, { once: true });
    return;
  }
  btn.disabled = true;
  const original = btn.textContent;
  try {
    if (act === 'test') {
      btn.textContent = 'Testando';
      const r = await api(`/api/slots/${encodeURIComponent(id)}/test`, { method: 'POST' });
      syncMood(r.ok ? 'vault_save' : 'key_trash', r.detail, 2600, true);
    } else if (act === 'toggle') {
      await api(`/api/slots/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: JSON.stringify({ enabled: !slot.enabled }) });
    }
    await refresh();
  } catch (err) {
    syncMood('key_trash', err.message, 2600, true);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

$('pgForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('pgOut');
  const prompt = $('pgPrompt').value.trim();
  out.hidden = false;
  if (!prompt) {
    out.className = 'pg-out err';
    out.textContent = 'Digite um prompt para testar.';
    $('pgPrompt').focus();
    return;
  }
  $('pgBtn').disabled = true;
  out.className = 'pg-out';
  out.textContent = 'Roteando...';
  syncMood('routing', 'Testando rota no Playground...', 0);
  try {
    const r = await api('/api/playground', {
      method: 'POST',
      body: JSON.stringify({ prompt, sensitivity: $('pgSens').value || undefined })
    });
    out.textContent = r.completion.text;
    const meta = document.createElement('span');
    meta.className = 'pg-meta';
    meta.textContent = `${r.slot.label} · ${r.model.id}${r.fallbackUsed ? ' · failover OK' : ''} · ${r.completion.inputTokens + r.completion.outputTokens} tokens · ${r.completion.latencyMs} ms`;
    out.appendChild(meta);
  } catch (err) {
    const errMsg = err.data?.error?.message || err.message;
    out.className = 'pg-out err';
    out.textContent = errMsg;
    if (err.data?.error?.code !== 'PRIVACY_BLOCKED') {
      syncMood('dizzy', `Erro no teste: ${errMsg}`, 3800, true);
    }
  } finally {
    $('pgBtn').disabled = false;
  }
});

$('openPillBtn').addEventListener('click', async () => {
  const msg = $('pillLaunchMsg');
  try {
    const r = await api('/api/pill/open', { method: 'POST', body: '{}' });
    msg.textContent = `${r.reason} (${r.url})`;
    msg.className = 'hint ok';
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'hint err';
  }
});

document.querySelectorAll('button.copy').forEach((b) => b.addEventListener('click', async () => {
  const text = $(b.dataset.copy).textContent;
  const original = b.textContent;
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copiado!'; }
  catch { b.textContent = 'Copie manualmente'; }
  setTimeout(() => { b.textContent = original; }, 1600);
}));

$('resetLedger').addEventListener('click', async () => {
  await api('/api/ledger/reset', { method: 'POST' }).catch(() => {});
  await refresh();
});

function applyBeret(on, animate = true) {
  fox.setBeret(on, animate);
  pillFox.setBeret(on, animate);
  $('beretBtn').setAttribute('aria-pressed', String(on));
  $('pillBeretBtn').setAttribute('aria-pressed', String(on));
  localStorage.setItem('kitsune-beret', on ? '1' : '0');
}
$('beretBtn').addEventListener('click', () => applyBeret(!fox.beret, true));
$('pillBeretBtn').addEventListener('click', () => applyBeret(!fox.beret, true));
applyBeret(localStorage.getItem('kitsune-beret') === '1', false);

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('themeBtn').textContent = dark ? 'Tema claro' : 'Tema escuro';
  $('themeBtn').setAttribute('aria-pressed', String(dark));
  $('pillThemeBtn').textContent = dark ? '☀' : '🌙';
  localStorage.setItem('kitsune-theme', dark ? 'dark' : 'light');
}
$('themeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme !== 'dark'));
$('pillThemeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme !== 'dark'));
const savedTheme = localStorage.getItem('kitsune-theme');
applyTheme(savedTheme ? savedTheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);

function applyPause(p) {
  fox.setPaused(p);
  pillFox.setPaused(p);
  $('pauseBtn').textContent = p ? '▶ Retomar' : '⚡ 60 FPS';
  $('pauseBtn').setAttribute('aria-pressed', String(p));
}
$('pauseBtn').addEventListener('click', () => applyPause(!fox.paused));
applyPause(matchMedia('(prefers-reduced-motion: reduce)').matches);

const isPillOnly = location.pathname === '/pill' || new URLSearchParams(location.search).get('mode') === 'pill';
document.body.classList.toggle('pill-only', isPillOnly);

function setBoardCollapsed(collapsed) {
  $('expandedBoard').hidden = Boolean(collapsed);
  $('pillToggleBtn').textContent = collapsed ? '▼' : '▲';
  $('pillToggleBtn').setAttribute('aria-expanded', String(!collapsed));
  $('boardCollapseBtn').setAttribute('aria-expanded', String(!collapsed));
}

if (isPillOnly) {
  setBoardCollapsed(true);
  $('pillOpenBoardBtn').addEventListener('click', () => window.open('/', '_blank', 'noopener'));
  $('pillToggleBtn').addEventListener('click', () => { location.href = '/'; });
} else {
  $('pillToggleBtn').addEventListener('click', () => setBoardCollapsed(!$('expandedBoard').hidden));
  $('boardCollapseBtn').addEventListener('click', () => setBoardCollapsed(true));
}

function applyDockTab(tab) {
  document.querySelectorAll('.seg-tab').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-tabs]').forEach((el) => {
    const allowed = el.dataset.tabs.split(/\s+/);
    el.hidden = tab !== 'all' && !allowed.includes(tab);
  });
}
$('dockTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.seg-tab')?.dataset.tab;
  if (tab) applyDockTab(tab);
});

$('mcpToggleBtn')?.addEventListener('click', async () => {
  try {
    const r = await api('/api/config/mcp-toggle', { method: 'POST' });
    fox.speak(r.mcpEnabled ? '⚡ MCP Ativado no Antigravity!' : '⏸️ MCP Desligado! Zero interferência na IDE.', 'idle');
    await refresh();
  } catch (err) {
    alert(`Erro ao alternar MCP: ${err.message}`);
  }
});

$('chatFullscreenTopBtn')?.addEventListener('click', () => {
  window.kitsuneChat?.openFullscreen?.();
});

setInterval(() => { if (state) renderSlots(state.slots); }, 1000);
refresh();
connectEvents();
