const state = {
  providers: {},
  currentProvider: null,
  currentModel: null,
  messages: [],
  busy: false,
  editingId: null,
};

const $ = (id) => document.getElementById(id);

async function loadProviders() {
  const r = await fetch('/api/providers');
  state.providers = await r.json();
  renderProviders();
}

function renderProviders() {
  const ul = $('providerList');
  ul.innerHTML = '';
  Object.entries(state.providers).forEach(([id, p]) => {
    const li = document.createElement('li');
    li.className = id === state.currentProvider ? 'active' : '';
    const hasKey = p.api_key && p.api_key.length > 0;
    li.innerHTML = `
      <span class="dot ${hasKey ? 'ok' : ''}" title="${hasKey ? 'ключ задан' : 'нет ключа'}"></span>
      <span class="pname">${escapeHtml(p.name)}</span>
      <span class="actions">
        <span class="edit" data-id="${id}" title="Настроить">⚙</span>
        <span class="del" data-id="${id}" title="Удалить">✕</span>
      </span>`;
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('del') || e.target.classList.contains('edit')) return;
      selectProvider(id);
    });
    li.querySelector('.edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openProviderModal(id);
    });
    li.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Удалить провайдера "${p.name}"?`)) return;
      await fetch(`/api/providers/${id}`, { method: 'DELETE' });
      if (state.currentProvider === id) {
        state.currentProvider = null; state.currentModel = null;
        updateHead();
      }
      loadProviders();
    });
    ul.appendChild(li);
  });
}

function selectProvider(id) {
  state.currentProvider = id;
  const p = state.providers[id];
  state.currentModel = p.models?.[0] || null;
  updateHead();
  renderProviders();
}

function updateHead() {
  const p = state.providers[state.currentProvider];
  $('currentProvider').textContent = p ? p.name : '— выберите провайдера —';
  $('currentModel').textContent = state.currentModel || 'модель не выбрана';
}

function renderEmptyIfNeeded() {
  const box = $('messages');
  if (state.messages.length === 0) {
    box.innerHTML = `
      <div class="empty">
        <div class="empty-icon">✦</div>
        <div class="empty-title">Начните диалог</div>
        <div class="empty-sub">Выберите провайдера, настройте ключ (⚙) и модель</div>
      </div>`;
  }
}

function appendMessage(role, text) {
  const box = $('messages');
  if (box.querySelector('.empty')) box.innerHTML = '';
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

async function sendMessage() {
  if (state.busy) return;
  const input = $('input');
  const text = input.value.trim();
  if (!text) return;
  if (!state.currentProvider) return toast('Выберите провайдера');
  if (!state.currentModel) return toast('Выберите модель (кнопка 🎛)');

  input.value = '';
  input.style.height = 'auto';
  state.busy = true;
  $('sendBtn').disabled = true;

  state.messages.push({ role: 'user', content: text });
  appendMessage('user', text);

  const box = $('messages');
  if (box.querySelector('.empty')) box.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'msg-group';

  const reasoningEl = document.createElement('details');
  reasoningEl.className = 'reasoning';
  reasoningEl.style.display = 'none';
  reasoningEl.innerHTML = `
    <summary><span class="r-icon">💭</span> Размышления <span class="r-hint">(развернуть)</span></summary>
    <div class="reasoning-content"></div>`;

  const answerEl = document.createElement('div');
  answerEl.className = 'msg assistant';
  answerEl.textContent = '…';

  wrapper.appendChild(reasoningEl);
  wrapper.appendChild(answerEl);
  box.appendChild(wrapper);
  box.scrollTop = box.scrollHeight;

  const reasoningContent = reasoningEl.querySelector('.reasoning-content');
  let full = '';
  let reasoningFull = '';
  let gotContent = false;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: state.currentProvider,
        model: state.currentModel,
        messages: state.messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка запроса');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error);
          const delta = json.choices?.[0]?.delta || {};

          const reasoning =
            delta.reasoning_content ||
            delta.reasoning ||
            json.choices?.[0]?.message?.reasoning_content || '';

          if (reasoning) {
            reasoningFull += reasoning;
            reasoningEl.style.display = 'block';
            reasoningContent.textContent = reasoningFull;
            box.scrollTop = box.scrollHeight;
          }

          const content = delta.content || '';
          if (content) {
            if (!gotContent) { gotContent = true; reasoningEl.open = false; }
            full += content;
            answerEl.textContent = full;
            box.scrollTop = box.scrollHeight;
          }
        } catch (e) { /* пропуск плохого чанка */ }
      }
    }

    if (!full && !reasoningFull) answerEl.textContent = '(пустой ответ)';
    if (!full && reasoningFull) answerEl.textContent = '(только размышления — модель не дала финальный ответ)';
    state.messages.push({ role: 'assistant', content: full || reasoningFull });
  } catch (e) {
    answerEl.className = 'msg error';
    answerEl.textContent = '⚠ ' + e.message;
  } finally {
    state.busy = false;
    $('sendBtn').disabled = false;
    $('input').focus();
  }
}

function openModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); }

function openProviderModal(id = null) {
  state.editingId = id;
  const status = $('testStatus');
  status.className = 'test-status';
  status.textContent = '';

  if (id) {
    const p = state.providers[id];
    $('modalTitle').textContent = '⚙ Настройка провайдера';
    $('pName').value = p.name || '';
    $('pId').value = id;
    $('pId').disabled = true;
    $('pUrl').value = p.base_url || '';
    $('pKey').value = p.api_key || '';
    $('pModels').value = (p.models || []).join(', ');
  } else {
    $('modalTitle').textContent = '➕ Новый провайдер';
    $('pName').value = '';
    $('pId').value = '';
    $('pId').disabled = false;
    $('pUrl').value = '';
    $('pKey').value = '';
    $('pModels').value = '';
  }
  openModal('providerModal');
}

$('addProviderBtn').onclick = () => openProviderModal(null);
$('editCurrentBtn').onclick = () => {
  if (!state.currentProvider) return toast('Сначала выберите провайдера');
  openProviderModal(state.currentProvider);
};
$('toggleKeyBtn').onclick = () => {
  const k = $('pKey');
  k.type = k.type === 'password' ? 'text' : 'password';
};

$('testProviderBtn').onclick = async () => {
  const status = $('testStatus');
  status.className = 'test-status show';
  status.textContent = '⏳ Проверка…';
  status.style.color = 'var(--muted)';

  const r = await fetch('/api/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_url: $('pUrl').value.trim(), api_key: $('pKey').value.trim() }),
  });
  const data = await r.json();
  if (data.ok) {
    status.className = 'test-status show ok';
    status.textContent = `✅ Подключение работает. Моделей: ${data.models_count}`;
  } else {
    status.className = 'test-status show err';
    status.textContent = '❌ ' + (data.error || 'Ошибка');
  }
};

$('saveProviderBtn').onclick = async () => {
  const body = {
    name: $('pName').value.trim(),
    id: $('pId').value.trim() || $('pName').value.trim(),
    base_url: $('pUrl').value.trim(),
    api_key: $('pKey').value.trim(),
    models: $('pModels').value.split(',').map(s => s.trim()).filter(Boolean),
  };
  if (!body.base_url) return toast('Укажите Base URL');

  let r;
  if (state.editingId) {
    r = await fetch(`/api/providers/${state.editingId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } else {
    r = await fetch('/api/providers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  const data = await r.json();
  if (data.error) return toast(data.error);
  closeModal('providerModal');
  await loadProviders();
  if (!state.editingId) selectProvider(data.id);
  toast('Сохранено ✅');
};

$('modelBtn').onclick = () => {
  if (!state.currentProvider) return toast('Сначала выберите провайдера');
  $('modelInput').value = state.currentModel || '';
  $('modelsList').innerHTML = '';
  openModal('modelModal');
};

$('fetchModelsBtn').onclick = async () => {
  const list = $('modelsList');
  list.innerHTML = '<div class="model-item">⏳ Загрузка…</div>';
  const r = await fetch('/api/models', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: state.currentProvider }),
  });
  const data = await r.json();
  if (data.error) {
    list.innerHTML = `<div class="model-item" style="color:#ff9fb1">⚠ ${escapeHtml(data.error)}</div>`;
    return;
  }
  if (!data.models?.length) {
    list.innerHTML = '<div class="model-item">Список пуст</div>';
    return;
  }
  list.innerHTML = '';
  data.models.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'model-item';
    el.textContent = m;
    el.onclick = () => { $('modelInput').value = m; };
    list.appendChild(el);
  });
};

$('applyModelBtn').onclick = () => {
  const m = $('modelInput').value.trim();
  if (!m) return toast('Введите ID модели');
  state.currentModel = m;
  updateHead();
  closeModal('modelModal');
};

$('clearChatBtn').onclick = () => {
  state.messages = [];
  $('messages').innerHTML = '';
  renderEmptyIfNeeded();
};

document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('.modal').classList.remove('show'))
);
document.querySelectorAll('.modal').forEach((m) =>
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('show'); })
);

const input = $('input');
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$('sendBtn').onclick = sendMessage;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    Object.assign(el.style, {
      position: 'fixed', bottom: '26px', left: '50%', transform: 'translateX(-50%)',
      background: 'linear-gradient(135deg,#7c5cff,#35d0ff)', color: '#fff',
      padding: '11px 22px', borderRadius: '12px', fontSize: '14px',
      boxShadow: '0 10px 30px rgba(124,92,255,0.4)', zIndex: 200,
      opacity: 0, transition: 'opacity 0.25s',
    });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.opacity = 0), 2200);
}

loadProviders();