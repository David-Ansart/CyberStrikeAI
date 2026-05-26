/**
 * 项目管理与事实黑板
 */
let projectsCache = [];
let projectsCacheAll = [];
let currentProjectId = null;
let currentProjectTab = 'facts';
const projectNameById = {};
let _projectsListReady = false;
let _projectsFetchPromise = null;

const PROJECT_ACTIVE_KEY = 'cyberstrike.activeProjectId';

function getActiveProjectId() {
    try {
        return localStorage.getItem(PROJECT_ACTIVE_KEY) || '';
    } catch (e) {
        return '';
    }
}

function setActiveProjectId(id) {
    try {
        if (id) localStorage.setItem(PROJECT_ACTIVE_KEY, id);
        else localStorage.removeItem(PROJECT_ACTIVE_KEY);
    } catch (e) { /* ignore */ }
}

function rebuildProjectNameMap(list) {
    Object.keys(projectNameById).forEach((k) => delete projectNameById[k]);
    (list || []).forEach((p) => {
        if (p && p.id) projectNameById[p.id] = p.name || p.id;
    });
}

async function fetchProjectsList(includeArchived) {
    const showArchived = includeArchived || document.getElementById('projects-show-archived')?.checked;
    const url = showArchived ? '/api/projects?limit=200' : '/api/projects?status=active&limit=200';
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('加载项目失败');
    const data = await res.json();
    projectsCache = Array.isArray(data) ? data : [];
    rebuildProjectNameMap(projectsCache);
    _projectsListReady = true;
    return projectsCache;
}

/** 对话页等项目选择器：确保列表已拉取（去重并发请求） */
async function ensureProjectsLoaded(force) {
    if (!force && _projectsListReady) return projectsCache;
    if (!force && _projectsFetchPromise) return _projectsFetchPromise;
    _projectsFetchPromise = fetchProjectsList(false)
        .catch((e) => {
            _projectsListReady = false;
            throw e;
        })
        .finally(() => {
            _projectsFetchPromise = null;
        });
    return _projectsFetchPromise;
}

function prefetchProjectsForChat() {
    ensureProjectsLoaded().catch(() => {});
}

function getProjectName(id) {
    return projectNameById[id] || id || '';
}

function initProjectsModalEscape() {
    if (window._projectsModalEscapeBound) return;
    window._projectsModalEscapeBound = true;
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.getElementById('project-modal')?.style.display === 'flex') closeProjectModal();
        else if (document.getElementById('fact-modal')?.style.display === 'flex') closeFactModal();
        else if (document.getElementById('fact-detail-modal')?.style.display === 'flex') closeFactDetailModal();
    });
}

async function initProjectsPage() {
    const page = document.getElementById('page-projects');
    if (!page || page.style.display === 'none') return;
    initProjectsModalEscape();
    updateProjectsDetailVisibility();
    await loadProjectsList();
    if (!currentProjectId && projectsCache.length) {
        const fromHash = new URLSearchParams(window.location.hash.split('?')[1] || '').get('id');
        currentProjectId = fromHash || projectsCache[0].id;
    }
    renderProjectsSidebar();
    if (currentProjectId) {
        await selectProject(currentProjectId);
    }
}

async function loadProjectsList() {
    await fetchProjectsList();
    renderProjectsSidebar();
    if (typeof refreshChatProjectSelector === 'function') {
        refreshChatProjectSelector();
    }
    if (typeof refreshVulnerabilityProjectFilter === 'function') {
        refreshVulnerabilityProjectFilter();
    }
}

function projectInitial(name) {
    const s = (name || 'P').trim();
    return s ? s.charAt(0).toUpperCase() : 'P';
}

function updateProjectsDetailVisibility() {
    const main = document.getElementById('projects-detail-main');
    const placeholder = document.getElementById('projects-detail-placeholder');
    const inner = document.getElementById('projects-detail-inner');
    const show = !!currentProjectId;
    if (main) main.classList.toggle('has-project', show);
    if (placeholder) placeholder.hidden = show;
    if (inner) inner.hidden = !show;
}

function updateProjectsListCount() {
    const el = document.getElementById('projects-list-count');
    if (el) el.textContent = String(projectsCache.length);
}

function formatConfidenceBadge(confidence) {
    const c = (confidence || '').toLowerCase();
    let cls = 'projects-confidence--tentative';
    let label = c || '—';
    if (c === 'confirmed') {
        cls = 'projects-confidence--confirmed';
        label = '已确认';
    } else if (c === 'deprecated') {
        cls = 'projects-confidence--deprecated';
        label = '已废弃';
    } else if (c === 'tentative') {
        label = '待确认';
    }
    return `<span class="projects-confidence ${cls}">${escapeHtml(label)}</span>`;
}

function renderProjectFactActions(keyEsc, idEsc) {
    return `<div class="projects-table-actions">
        <button type="button" class="projects-action-btn projects-action-btn--edit" data-fact-key="${keyEsc}" onclick="showEditFactModal(this.dataset.factKey)" title="编辑各字段">编辑</button>
        <button type="button" class="projects-action-btn projects-action-btn--view" data-fact-key="${keyEsc}" onclick="viewProjectFactBody(this.dataset.factKey)" title="查看完整 body">详情</button>
        <button type="button" class="projects-action-btn projects-action-btn--mute" data-fact-key="${keyEsc}" onclick="deprecateProjectFactByKey(this.dataset.factKey)" title="标记为已废弃">废弃</button>
        <button type="button" class="projects-action-btn projects-action-btn--danger" data-fact-id="${idEsc}" onclick="deleteProjectFact(this.dataset.factId)" title="永久删除">删除</button>
    </div>`;
}

function formatSeverityBadge(severity) {
    const s = (severity || 'info').toLowerCase();
    const cls = 'projects-severity--' + (['critical', 'high', 'medium', 'low', 'info'].includes(s) ? s : 'info');
    return `<span class="projects-severity ${cls}">${escapeHtml(severity || '—')}</span>`;
}

function getProjectsListFilter() {
    return (document.getElementById('projects-list-search')?.value || '').trim().toLowerCase();
}

function filterProjectsList() {
    renderProjectsSidebar();
}

function renderProjectsSidebar() {
    const el = document.getElementById('projects-list');
    if (!el) return;
    updateProjectsListCount();
    const q = getProjectsListFilter();
    const list = q
        ? projectsCache.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))
        : projectsCache;
    if (!projectsCache.length) {
        el.innerHTML =
            '<div class="projects-empty">暂无项目<br><button type="button" class="btn-primary btn-small projects-empty-btn" onclick="showNewProjectModal()">新建项目</button></div>';
        updateProjectsDetailVisibility();
        return;
    }
    if (!list.length) {
        el.innerHTML = '<div class="projects-empty">无匹配项目</div>';
        updateProjectsDetailVisibility();
        return;
    }
    el.innerHTML = list.map((p) => {
        const active = p.id === currentProjectId ? ' is-active' : '';
        const archived = p.status === 'archived' ? ' is-archived' : '';
        const badges = [
            p.pinned ? '<span class="projects-list-item-badge">置顶</span>' : '',
            p.status === 'archived' ? '<span class="projects-list-item-badge">归档</span>' : '',
        ].join('');
        return `<div class="projects-list-item${active}${archived}" data-id="${escapeHtml(p.id)}" onclick="selectProject('${escapeHtml(p.id)}')">
            <div class="projects-list-item-body">
                <div class="projects-list-item-name">${escapeHtml(p.name)}${badges}</div>
                <div class="projects-list-item-meta">${formatProjectTime(p.updated_at)}</div>
            </div>
        </div>`;
    }).join('');
    updateProjectsDetailVisibility();
}

function updateProjectStatusPill(status) {
    const el = document.getElementById('projects-detail-status');
    if (!el) return;
    const archived = status === 'archived';
    el.textContent = archived ? '已归档' : '进行中';
    el.className = 'projects-status-pill ' + (archived ? 'projects-status-pill--archived' : 'projects-status-pill--active');
}

function updateProjectStats(factCount, vulnCount) {
    const f = document.getElementById('project-stat-facts');
    const v = document.getElementById('project-stat-vulns');
    if (f) f.textContent = `${factCount ?? 0} 条事实`;
    if (v) v.textContent = `${vulnCount ?? 0} 个漏洞`;
}

async function selectProject(id) {
    currentProjectId = id;
    renderProjectsSidebar();
    updateProjectsDetailVisibility();
    try {
        const res = await apiFetch(`/api/projects/${id}`);
        if (!res.ok) throw new Error('项目不存在');
        const p = await res.json();
        const titleEl = document.getElementById('projects-detail-title');
        if (titleEl) titleEl.textContent = p.name || '项目';
        document.getElementById('project-edit-name').value = p.name || '';
        document.getElementById('project-edit-description').value = p.description || '';
        document.getElementById('project-edit-scope').value = p.scope_json || '';
        const statusEl = document.getElementById('project-edit-status');
        if (statusEl) statusEl.value = p.status || 'active';
        updateProjectStatusPill(p.status || 'active');
        const metaEl = document.getElementById('projects-detail-meta');
        if (metaEl) metaEl.textContent = `更新于 ${formatProjectTime(p.updated_at)}`;
        const descEl = document.getElementById('projects-detail-desc');
        if (descEl) {
            const desc = (p.description || '').trim();
            if (desc) {
                descEl.textContent = desc;
                descEl.hidden = false;
            } else {
                descEl.textContent = '';
                descEl.hidden = true;
            }
        }
        projectNameById[p.id] = p.name || p.id;
    } catch (e) {
        console.warn(e);
    }
    refreshProjectHeaderStats();
    switchProjectTab(currentProjectTab);
}

function switchProjectTab(tab) {
    currentProjectTab = tab;
    ['facts', 'vulns', 'settings'].forEach((t) => {
        const btn = document.getElementById(`project-tab-${t}`);
        const panel = document.getElementById(`project-panel-${t}`);
        if (btn) btn.classList.toggle('is-active', t === tab);
        if (panel) panel.hidden = t !== tab;
    });
    if (tab === 'facts') loadProjectFacts();
    if (tab === 'vulns') loadProjectVulnerabilities();
}

async function loadProjectFacts() {
    const tbody = document.getElementById('project-facts-tbody');
    if (!tbody || !currentProjectId) return;
    tbody.innerHTML = '<tr class="is-empty-row"><td colspan="6">加载中…</td></tr>';
    const res = await apiFetch(`/api/projects/${currentProjectId}/facts?limit=200`);
    if (!res.ok) {
        tbody.innerHTML = '<tr class="is-empty-row"><td colspan="6">加载失败</td></tr>';
        return;
    }
    const facts = await res.json();
    if (!facts.length) {
        tbody.innerHTML = '<tr class="is-empty-row"><td colspan="6">暂无事实，点击「添加事实」或由 Agent 自动写入</td></tr>';
        refreshProjectHeaderStats();
        return;
    }
    tbody.innerHTML = facts.map((f) => {
        const keyEsc = escapeHtml(f.fact_key);
        const idEsc = escapeHtml(f.id);
        return `<tr>
            <td><code>${keyEsc}</code></td>
            <td>${escapeHtml(f.category)}</td>
            <td class="cell-summary" title="${escapeHtml(f.summary)}">${escapeHtml(f.summary)}</td>
            <td>${formatConfidenceBadge(f.confidence)}</td>
            <td>${formatProjectTime(f.updated_at, f.created_at)}</td>
            <td class="col-actions">${renderProjectFactActions(keyEsc, idEsc)}</td>
        </tr>`;
    }).join('');
    refreshProjectHeaderStats();
}

async function refreshProjectHeaderStats() {
    if (!currentProjectId) return;
    try {
        const [factsRes, vulnRes] = await Promise.all([
            apiFetch(`/api/projects/${currentProjectId}/facts?limit=500`),
            apiFetch(`/api/vulnerabilities?project_id=${encodeURIComponent(currentProjectId)}&limit=100`),
        ]);
        let fc = 0;
        let vc = 0;
        if (factsRes.ok) {
            const f = await factsRes.json();
            fc = Array.isArray(f) ? f.length : 0;
        }
        if (vulnRes.ok) {
            const d = await vulnRes.json();
            const items = d.Vulnerabilities || d.vulnerabilities || d.items || [];
            vc = items.length;
        }
        updateProjectStats(fc, vc);
    } catch (e) {
        console.warn(e);
    }
}

let _factDetailKey = null;

async function viewProjectFactBody(factKey) {
    const res = await apiFetch(`/api/projects/${currentProjectId}/facts?fact_key=${encodeURIComponent(factKey)}`);
    if (!res.ok) return alert('加载失败');
    const f = await res.json();
    _factDetailKey = f.fact_key;
    document.getElementById('fact-detail-title').textContent = `[${f.fact_key}]`;
    document.getElementById('fact-detail-meta').textContent =
        `分类: ${f.category} · 置信度: ${f.confidence} · 更新: ${formatProjectTime(f.updated_at, f.created_at)}` +
        (f.related_vulnerability_id ? ` · 关联漏洞: ${f.related_vulnerability_id}` : '');
    document.getElementById('fact-detail-body').textContent = f.body || '(无 body)';
    openProjectsOverlay('fact-detail-modal');
}

function editFactFromDetail() {
    const key = _factDetailKey;
    closeFactDetailModal();
    if (key) showEditFactModal(key);
}

function closeFactDetailModal() {
    closeProjectsOverlay('fact-detail-modal');
    _factDetailKey = null;
}

async function deprecateProjectFactByKey(factKey) {
    if (!confirm(`将事实 ${factKey} 标记为 deprecated？`)) return;
    const res = await apiFetch(`/api/projects/${currentProjectId}/facts/deprecate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact_key: factKey }),
    });
    if (!res.ok) return alert('操作失败');
    loadProjectFacts();
}

function openVulnerabilitiesForProject(projectId) {
    const pid = projectId || currentProjectId;
    if (!pid) return;
    if (typeof switchPage === 'function') {
        switchPage('vulnerabilities');
    }
    if (typeof window.setVulnerabilityProjectFilter === 'function') {
        window.setVulnerabilityProjectFilter(pid);
    } else {
        window.location.hash = `vulnerabilities?project_id=${encodeURIComponent(pid)}`;
    }
}

async function loadProjectVulnerabilities() {
    const tbody = document.getElementById('project-vulns-tbody');
    if (!tbody || !currentProjectId) return;
    tbody.innerHTML = '<tr class="is-empty-row"><td colspan="4">加载中…</td></tr>';
    const res = await apiFetch(`/api/vulnerabilities?project_id=${encodeURIComponent(currentProjectId)}&limit=100`);
    if (!res.ok) {
        tbody.innerHTML = '<tr class="is-empty-row"><td colspan="4">加载失败</td></tr>';
        return;
    }
    const data = await res.json();
    const items = data.Vulnerabilities || data.vulnerabilities || data.items || [];
    if (!items.length) {
        tbody.innerHTML = '<tr class="is-empty-row"><td colspan="4">本项目暂无漏洞记录</td></tr>';
        refreshProjectHeaderStats();
        return;
    }
    tbody.innerHTML = items.map((v) => {
        const idEsc = escapeHtml(v.id);
        return `<tr>
            <td class="cell-summary" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</td>
            <td>${formatSeverityBadge(v.severity)}</td>
            <td>${escapeHtml(v.status)}</td>
            <td class="col-actions">
                <div class="projects-table-actions">
                    <button type="button" class="projects-action-btn projects-action-btn--view" data-vuln-id="${idEsc}" onclick="openVulnerabilityDetail(this.dataset.vulnId)">查看</button>
                </div>
            </td>
        </tr>`;
    }).join('');
    refreshProjectHeaderStats();
}

function openVulnerabilityDetail(vulnId) {
    openVulnerabilitiesForProject(currentProjectId);
    if (typeof window.setVulnerabilityIdFilter === 'function') {
        setTimeout(() => window.setVulnerabilityIdFilter(vulnId), 300);
    }
}

function openProjectsOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'flex';
    document.body.classList.add('projects-modal-open');
    const focusTarget = el.querySelector('input.form-input, textarea.form-input, select.form-input');
    if (focusTarget) {
        setTimeout(() => focusTarget.focus(), 80);
    }
}

function closeProjectsOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
    const anyOpen = document.querySelector('.projects-modal-overlay[style*="flex"]');
    if (!anyOpen) document.body.classList.remove('projects-modal-open');
}

function showNewProjectModal() {
    document.getElementById('project-modal-title').textContent = '新建项目';
    const sub = document.getElementById('project-modal-subtitle');
    if (sub) sub.textContent = '创建后可绑定对话，跨会话共享事实黑板';
    const submitBtn = document.getElementById('project-modal-submit-btn');
    if (submitBtn) submitBtn.textContent = '创建项目';
    document.getElementById('project-modal-name').value = '';
    document.getElementById('project-modal-description').value = '';
    window._projectModalEditId = null;
    openProjectsOverlay('project-modal');
}

async function saveProjectModal() {
    const name = document.getElementById('project-modal-name').value.trim();
    if (!name) return alert('请输入项目名称');
    const body = {
        name,
        description: document.getElementById('project-modal-description').value.trim(),
    };
    const editId = window._projectModalEditId;
    const res = editId
        ? await apiFetch(`/api/projects/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await apiFetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '保存失败');
        return;
    }
    closeProjectModal();
    const saved = await res.json();
    await loadProjectsList();
    if (saved.id) await selectProject(saved.id);
}

function closeProjectModal() {
    closeProjectsOverlay('project-modal');
}

function formatProjectScopeJson() {
    const el = document.getElementById('project-edit-scope');
    if (!el) return;
    const raw = el.value.trim();
    if (!raw) return;
    try {
        el.value = JSON.stringify(JSON.parse(raw), null, 2);
    } catch (e) {
        alert('JSON 格式无效：' + (e.message || String(e)));
    }
}

function insertProjectScopeExample() {
    const el = document.getElementById('project-edit-scope');
    if (!el) return;
    const example = {
        targets: ['https://example.com'],
        exclude: ['*.cdn.example.com'],
        notes: '仅授权 Web 应用层测试',
    };
    el.value = JSON.stringify(example, null, 2);
    el.focus();
}

async function saveProjectSettings() {
    if (!currentProjectId) return;
    const scopeRaw = document.getElementById('project-edit-scope').value.trim();
    if (scopeRaw) {
        try {
            JSON.parse(scopeRaw);
        } catch (e) {
            alert('测试范围 JSON 无效，请先修正或点击「格式化」：' + (e.message || String(e)));
            return;
        }
    }
    const body = {
        name: document.getElementById('project-edit-name').value.trim(),
        description: document.getElementById('project-edit-description').value.trim(),
        scope_json: scopeRaw,
        status: document.getElementById('project-edit-status')?.value || 'active',
    };
    const res = await apiFetch(`/api/projects/${currentProjectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) return alert('保存失败');
    await loadProjectsList();
    await selectProject(currentProjectId);
    alert('已保存');
}

async function archiveCurrentProject() {
    if (!currentProjectId) return;
    const statusEl = document.getElementById('project-edit-status');
    const cur = statusEl?.value || 'active';
    const next = cur === 'archived' ? 'active' : 'archived';
    if (!confirm(next === 'archived' ? '归档后默认不再出现在活跃列表，是否继续？' : '恢复为 active？')) return;
    const res = await apiFetch(`/api/projects/${currentProjectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
    });
    if (!res.ok) return alert('操作失败');
    await loadProjectsList();
    await selectProject(currentProjectId);
}

async function deleteCurrentProject() {
    if (!currentProjectId || !confirm('确定删除该项目？事实将一并删除，对话将解除绑定。')) return;
    const deletedId = currentProjectId;
    const deletedIndex = projectsCache.findIndex((p) => p.id === deletedId);
    const res = await apiFetch(`/api/projects/${deletedId}`, { method: 'DELETE' });
    if (!res.ok) return alert('删除失败');
    if (getActiveProjectId() === deletedId) setActiveProjectId('');
    currentProjectId = null;
    await loadProjectsList();
    if (projectsCache.length) {
        const nextIndex = Math.min(deletedIndex >= 0 ? deletedIndex : 0, projectsCache.length - 1);
        await selectProject(projectsCache[nextIndex].id);
    } else {
        updateProjectsDetailVisibility();
    }
}

function resetFactModalForm() {
    window._factModalEditId = null;
    const keyEl = document.getElementById('fact-modal-key');
    if (keyEl) keyEl.disabled = false;
    document.getElementById('fact-modal-title').textContent = '添加事实';
    document.getElementById('fact-modal-submit-btn').textContent = '保存事实';
    document.getElementById('fact-modal-key').value = '';
    document.getElementById('fact-modal-category').value = 'note';
    document.getElementById('fact-modal-summary').value = '';
    document.getElementById('fact-modal-body').value = '';
    document.getElementById('fact-modal-confidence').value = 'tentative';
    const rel = document.getElementById('fact-modal-related-vuln');
    if (rel) rel.value = '';
}

function fillFactModalForm(f) {
    window._factModalEditId = f.id;
    document.getElementById('fact-modal-title').textContent = '编辑事实';
    document.getElementById('fact-modal-submit-btn').textContent = '保存修改';
    document.getElementById('fact-modal-key').value = f.fact_key || '';
    document.getElementById('fact-modal-category').value = f.category || 'note';
    document.getElementById('fact-modal-summary').value = f.summary || '';
    document.getElementById('fact-modal-body').value = f.body || '';
    const conf = (f.confidence || 'tentative').toLowerCase();
    const confEl = document.getElementById('fact-modal-confidence');
    if (confEl) {
        const allowed = ['tentative', 'confirmed', 'deprecated'];
        confEl.value = allowed.includes(conf) ? conf : 'tentative';
    }
    const rel = document.getElementById('fact-modal-related-vuln');
    if (rel) rel.value = f.related_vulnerability_id || '';
}

function showAddFactModal() {
    if (!currentProjectId) return alert('请先选择项目');
    resetFactModalForm();
    openProjectsOverlay('fact-modal');
}

async function showEditFactModal(factKey) {
    if (!currentProjectId) return alert('请先选择项目');
    const res = await apiFetch(
        `/api/projects/${currentProjectId}/facts?fact_key=${encodeURIComponent(factKey)}`,
    );
    if (!res.ok) return alert('加载事实失败');
    const f = await res.json();
    resetFactModalForm();
    fillFactModalForm(f);
    openProjectsOverlay('fact-modal');
}

function closeFactModal() {
    closeProjectsOverlay('fact-modal');
    resetFactModalForm();
}

async function saveFactModal() {
    const fact_key = document.getElementById('fact-modal-key').value.trim();
    const summary = document.getElementById('fact-modal-summary').value.trim();
    if (!fact_key || !summary) return alert('fact_key 与 summary 必填');
    const payload = {
        fact_key,
        category: document.getElementById('fact-modal-category').value.trim() || 'note',
        summary,
        body: document.getElementById('fact-modal-body').value,
        confidence: document.getElementById('fact-modal-confidence').value,
        related_vulnerability_id: document.getElementById('fact-modal-related-vuln')?.value?.trim() || '',
    };
    const editId = window._factModalEditId;
    const res = editId
        ? await apiFetch(`/api/projects/${currentProjectId}/facts/${editId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
          })
        : await apiFetch(`/api/projects/${currentProjectId}/facts`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
          });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.error || '保存失败');
    }
    closeFactModal();
    loadProjectFacts();
}

async function deleteProjectFact(id) {
    if (!confirm('删除该事实？')) return;
    await apiFetch(`/api/projects/${currentProjectId}/facts/${id}`, { method: 'DELETE' });
    loadProjectFacts();
}

function parseProjectDate(t) {
    if (t == null || t === '') return null;
    if (typeof t === 'number' && Number.isFinite(t)) {
        const d = new Date(t);
        return isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d;
    }
    let s = String(t).trim();
    if (!s || s.startsWith('0001-01-01')) return null;
    let d = new Date(s);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
    const m = s.match(
        /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz]|([+-])(\d{2}):?(\d{2}))?)?$/,
    );
    if (m) {
        const ms = m[7] ? parseInt(String(m[7]).slice(0, 3).padEnd(3, '0'), 10) : 0;
        let offMin = 0;
        if (m[8] && m[9] && m[10]) {
            offMin = parseInt(m[10], 10) * 60 + parseInt(m[11] || '0', 10);
            if (m[9] === '-') offMin = -offMin;
        }
        d = new Date(
            Date.UTC(
                parseInt(m[1], 10),
                parseInt(m[2], 10) - 1,
                parseInt(m[3], 10),
                parseInt(m[4], 10),
                parseInt(m[5], 10),
                parseInt(m[6], 10),
                ms,
            ) - offMin * 60 * 1000,
        );
        if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
    }
    return null;
}

function formatProjectTime(t, fallback) {
    const d = parseProjectDate(t) || (fallback != null ? parseProjectDate(fallback) : null);
    if (!d) return '尚未更新';
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getChatProjectSelection() {
    const convId = window.currentConversationId;
    if (convId) {
        return window._loadedConversationProjectId || '';
    }
    return getActiveProjectId();
}

function updateChatProjectButtonLabel() {
    const textEl = document.getElementById('chat-project-text');
    if (!textEl) return;
    const id = getChatProjectSelection();
    textEl.textContent = id ? getProjectName(id) || id : '无项目';
}

function renderChatProjectPanelList() {
    const list = document.getElementById('chat-project-list');
    if (!list) return;
    const selected = getChatProjectSelection();
    const activeProjects = projectsCache.filter((p) => p.status !== 'archived');
    const items = [{ id: '', name: '无项目', description: '不绑定项目黑板' }, ...activeProjects];
    if (!items.length) {
        list.innerHTML = '<div class="chat-project-panel-empty">暂无项目，可在「项目管理」中创建</div>';
        return;
    }
    list.innerHTML = '';
    items.forEach((p) => {
        const isNone = !p.id;
        const isSelected = isNone ? !selected : selected === p.id;
        const desc = isNone
            ? (p.description || '')
            : (p.description || '').trim().slice(0, 80) || '共享事实黑板';
        const projectId = p.id || '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'role-selection-item-main' + (isSelected ? ' selected' : '');
        btn.setAttribute('role', 'option');
        btn.onclick = () => {
            selectChatProject(projectId);
        };
        btn.innerHTML = `
                <div class="role-selection-item-icon-main">${isNone ? '—' : '📁'}</div>
                <div class="role-selection-item-content-main">
                    <div class="role-selection-item-name-main">${escapeHtml(p.name || '未命名')}</div>
                    <div class="role-selection-item-description-main">${escapeHtml(desc)}</div>
                </div>
                ${isSelected ? '<div class="role-selection-checkmark-main">✓</div>' : ''}
            `;
        list.appendChild(btn);
    });
}

async function renderChatProjectPanel() {
    const list = document.getElementById('chat-project-list');
    if (!list) return;
    list.innerHTML = '<div class="chat-project-panel-loading">加载中…</div>';
    try {
        await ensureProjectsLoaded();
    } catch (e) {
        console.warn(e);
        list.innerHTML = '<div class="chat-project-panel-empty">加载失败，请稍后重试</div>';
        return;
    }
    renderChatProjectPanelList();
}

function closeChatProjectPanel() {
    const panel = document.getElementById('chat-project-panel');
    const btn = document.getElementById('chat-project-btn');
    if (panel) panel.style.display = 'none';
    if (btn) {
        btn.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
    }
}

async function toggleChatProjectPanel() {
    const panel = document.getElementById('chat-project-panel');
    const btn = document.getElementById('chat-project-btn');
    if (!panel) return;
    const isHidden = panel.style.display === 'none' || !panel.style.display;
    if (!isHidden) {
        closeChatProjectPanel();
        return;
    }
    if (typeof closeRoleSelectionPanel === 'function') closeRoleSelectionPanel();
    if (typeof closeAgentModePanel === 'function') closeAgentModePanel();
    if (typeof closeChatReasoningPanel === 'function') closeChatReasoningPanel();
    panel.style.display = 'flex';
    if (btn) {
        btn.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
    }
    await renderChatProjectPanel();
}

async function selectChatProject(projectId) {
    closeChatProjectPanel();
    await applyChatProjectSelection(projectId || '');
}

async function applyChatProjectSelection(projectId) {
    const prev = getChatProjectSelection();
    if (projectId === prev) {
        updateChatProjectButtonLabel();
        return;
    }
    if (window.currentConversationId) {
        try {
            const res = await apiFetch(`/api/conversations/${encodeURIComponent(window.currentConversationId)}/project`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || res.statusText);
            }
            window._loadedConversationProjectId = projectId;
            if (typeof showNotification === 'function') {
                showNotification(projectId ? '已绑定项目' : '已解除项目绑定', 'success');
            }
        } catch (e) {
            console.error(e);
            alert('更新项目绑定失败: ' + (e.message || e));
            updateChatProjectButtonLabel();
            return;
        }
    } else {
        setActiveProjectId(projectId);
    }
    updateChatProjectButtonLabel();
}

/** 对话页项目选择器：同步按钮文案；若浮层已打开则刷新列表 */
async function refreshChatProjectSelector() {
    if (!document.getElementById('chat-project-btn')) return;
    try {
        await ensureProjectsLoaded();
    } catch (e) {
        console.warn(e);
    }
    updateChatProjectButtonLabel();
    const panel = document.getElementById('chat-project-panel');
    if (panel && panel.style.display === 'flex') {
        renderChatProjectPanelList();
    }
}

async function onChatProjectChange() {
    /* 兼容旧调用；新 UI 使用 selectChatProject */
    await applyChatProjectSelection(getChatProjectSelection());
}

function initChatProjectSelector() {
    if (window._chatProjectSelectorInited) return;
    window._chatProjectSelectorInited = true;
    prefetchProjectsForChat();
    updateChatProjectButtonLabel();
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('chat-project-panel');
        const wrapper = document.querySelector('.project-selector-wrapper');
        if (!panel || panel.style.display === 'none' || !panel.style.display) return;
        if (!wrapper?.contains(e.target)) {
            closeChatProjectPanel();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatProjectSelector);
} else {
    initChatProjectSelector();
}

window.initProjectsPage = initProjectsPage;
window.showNewProjectModal = showNewProjectModal;
window.saveProjectModal = saveProjectModal;
window.closeProjectModal = closeProjectModal;
window.selectProject = selectProject;
window.switchProjectTab = switchProjectTab;
window.showAddFactModal = showAddFactModal;
window.showEditFactModal = showEditFactModal;
window.editFactFromDetail = editFactFromDetail;
window.saveFactModal = saveFactModal;
window.closeFactModal = closeFactModal;
window.closeFactDetailModal = closeFactDetailModal;
window.saveProjectSettings = saveProjectSettings;
window.archiveCurrentProject = archiveCurrentProject;
window.deleteCurrentProject = deleteCurrentProject;
window.refreshChatProjectSelector = refreshChatProjectSelector;
window.onChatProjectChange = onChatProjectChange;
window.toggleChatProjectPanel = toggleChatProjectPanel;
window.closeChatProjectPanel = closeChatProjectPanel;
window.selectChatProject = selectChatProject;
window.prefetchProjectsForChat = prefetchProjectsForChat;
window.getActiveProjectId = getActiveProjectId;
window.getProjectName = getProjectName;
window.viewProjectFactBody = viewProjectFactBody;
window.deprecateProjectFactByKey = deprecateProjectFactByKey;
window.openVulnerabilitiesForProject = openVulnerabilitiesForProject;
window.openVulnerabilityDetail = openVulnerabilityDetail;
window.filterProjectsList = filterProjectsList;
window.rebuildProjectNameMap = rebuildProjectNameMap;
window.projectNameById = projectNameById;
