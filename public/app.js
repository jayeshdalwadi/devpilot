// Items UI: read-only list with per-row actions; create/edit happens in a modal.
// Rows are built with textContent (never raw HTML) so item data cannot inject markup.

const API = '/api/items';

const els = {
  addBtn: document.getElementById('add-item'),
  table: document.getElementById('items-table'),
  body: document.getElementById('items-body'),
  empty: document.getElementById('empty-state'),
  listError: document.getElementById('list-error'),
  modal: document.getElementById('item-modal'),
  form: document.getElementById('item-form'),
  title: document.getElementById('modal-title'),
  name: document.getElementById('item-name'),
  description: document.getElementById('item-description'),
  errors: document.getElementById('form-errors'),
  cancel: document.getElementById('cancel-item'),
  save: document.getElementById('save-item'),
};

/** id of the item being edited, or null in create mode */
let editingId = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = body?.details;
    throw err;
  }
  return body;
}

function showListError(message) {
  els.listError.textContent = message;
  els.listError.hidden = !message;
}

function button(label, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function renderItems(items) {
  els.body.replaceChildren();
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.dataset.id = String(item.id);
    tr.append(
      cell(String(item.id)),
      cell(item.name),
      cell(item.description ?? ''),
      cell(new Date(item.updatedAt).toLocaleString()),
    );
    const actions = document.createElement('td');
    actions.className = 'actions';
    actions.append(
      button('Edit', 'btn', () => openEdit(item.id)),
      button('Delete', 'btn btn-danger', () => deleteItem(item)),
    );
    tr.append(actions);
    els.body.append(tr);
  }
  els.table.hidden = items.length === 0;
  els.empty.hidden = items.length !== 0;
}

async function loadItems() {
  try {
    showListError('');
    renderItems(await api(API));
  } catch (err) {
    showListError(`Could not load items: ${err.message}`);
  }
}

function showFormErrors(messages) {
  els.errors.replaceChildren(
    ...messages.map((m) => {
      const li = document.createElement('li');
      li.textContent = m;
      return li;
    }),
  );
  els.errors.hidden = messages.length === 0;
}

function openModal({ title, name = '', description = '' }) {
  els.title.textContent = title;
  els.name.value = name;
  els.description.value = description;
  showFormErrors([]);
  els.save.disabled = false;
  els.modal.showModal();
  els.name.focus();
}

function openCreate() {
  editingId = null;
  openModal({ title: 'Add item' });
}

async function openEdit(id) {
  try {
    const item = await api(`${API}/${id}`);
    editingId = item.id;
    openModal({ title: 'Edit item', name: item.name, description: item.description ?? '' });
  } catch (err) {
    showListError(`Could not open item ${id}: ${err.message}`);
    if (err.status === 404) loadItems();
  }
}

async function deleteItem(item) {
  if (!window.confirm(`Delete "${item.name}"?`)) return;
  try {
    await api(`${API}/${item.id}`, { method: 'DELETE' });
  } catch (err) {
    showListError(`Could not delete item ${item.id}: ${err.message}`);
  }
  loadItems();
}

async function saveItem(event) {
  event.preventDefault();
  const payload = { name: els.name.value, description: els.description.value };
  els.save.disabled = true;
  try {
    if (editingId === null) {
      await api(API, { method: 'POST', body: JSON.stringify(payload) });
    } else {
      await api(`${API}/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    }
    els.modal.close();
    loadItems();
  } catch (err) {
    const details = Array.isArray(err.details)
      ? err.details.map((d) => (d.path?.length ? `${d.path.join('.')}: ${d.message}` : d.message))
      : [];
    showFormErrors(details.length ? details : [err.message]);
  } finally {
    els.save.disabled = false;
  }
}

els.addBtn.addEventListener('click', openCreate);
els.cancel.addEventListener('click', () => els.modal.close());
els.form.addEventListener('submit', saveItem);

loadItems();
