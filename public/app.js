// Items UI. Talks to the JSON API; all user data is rendered with textContent (never innerHTML).

const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  createForm: $('#create-form'),
  formError: $('#form-error'),
  listError: $('#list-error'),
  list: $('#items'),
  empty: $('#empty'),
  count: $('#count'),
  filter: $('#filter'),
  template: $('#item-template'),
  health: $('#health'),
  healthText: $('#health-text'),
};

let items = [];

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.details?.map((d) => d.message).join(', ');
    throw new Error(detail || body.error || `Request failed (${res.status})`);
  }
  return body;
}

function showError(el, err) {
  el.textContent = err ? err.message || String(err) : '';
  el.hidden = !err;
}

function formData(form) {
  const name = form.elements.name.value.trim();
  const description = form.elements.description.value.trim();
  return description ? { name, description } : { name };
}

// ---------- rendering ----------

function render() {
  const q = els.filter.value.trim().toLowerCase();
  const visible = q
    ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q))
    : items;

  els.list.replaceChildren(...visible.map(renderItem));
  els.count.textContent = items.length ? `(${visible.length === items.length ? items.length : `${visible.length}/${items.length}`})` : '';
  els.empty.hidden = items.length > 0;
}

function renderItem(item) {
  const li = els.template.content.firstElementChild.cloneNode(true);
  const view = $('.view', li);
  const editor = $('.editor', li);

  $('.name', li).textContent = item.name;
  $('.description', li).textContent = item.description || '';
  $('.meta', li).textContent = `#${item.id} · ${new Date(item.createdAt).toLocaleString()}`;

  $('.edit', li).addEventListener('click', () => {
    editor.elements.name.value = item.name;
    editor.elements.description.value = item.description || '';
    view.hidden = true;
    editor.hidden = false;
    editor.elements.name.focus();
  });

  $('.cancel', li).addEventListener('click', () => {
    editor.hidden = true;
    view.hidden = false;
  });

  editor.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = editor.elements.name.value.trim();
    const description = editor.elements.description.value.trim();
    await withBusy(editor, async () => {
      // Send an empty string when the description is cleared, so the old value is removed.
      const updated = await api(`/api/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description }),
      });
      items = items.map((i) => (i.id === item.id ? updated : i));
      render();
    });
  });

  $('.delete', li).addEventListener('click', async (e) => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    await withBusy(e.currentTarget, async () => {
      await api(`/api/items/${item.id}`, { method: 'DELETE' });
      items = items.filter((i) => i.id !== item.id);
      render();
    });
  });

  return li;
}

/** Disables the buttons in `el` while `fn` runs and shows any error in the list area. */
async function withBusy(el, fn) {
  const buttons = el.matches('button') ? [el] : [...el.querySelectorAll('button')];
  buttons.forEach((b) => (b.disabled = true));
  showError(els.listError, null);
  try {
    await fn();
  } catch (err) {
    showError(els.listError, err);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ---------- actions ----------

async function loadItems() {
  try {
    items = await api('/api/items');
    showError(els.listError, null);
  } catch (err) {
    showError(els.listError, err);
  }
  render();
}

els.createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('button', els.createForm);
  button.disabled = true;
  showError(els.formError, null);
  try {
    const created = await api('/api/items', { method: 'POST', body: JSON.stringify(formData(els.createForm)) });
    items.push(created);
    els.createForm.reset();
    els.createForm.elements.name.focus();
    render();
  } catch (err) {
    showError(els.formError, err);
  } finally {
    button.disabled = false;
  }
});

els.filter.addEventListener('input', render);

async function checkHealth() {
  let state = 'down';
  let text = 'Server unreachable';
  try {
    const res = await fetch('/health');
    const body = await res.json();
    state = body.db === 'up' ? 'ok' : 'degraded';
    text = body.db === 'up' ? 'Database connected' : 'Database down';
  } catch {
    // keep defaults
  }
  els.health.dataset.state = state;
  els.healthText.textContent = text;
}

loadItems();
checkHealth();
setInterval(checkHealth, 15000);
