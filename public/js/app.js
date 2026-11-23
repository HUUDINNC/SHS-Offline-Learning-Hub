const state = {
  token: localStorage.getItem('shs_token') || null,
  user: JSON.parse(localStorage.getItem('shs_user') || 'null'),
  curriculum: { forms: [], subjects: [], topics: [] },
  resources: [],
  offlineIds: new Set()
};

let lastImportedSlips = [];

const els = {
  netBadge: document.getElementById('netBadge'),
  userBar: document.getElementById('userBar'),
  userInfo: document.getElementById('userInfo'),
  openPwdBtn: document.getElementById('openPwdBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  loginSection: document.getElementById('loginSection'),
  loginForm: document.getElementById('loginForm'),
  loginUsername: document.getElementById('loginUsername'),
  loginPassword: document.getElementById('loginPassword'),
  loginError: document.getElementById('loginError'),
  appSection: document.getElementById('appSection'),
  navTabs: document.getElementById('navTabs'),
  offlineCount: document.getElementById('offlineCount'),
  filterForm: document.getElementById('filterForm'),
  filterSubject: document.getElementById('filterSubject'),
  filterTopic: document.getElementById('filterTopic'),
  filterType: document.getElementById('filterType'),
  filterQuery: document.getElementById('filterQuery'),
  applyFiltersBtn: document.getElementById('applyFiltersBtn'),
  resetFiltersBtn: document.getElementById('resetFiltersBtn'),
  resourceList: document.getElementById('resourceList'),
  offlineList: document.getElementById('offlineList'),
  uploadForm: document.getElementById('uploadForm'),
  resTitle: document.getElementById('resTitle'),
  resDesc: document.getElementById('resDesc'),
  resType: document.getElementById('resType'),
  resForm: document.getElementById('resForm'),
  resSubject: document.getElementById('resSubject'),
  resTopic: document.getElementById('resTopic'),
  resFile: document.getElementById('resFile'),
  uploadStatus: document.getElementById('uploadStatus'),
  topicForm: document.getElementById('topicForm'),
  topicFormSelect: document.getElementById('topicFormSelect'),
  topicSubjectSelect: document.getElementById('topicSubjectSelect'),
  topicTitleInput: document.getElementById('topicTitleInput'),
  topicStatus: document.getElementById('topicStatus'),
  adminStats: document.getElementById('adminStats'),
  usersTableBody: document.querySelector('#usersTable tbody'),
  createUserForm: document.getElementById('createUserForm'),
  newFullName: document.getElementById('newFullName'),
  newUsername: document.getElementById('newUsername'),
  newPassword: document.getElementById('newPassword'),
  newRole: document.getElementById('newRole'),
  newFormLevel: document.getElementById('newFormLevel'),
  createUserStatus: document.getElementById('createUserStatus'),
  bulkImportForm: document.getElementById('bulkImportForm'),
  bulkCsvFile: document.getElementById('bulkCsvFile'),
  bulkCsvText: document.getElementById('bulkCsvText'),
  bulkImportStatus: document.getElementById('bulkImportStatus'),
  printSlipsBtn: document.getElementById('printSlipsBtn'),
  viewerModal: document.getElementById('viewerModal'),
  viewerTitle: document.getElementById('viewerTitle'),
  viewerBody: document.getElementById('viewerBody'),
  closeViewerBtn: document.getElementById('closeViewerBtn'),
  pwdModal: document.getElementById('pwdModal'),
  closePwdBtn: document.getElementById('closePwdBtn'),
  changePwdForm: document.getElementById('changePwdForm'),
  curPwd: document.getElementById('curPwd'),
  newAccountPwd: document.getElementById('newAccountPwd'),
  pwdStatus: document.getElementById('pwdStatus')
};

function updateNetworkStatus() {
  const online = navigator.onLine;
  els.netBadge.textContent = online ? 'Online (LAN)' : 'Offline Mode';
  els.netBadge.className = `badge ${online ? 'badge-online' : 'badge-offline'}`;
}

window.addEventListener('online', () => {
  updateNetworkStatus();
  if (state.token) {
    loadCurriculum();
    loadResources();
  }
});
window.addEventListener('offline', updateNetworkStatus);

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function resetToBrowseTab() {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === 'browseTab');
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('hidden', p.id !== 'browseTab');
  });
}

function clearTransientUI() {
  [els.createUserStatus, els.bulkImportStatus, els.uploadStatus, els.topicStatus, els.pwdStatus, els.loginError]
    .filter(Boolean)
    .forEach((el) => {
      el.textContent = '';
      el.classList.add('hidden');
    });
  if (els.printSlipsBtn) els.printSlipsBtn.classList.add('hidden');
  if (els.viewerModal?.open) els.viewerModal.close();
  if (els.pwdModal?.open) els.pwdModal.close();
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('shs_token', token);
  localStorage.setItem('shs_user', JSON.stringify(user));
  renderSession();
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('shs_token');
  localStorage.removeItem('shs_user');
  resetToBrowseTab();
  clearTransientUI();
  renderSession();
}

function renderSession() {
  resetToBrowseTab();

  if (!state.token || !state.user) {
    els.userBar.classList.add('hidden');
    els.appSection.classList.add('hidden');
    els.loginSection.classList.remove('hidden');
    return;
  }

  clearTransientUI();
  els.loginSection.classList.add('hidden');
  els.appSection.classList.remove('hidden');
  els.userBar.classList.remove('hidden');
  const formTag = state.user.form_level ? ` · ${state.user.form_level}` : '';
  els.userInfo.textContent = `${state.user.full_name} (${state.user.role.toUpperCase()}${formTag})`;

  const isTeacherOrAdmin = state.user.role === 'teacher' || state.user.role === 'admin';
  const isAdmin = state.user.role === 'admin';

  document.querySelectorAll('.role-teacher-admin').forEach((el) => {
    el.classList.toggle('hidden', !isTeacherOrAdmin);
  });
  document.querySelectorAll('.role-admin').forEach((el) => {
    el.classList.toggle('hidden', !isAdmin);
  });

  refreshOfflineCacheState();
  loadCurriculum();
  loadResources();
  if (isAdmin) loadAdminOverview();
}

async function refreshOfflineCacheState() {
  const items = await window.OfflineStore.getAllOfflineResources();
  state.offlineIds = new Set(items.map((i) => i.id));
  els.offlineCount.textContent = String(items.length);
  renderOfflineList(items);
}

function populateSelect(selectEl, items, valueKey, labelKey, includeAllLabel) {
  const prev = selectEl.value;
  selectEl.innerHTML = includeAllLabel ? `<option value="">${includeAllLabel}</option>` : '';
  items.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item[valueKey];
    opt.textContent = item[labelKey];
    selectEl.appendChild(opt);
  });
  if (prev && [...selectEl.options].some((o) => o.value === prev)) {
    selectEl.value = prev;
  }
}

function updateTopicDropdowns() {
  const formVal = els.filterForm.value;
  const subjVal = els.filterSubject.value;
  const filteredTopics = state.curriculum.topics.filter((t) => {
    if (formVal && String(t.form_id) !== formVal) return false;
    if (subjVal && String(t.subject_id) !== subjVal) return false;
    return true;
  });
  populateSelect(els.filterTopic, filteredTopics, 'id', 'title', 'All Topics');

  const resFormVal = els.resForm.value;
  const resSubjVal = els.resSubject.value;
  const uploadTopics = state.curriculum.topics.filter((t) => {
    if (resFormVal && String(t.form_id) !== resFormVal) return false;
    if (resSubjVal && String(t.subject_id) !== resSubjVal) return false;
    return true;
  });
  els.resTopic.innerHTML = '<option value="">-- Optional Topic --</option>';
  uploadTopics.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.title;
    els.resTopic.appendChild(opt);
  });
}

async function loadCurriculum() {
  try {
    const data = await apiFetch('/api/curriculum');
    state.curriculum = data;
    await window.OfflineStore.saveCurriculumOffline(data);
  } catch {
    const cached = await window.OfflineStore.getCurriculumOffline();
    if (cached) state.curriculum = cached;
  }

  populateSelect(els.filterForm, state.curriculum.forms, 'id', 'name', 'All Forms');
  populateSelect(els.filterSubject, state.curriculum.subjects, 'id', 'name', 'All Subjects');
  populateSelect(els.resForm, state.curriculum.forms, 'id', 'name', false);
  populateSelect(els.resSubject, state.curriculum.subjects, 'id', 'name', false);
  populateSelect(els.topicFormSelect, state.curriculum.forms, 'id', 'name', false);
  populateSelect(els.topicSubjectSelect, state.curriculum.subjects, 'id', 'name', false);
  updateTopicDropdowns();
}

function buildResourceQuery() {
  const params = new URLSearchParams();
  if (els.filterForm.value) params.set('form_id', els.filterForm.value);
  if (els.filterSubject.value) params.set('subject_id', els.filterSubject.value);
  if (els.filterTopic.value) params.set('topic_id', els.filterTopic.value);
  if (els.filterType.value) params.set('resource_type', els.filterType.value);
  if (els.filterQuery.value.trim()) params.set('q', els.filterQuery.value.trim());
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function loadResources() {
  try {
    const data = await apiFetch(`/api/resources${buildResourceQuery()}`);
    state.resources = data.resources || [];
  } catch {
    const allOffline = await window.OfflineStore.getAllOfflineResources();
    const q = els.filterQuery.value.trim().toLowerCase();
    state.resources = allOffline.filter((r) => {
      if (els.filterForm.value && String(r.form_id) !== els.filterForm.value) return false;
      if (els.filterSubject.value && String(r.subject_id) !== els.filterSubject.value) return false;
      if (els.filterTopic.value && String(r.topic_id) !== els.filterTopic.value) return false;
      if (els.filterType.value && r.resource_type !== els.filterType.value) return false;
      if (q && !r.title.toLowerCase().includes(q) && !(r.description || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }
  renderResourceList();
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function renderResourceList() {
  if (!state.resources.length) {
    els.resourceList.innerHTML = '<div class="card muted">No learning resources match your current filter.</div>';
    return;
  }

  const canDelete = (r) =>
    state.user && (state.user.role === 'admin' || (state.user.role === 'teacher' && r.uploaded_by === state.user.id));

  els.resourceList.innerHTML = state.resources.map((r) => {
    const isCached = state.offlineIds.has(r.id);
    return `
      <article class="res-card">
        <div>
          <div class="res-meta">
            <span>${r.form_name || ''}</span>
            <span>· ${r.subject_name || ''}</span>
            ${r.topic_title ? `<span>· ${r.topic_title}</span>` : ''}
          </div>
          <h4 style="margin:0.4rem 0 0.25rem;">${r.title}</h4>
          <p class="muted" style="margin:0 0 0.5rem;">${r.description || 'No description provided.'}</p>
          <div class="res-meta">
            <span>${r.resource_type.replace('_', ' ')}</span>
            <span>· ${formatBytes(r.file_size)}</span>
            ${isCached ? '<span class="badge badge-cached">Saved Offline</span>' : ''}
          </div>
        </div>
        <div class="res-actions">
          <button class="btn btn-primary btn-sm" onclick="openResource(${r.id})">Open</button>
          ${
            isCached
              ? `<button class="btn btn-outline btn-sm" onclick="removeOffline(${r.id})">Remove Offline</button>`
              : `<button class="btn btn-outline btn-sm" onclick="saveOffline(${r.id})">Save Offline</button>`
          }
          ${canDelete(r) ? `<button class="btn btn-danger btn-sm" onclick="deleteResource(${r.id})">Delete</button>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

function renderOfflineList(items) {
  if (!items.length) {
    els.offlineList.innerHTML = '<p class="muted">No resources saved offline yet. Click "Save Offline" on any resource.</p>';
    return;
  }
  els.offlineList.innerHTML = items.map((r) => `
    <article class="res-card">
      <div>
        <div class="res-meta">
          <span>${r.form_name || ''} · ${r.subject_name || ''}</span>
          <span class="badge badge-cached">Available Offline</span>
        </div>
        <h4 style="margin:0.4rem 0 0.25rem;">${r.title}</h4>
        <div class="res-meta">${formatBytes(r.file_size)}</div>
      </div>
      <div class="res-actions">
        <button class="btn btn-primary btn-sm" onclick="openResource(${r.id})">Open Offline</button>
        <button class="btn btn-outline btn-sm" onclick="removeOffline(${r.id})">Remove</button>
      </div>
    </article>
  `).join('');
}

async function fetchResourceBlob(id, action = 'view') {
  const res = await fetch(`/api/resources/${id}/file?action=${encodeURIComponent(action)}`, {
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Unable to fetch file');
  }
  return res.blob();
}

window.saveOffline = async (id) => {
  const meta = state.resources.find((r) => r.id === id) || (await window.OfflineStore.getOfflineResource(id))?.meta;
  if (!meta) return;
  try {
    const blob = await fetchResourceBlob(id, 'offline_cache');
    await window.OfflineStore.saveResourceOffline(meta, blob);
    await refreshOfflineCacheState();
    renderResourceList();
  } catch (err) {
    alert(`Could not save offline: ${err.message}`);
  }
};

window.removeOffline = async (id) => {
  await window.OfflineStore.removeResourceOffline(id);
  await refreshOfflineCacheState();
  renderResourceList();
};

window.openResource = async (id) => {
  const offlineEntry = await window.OfflineStore.getOfflineResource(id);
  let blob = offlineEntry ? offlineEntry.file.blob : null;
  let meta = offlineEntry ? offlineEntry.meta : state.resources.find((r) => r.id === id);

  if (!blob) {
    try {
      blob = await fetchResourceBlob(id, 'view');
    } catch (err) {
      alert(err.message);
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  els.viewerTitle.textContent = meta ? meta.title : 'Learning Resource';

  if (blob.type === 'application/pdf') {
    els.viewerBody.innerHTML = `<iframe src="${url}" title="PDF Viewer"></iframe>`;
  } else if (blob.type.startsWith('video/')) {
    els.viewerBody.innerHTML = `<video controls src="${url}"></video>`;
  } else if (blob.type.startsWith('audio/')) {
    els.viewerBody.innerHTML = `<audio controls src="${url}" style="width:100%;margin-top:2rem;"></audio>`;
  } else if (blob.type === 'text/plain') {
    const text = await blob.text();
    els.viewerBody.innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit;">${text.replace(/</g, '&lt;')}</pre>`;
  } else {
    els.viewerBody.innerHTML = `
      <div style="text-align:center;padding:2rem;">
        <p>This document format (${meta ? meta.original_name : 'file'}) downloads directly to open in your installed office app.</p>
        <a class="btn btn-primary" href="${url}" download="${meta ? meta.original_name : 'resource'}">Download File</a>
      </div>
    `;
  }

  els.viewerModal.showModal();
};

window.deleteResource = async (id) => {
  if (!confirm('Delete this resource permanently from the school server?')) return;
  try {
    await apiFetch(`/api/resources/${id}`, { method: 'DELETE' });
    await window.OfflineStore.removeResourceOffline(id);
    await refreshOfflineCacheState();
    await loadResources();
  } catch (err) {
    alert(err.message);
  }
};

async function loadAdminOverview() {
  if (state.user?.role !== 'admin') return;
  try {
    const data = await apiFetch('/api/admin/overview');
    els.adminStats.innerHTML = `
      <div class="stat-box"><div class="muted">Users</div><div class="stat-num">${data.stats.users}</div></div>
      <div class="stat-box"><div class="muted">Resources</div><div class="stat-num">${data.stats.resources}</div></div>
      <div class="stat-box"><div class="muted">Topics</div><div class="stat-num">${data.stats.topics}</div></div>
      <div class="stat-box"><div class="muted">Access Logs</div><div class="stat-num">${data.stats.accessLogs}</div></div>
    `;
    els.usersTableBody.innerHTML = data.users.map((u) => `
      <tr>
        <td>${u.id}</td>
        <td>${u.full_name}</td>
        <td>${u.username}</td>
        <td>${u.role}</td>
        <td>${u.form_level || '-'}</td>
        <td>${u.is_active ? 'Active' : 'Disabled'}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="toggleUserStatus(${u.id})">
            ${u.is_active ? 'Disable' : 'Enable'}
          </button>
          <button class="btn btn-outline btn-sm" onclick="resetUserPassword(${u.id}, '${u.username}')">
            Reset Pwd
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

window.toggleUserStatus = async (id) => {
  try {
    await apiFetch(`/api/admin/users/${id}/toggle`, { method: 'PATCH' });
    await loadAdminOverview();
  } catch (err) {
    alert(err.message);
  }
};

window.resetUserPassword = async (id, username) => {
  const tempPassword = prompt(`Enter temporary password for ${username}:`, 'Shs@2026');
  if (!tempPassword) return;
  try {
    const data = await apiFetch(`/api/admin/users/${id}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: tempPassword })
    });
    alert(data.message);
  } catch (err) {
    alert(err.message);
  }
};

function openPrintableCredentialSlips(users) {
  if (!users || !users.length) return;
  const hostUrl = window.location.origin;
  const win = window.open('', '_blank', 'width=850,height=700');
  if (!win) {
    alert('Please allow pop-ups in your browser to print credential slips.');
    return;
  }

  const cardsHtml = users.map((u) => `
    <div style="border:1px dashed #333;padding:12px;border-radius:6px;break-inside:avoid;">
      <div style="font-weight:bold;font-size:14px;margin-bottom:4px;">SHS OFFLINE LEARNING HUB — LOGIN SLIP</div>
      <div><strong>Name:</strong> ${u.full_name}</div>
      <div><strong>Role:</strong> ${u.role.toUpperCase()} ${u.form_level ? `(${u.form_level})` : ''}</div>
      <div><strong>Username / ID:</strong> <code>${u.username}</code></div>
      <div><strong>Initial Password:</strong> <code>${u.password}</code></div>
      <div style="font-size:11px;color:#444;margin-top:6px;">
        Connect to School Wi-Fi, open <strong>${hostUrl}</strong>, sign in, and change your password.
      </div>
    </div>
  `).join('');

  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head><title>SHS Hub Credential Slips</title></head>
    <body style="font-family:Arial,sans-serif;padding:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2 style="margin:0;">Student & Staff Login Credential Slips (${users.length})</h2>
        <button onclick="window.print()" style="padding:8px 14px;font-weight:bold;cursor:pointer;">Print Slips</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
        ${cardsHtml}
      </div>
    </body>
    </html>
  `);
  win.document.close();
}

els.createUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.createUserStatus.classList.add('hidden');
  try {
    await apiFetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: els.newFullName.value.trim(),
        username: els.newUsername.value.trim(),
        password: els.newPassword.value,
        role: els.newRole.value,
        form_level: els.newRole.value === 'student' ? els.newFormLevel.value : null
      })
    });
    els.createUserStatus.textContent = 'User account created successfully!';
    els.createUserStatus.className = 'alert alert-success';
    els.newFullName.value = '';
    els.newUsername.value = '';
    await loadAdminOverview();
  } catch (err) {
    els.createUserStatus.textContent = err.message;
    els.createUserStatus.className = 'alert alert-error';
  }
});

els.bulkCsvFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    els.bulkCsvText.value = await file.text();
  }
});

els.bulkImportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.bulkImportStatus.classList.add('hidden');
  els.printSlipsBtn.classList.add('hidden');
  try {
    const data = await apiFetch('/api/admin/users/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: els.bulkCsvText.value })
    });
    els.bulkImportStatus.textContent = data.message;
    els.bulkImportStatus.className = 'alert alert-success';
    els.bulkCsvText.value = '';
    els.bulkCsvFile.value = '';
    lastImportedSlips = data.importedUsers || [];
    if (lastImportedSlips.length > 0) {
      els.printSlipsBtn.classList.remove('hidden');
    }
    await loadAdminOverview();
  } catch (err) {
    els.bulkImportStatus.textContent = err.message;
    els.bulkImportStatus.className = 'alert alert-error';
  }
});

els.printSlipsBtn.addEventListener('click', () => {
  openPrintableCredentialSlips(lastImportedSlips);
});

els.openPwdBtn.addEventListener('click', () => {
  els.pwdStatus.classList.add('hidden');
  els.changePwdForm.reset();
  els.pwdModal.showModal();
});

els.closePwdBtn.addEventListener('click', () => {
  els.pwdModal.close();
});

els.changePwdForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.pwdStatus.classList.add('hidden');
  try {
    const data = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_password: els.curPwd.value,
        new_password: els.newAccountPwd.value
      })
    });
    els.pwdStatus.textContent = data.message;
    els.pwdStatus.className = 'alert alert-success';
    els.changePwdForm.reset();
  } catch (err) {
    els.pwdStatus.textContent = err.message;
    els.pwdStatus.className = 'alert alert-error';
  }
});

// Event Listeners
els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.loginError.classList.add('hidden');
  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: els.loginUsername.value.trim(),
        password: els.loginPassword.value
      })
    });
    setSession(data.token, data.user);
  } catch (err) {
    els.loginError.textContent = err.message;
    els.loginError.classList.remove('hidden');
  }
});

els.logoutBtn.addEventListener('click', clearSession);

els.navTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const targetId = btn.dataset.tab;
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== targetId));
  if (targetId === 'offlineTab') refreshOfflineCacheState();
  if (targetId === 'adminTab' && state.user?.role === 'admin') loadAdminOverview();
});

els.filterForm.addEventListener('change', () => { updateTopicDropdowns(); loadResources(); });
els.filterSubject.addEventListener('change', () => { updateTopicDropdowns(); loadResources(); });
els.filterTopic.addEventListener('change', loadResources);
els.filterType.addEventListener('change', loadResources);
els.applyFiltersBtn.addEventListener('click', loadResources);
els.resetFiltersBtn.addEventListener('click', () => {
  els.filterForm.value = '';
  els.filterSubject.value = '';
  els.filterTopic.value = '';
  els.filterType.value = '';
  els.filterQuery.value = '';
  updateTopicDropdowns();
  loadResources();
});

els.resForm.addEventListener('change', updateTopicDropdowns);
els.resSubject.addEventListener('change', updateTopicDropdowns);

els.uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.uploadStatus.classList.add('hidden');
  const file = els.resFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('title', els.resTitle.value.trim());
  formData.append('description', els.resDesc.value.trim());
  formData.append('resource_type', els.resType.value);
  formData.append('form_id', els.resForm.value);
  formData.append('subject_id', els.resSubject.value);
  if (els.resTopic.value) formData.append('topic_id', els.resTopic.value);
  formData.append('file', file);

  try {
    await apiFetch('/api/resources', { method: 'POST', body: formData });
    els.uploadStatus.textContent = 'Resource published to the school hub!';
    els.uploadStatus.className = 'alert alert-success';
    els.uploadForm.reset();
    updateTopicDropdowns();
    await loadResources();
  } catch (err) {
    els.uploadStatus.textContent = err.message;
    els.uploadStatus.className = 'alert alert-error';
  }
});

els.topicForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.topicStatus.classList.add('hidden');
  try {
    await apiFetch('/api/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        form_id: els.topicFormSelect.value,
        subject_id: els.topicSubjectSelect.value,
        title: els.topicTitleInput.value.trim()
      })
    });
    els.topicStatus.textContent = 'Curriculum topic added!';
    els.topicStatus.className = 'alert alert-success';
    els.topicTitleInput.value = '';
    await loadCurriculum();
  } catch (err) {
    els.topicStatus.textContent = err.message;
    els.topicStatus.className = 'alert alert-error';
  }
});

els.closeViewerBtn.addEventListener('click', () => {
  els.viewerBody.innerHTML = '';
  els.viewerModal.close();
});

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.error('SW registration failed:', err));
  });
}

updateNetworkStatus();
renderSession();