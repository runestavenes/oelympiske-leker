/* ============================================================
   admin.js — Admin panel logic (v2)
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
    await initData({ admin: true });
    initTabs();
    renderTeams();
    renderActivities();
    renderSchedule();
    renderPreTournament();
    renderRomantic();
    initDataButtons();
    initTeamForm();
    initAddActivity();
    initPreTournament();
    initRomantic();
    initScheduleButton();
    initTournaments();

    // Re-render read views when other devices change data
    // (activities tab is skipped: it holds unsaved form edits)
    onDataChange(() => {
        renderTeams();
        renderSchedule();
        renderPreTournament();
        renderRomantic();
        populatePreTournamentDropdowns();
        populateRomanticDropdown();
        renderTournaments();
    });
});

// ── Tab switching ─────────────────────────────────────────────

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });
}

// ── Teams ─────────────────────────────────────────────────────

function initTeamForm() {
    const input = document.getElementById('new-team-name');
    const btn = document.getElementById('add-team-btn');

    btn.addEventListener('click', () => addTeam());
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTeam();
    });
}

function addTeam() {
    const input = document.getElementById('new-team-name');
    const name = input.value.trim();
    if (!name) return;

    const teams = getTeams();
    const id = teams.length > 0 ? Math.max(...teams.map(t => t.id)) + 1 : 1;
    teams.push({ id, name });
    setTeams(teams);
    input.value = '';
    renderTeams();
    populatePreTournamentDropdowns();
    populateRomanticDropdown();
}

function removeTeam(id) {
    const teams = getTeams().filter(t => t.id !== id);
    setTeams(teams);
    renderTeams();
    populatePreTournamentDropdowns();
    populateRomanticDropdown();
}

async function renameTeam(id) {
    const teams = getTeams();
    const team = teams.find(t => t.id === id);
    if (!team) return;

    const newName = await uiPrompt('New name for "' + team.name + '":', team.name);
    if (newName && newName.trim()) {
        team.name = newName.trim();
        setTeams(teams);
        renderTeams();
    }
}

function renderTeams() {
    const container = document.getElementById('team-list');
    const teams = getTeams();

    if (teams.length === 0) {
        container.innerHTML = '<p class="hint">No teams added yet.</p>';
        return;
    }

    container.innerHTML = teams.map(t => `
        <div class="card team-card">
            <span class="team-name">${escapeHtml(t.name)}</span>
            <div class="card-actions">
                <button class="btn btn-small btn-secondary" onclick="renameTeam(${t.id})">✏️</button>
                <button class="btn btn-small btn-danger" onclick="removeTeam(${t.id})">✕</button>
            </div>
        </div>
    `).join('');
}

// ── Activities ────────────────────────────────────────────────

function renderActivities() {
    const container = document.getElementById('activity-list');
    const activities = getActivities();

    container.innerHTML = activities.map((a, i) => `
        <div class="card activity-card" data-index="${i}">
            <div class="activity-header">
                <h3>${escapeHtml(a.name)}</h3>
                <button class="btn btn-small btn-danger" onclick="removeActivity(${i})">✕ Remove</button>
            </div>
            <div class="activity-fields">
                <label>Name <input type="text" data-field="name" value="${escapeHtml(a.name)}" maxlength="30"></label>
                <label>Type
                    <select data-field="scoreType">
                        <option value="numeric" ${a.scoreType === 'numeric' ? 'selected' : ''}>Numeric</option>
                        <option value="winlose" ${a.scoreType === 'winlose' ? 'selected' : ''}>Win / Lose</option>
                    </select>
                </label>
                <label>Min <input type="number" data-field="min" value="${a.min}" min="0"></label>
                <label>Max <input type="number" data-field="max" value="${a.max}" min="0"></label>
                <label>Win Pts <input type="number" data-field="winPoints" value="${a.winPoints}" min="0"></label>
                <label>Draw Pts <input type="number" data-field="drawPoints" value="${a.drawPoints}" min="0"></label>
                <label>Loss Pts <input type="number" data-field="lossPoints" value="${a.lossPoints}" min="0"></label>
                <label>Margin × <input type="number" data-field="marginMultiplier" value="${a.marginMultiplier}" min="0" step="0.5"></label>
                <label>Fixed Bonus <input type="number" data-field="fixedBonus" value="${a.fixedBonus}" min="0"></label>
                <label>Weight <input type="number" data-field="weight" value="${a.weight != null ? a.weight : 1}" min="0.1" max="2" step="0.1"></label>
                <label class="checkbox-label">
                    <input type="checkbox" data-field="inSchedule" ${a.inSchedule !== false ? 'checked' : ''}>
                    In Schedule
                </label>
            </div>
        </div>
    `).join('');

    // Re-attach save handler (remove old listener by cloning)
    const saveBtn = document.getElementById('save-activities-btn');
    const newBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newBtn, saveBtn);
    newBtn.addEventListener('click', saveActivities);
}

function saveActivities() {
    const activities = getActivities();
    const cards = document.querySelectorAll('.activity-card');

    cards.forEach(card => {
        const idx = parseInt(card.dataset.index, 10);
        const a = activities[idx];
        if (!a) return;

        card.querySelectorAll('[data-field]').forEach(el => {
            const field = el.dataset.field;
            if (el.type === 'checkbox') {
                a[field] = el.checked;
            } else if (el.tagName === 'SELECT') {
                a[field] = el.value;
            } else if (field === 'name') {
                const newName = el.value.trim();
                if (newName) a[field] = newName;
            } else {
                a[field] = parseFloat(el.value) || 0;
            }
        });
    });

    setActivities(activities);
    renderActivities();
    populatePreTournamentDropdowns();
    showToast('Activities saved ✓');
}

function initAddActivity() {
    document.getElementById('add-activity-btn').addEventListener('click', async () => {
        const name = await uiPrompt('New activity name:');
        if (!name || !name.trim()) return;

        const activities = getActivities();
        const id = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Date.now();
        activities.push({
            id,
            name: name.trim(),
            scoreType: 'numeric',
            min: 0,
            max: 10,
            winPoints: 3,
            drawPoints: 1,
            lossPoints: 0,
            marginMultiplier: 1,
            fixedBonus: 0,
            inSchedule: false
        });
        setActivities(activities);
        renderActivities();
        populatePreTournamentDropdowns();
        showToast('Activity added (not in schedule by default) ✓');
    });
}

async function removeActivity(index) {
    const activities = getActivities();
    const name = activities[index] ? activities[index].name : '';
    if (!await uiConfirm('Remove activity "' + name + '"?')) return;
    activities.splice(index, 1);
    setActivities(activities);
    renderActivities();
    populatePreTournamentDropdowns();
    showToast('Activity removed ✓');
}

// ── Pre-Tournament Scores (individual team entries) ───────────

function initPreTournament() {
    document.getElementById('add-pre-score-btn').addEventListener('click', addPreScore);
    populatePreTournamentDropdowns();
}

function populatePreTournamentDropdowns() {
    const teams = getTeams();
    const activities = getActivities();

    const actSelect = document.getElementById('pre-activity-select');
    const teamSelect = document.getElementById('pre-team-select');

    actSelect.innerHTML = '<option value="">Select activity…</option>' +
        activities.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}${a.inSchedule !== false ? '' : ' ★'}</option>`).join('');

    teamSelect.innerHTML = '<option value="">Select team…</option>' +
        teams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

function addPreScore() {
    const actId = document.getElementById('pre-activity-select').value;
    const teamId = parseInt(document.getElementById('pre-team-select').value, 10);
    const result = document.getElementById('pre-result-select').value;

    if (!actId) {
        showToast('Select an activity!', 'error');
        return;
    }
    if (!teamId) {
        showToast('Select a team!', 'error');
        return;
    }
    if (!result) {
        showToast('Select a result!', 'error');
        return;
    }

    const preScores = getPreScores();
    const id = preScores.length > 0 ? Math.max(...preScores.map(s => s.id)) + 1 : 1;
    preScores.push({ id, teamId, activityId: actId, result });
    setPreScores(preScores);
    document.getElementById('pre-result-select').value = '';
    renderPreTournament();
    showToast('Pre-tournament result added ✓');
}

function removePreScore(id) {
    const preScores = getPreScores().filter(s => s.id !== id);
    setPreScores(preScores);
    renderPreTournament();
    showToast('Score removed ✓');
}

async function editPreScore(id) {
    const preScores = getPreScores();
    const entry = preScores.find(s => s.id === id);
    if (!entry) return;

    const teamName = getTeamName(entry.teamId);
    const act = getActivityById(entry.activityId);
    const actName = act ? act.name : entry.activityId;

    const newResult = await uiPrompt(
        teamName + ' — ' + actName + ' (current: ' + entry.result +
        ') — enter new result: win, draw or lose',
        entry.result
    );
    if (newResult === null) return;

    const trimmed = newResult.trim().toLowerCase();
    if (!['win', 'draw', 'lose'].includes(trimmed)) {
        showToast('Invalid result! Use win, draw, or lose.', 'error');
        return;
    }

    entry.result = trimmed;
    setPreScores(preScores);
    renderPreTournament();
    showToast('Result updated ✓');
}

function renderPreTournament() {
    const container = document.getElementById('pre-score-list');
    const preScores = getPreScores();

    if (preScores.length === 0) {
        container.innerHTML = '<p class="hint">No pre-tournament results yet.</p>';
        return;
    }

    const resultBadge = {
        win:  '🏆 Win (+3)',
        draw: '🤝 Draw (+2)',
        lose: '❌ Lose (+0)'
    };

    // Group by activity
    const grouped = {};
    preScores.forEach(s => {
        if (!grouped[s.activityId]) grouped[s.activityId] = [];
        grouped[s.activityId].push(s);
    });

    let html = '';
    Object.keys(grouped).forEach(actId => {
        const act = getActivityById(actId);
        const actName = act ? act.name : actId;
        html += `<div class="schedule-round"><h3>${escapeHtml(actName)}</h3>`;
        grouped[actId].forEach(s => {
            const teamName = getTeamName(s.teamId);
            const badge = resultBadge[s.result] || s.result;
            html += `
                <div class="match-row match-done">
                    <span class="match-teams">${escapeHtml(teamName)}</span>
                    <span class="match-score">${badge}</span>
                    <button class="btn btn-small btn-secondary" onclick="editPreScore(${s.id})" title="Edit">✏️</button>
                    <button class="btn btn-small btn-danger" onclick="removePreScore(${s.id})" title="Remove">✕</button>
                </div>`;
        });
        html += '</div>';
    });

    container.innerHTML = html;
}

// ── Romantiske Observasjoner ──────────────────────────────────

function initRomantic() {
    document.getElementById('add-romantic-btn').addEventListener('click', addRomanticObs);
    populateRomanticDropdown();
}

function populateRomanticDropdown() {
    const teams = getTeams();
    const select = document.getElementById('romantic-team-select');
    select.innerHTML = '<option value="">Select team…</option>' +
        teams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

async function addRomanticObs() {
    const text = document.getElementById('romantic-text-input').value.trim();
    const teamId = parseInt(document.getElementById('romantic-team-select').value, 10);

    if (!text) {
        showToast('Describe what happened!', 'error');
        return;
    }
    if (!teamId) {
        showToast('Select a team!', 'error');
        return;
    }

    try {
        await apiAddRomanticObs(teamId, text);
    } catch (err) {
        return;
    }
    document.getElementById('romantic-text-input').value = '';
    renderRomantic();
    showToast('Romantisk observasjon added (+1 win) ✓');
}

async function removeRomanticObs(id) {
    try {
        await apiRemoveRomanticObs(id);
    } catch (err) {
        return;
    }
    renderRomantic();
    showToast('Observation removed ✓');
}

function renderRomantic() {
    const container = document.getElementById('romantic-list');
    const obs = getRomanticObs();

    if (obs.length === 0) {
        container.innerHTML = '<p class="hint">No romantic observations yet. 💕</p>';
        return;
    }

    container.innerHTML = obs.map(o => {
        const teamName = getTeamName(o.teamId);
        return `
            <div class="match-row match-done">
                <span class="match-teams"><strong>${escapeHtml(teamName)}</strong></span>
                <span class="match-activity" style="flex:1;">${escapeHtml(o.text)}</span>
                <span class="match-score">+1 W</span>
                <button class="btn btn-small btn-danger" onclick="removeRomanticObs(${o.id})" title="Remove">✕</button>
            </div>`;
    }).join('');
}

// ── Schedule ──────────────────────────────────────────────────

function initScheduleButton() {
    document.getElementById('generate-schedule-btn').addEventListener('click', async () => {
        const teams = getTeams();
        const scheduledActivities = getScheduledActivities();

        if (teams.length < 2) {
            showToast('Add at least 2 teams first!', 'error');
            return;
        }
        if (scheduledActivities.length === 0) {
            showToast('No activities marked "In Schedule"!', 'error');
            return;
        }

        const rounds = parseInt(document.getElementById('schedule-rounds-input').value, 10) || 0;
        try {
            await apiGenerateSchedule(rounds);
        } catch (err) {
            return;
        }
        const newCount = getSchedule().filter(m => m.round > 0).length;
        showToast(`Schedule generated: ${newCount} matches ✓`);
        renderSchedule();
    });
}

function renderSchedule() {
    const container = document.getElementById('schedule-list');
    const schedule = getSchedule();
    const status = document.getElementById('schedule-status');

    const scheduled = schedule.filter(m => m.round > 0);

    if (scheduled.length === 0) {
        container.innerHTML = '';
        status.textContent = 'No schedule generated yet.';
        return;
    }

    const finished = scheduled.filter(m => m.status === 'finished').length;
    status.textContent = `${scheduled.length} matches — ${finished} finished, ${scheduled.length - finished} pending`;

    // Group by round
    const rounds = {};
    scheduled.forEach(m => {
        if (!rounds[m.round]) rounds[m.round] = [];
        rounds[m.round].push(m);
    });

    let html = '';
    Object.keys(rounds).sort((a, b) => a - b).forEach(r => {
        html += `<div class="schedule-round"><h3>Round ${r}</h3>`;
        rounds[r].forEach(m => {
            const act = getActivityById(m.activityId);
            const aName = getTeamName(m.teamA);
            const bName = getTeamName(m.teamB);
            const statusClass = m.status === 'finished' ? 'match-done' : 'match-pending';
            const scoreText = m.status === 'finished'
                ? `${m.scoreA} – ${m.scoreB}`
                : 'pending';

            const editBtn = m.status === 'finished'
                ? `<button class="btn btn-small btn-secondary" onclick="editMatchScore(${m.matchId})" title="Edit score">✏️</button>`
                : `<button class="btn btn-small btn-secondary" onclick="editMatchScore(${m.matchId})" title="Set score">✏️</button>`;
            
            const deleteBtn = `<button class="btn btn-small btn-danger" onclick="deleteMatch(${m.matchId})" title="Delete match">✕</button>`;

            html += `
                <div class="match-row ${statusClass}">
                    <span class="match-activity">${escapeHtml(act ? act.name : m.activityId)}</span>
                    <span class="match-teams">${escapeHtml(aName)} vs ${escapeHtml(bName)}</span>
                    <span class="match-score">${scoreText}</span>
                    ${editBtn}
                    ${deleteBtn}
                </div>`;
        });
        html += '</div>';
    });

    container.innerHTML = html;
}

// ── Edit submitted scores (N5) ────────────────────────────────

async function editMatchScore(matchId) {
    const schedule = getSchedule();
    const match = schedule.find(m => m.matchId === matchId);
    if (!match) return;

    const aName = getTeamName(match.teamA);
    const bName = getTeamName(match.teamB);
    const act = getActivityById(match.activityId);

    // Get current scores or defaults
    const currentA = match.scoreA !== null && match.scoreA !== undefined ? match.scoreA : 0;
    const currentB = match.scoreB !== null && match.scoreB !== undefined ? match.scoreB : 0;

    const newScoreA = await uiPrompt(`Enter score for ${aName} (current: ${currentA}):`, currentA);
    if (newScoreA === null) return; // User cancelled

    const newScoreB = await uiPrompt(`Enter score for ${bName} (current: ${currentB}):`, currentB);
    if (newScoreB === null) return; // User cancelled

    const parsedA = parseInt(newScoreA, 10);
    const parsedB = parseInt(newScoreB, 10);

    if (isNaN(parsedA) || isNaN(parsedB)) {
        showToast('Invalid scores!', 'error');
        return;
    }

    // Validate against activity min/max if available
    if (act) {
        if (parsedA < act.min || parsedA > act.max || parsedB < act.min || parsedB > act.max) {
            showToast(`Scores must be between ${act.min} and ${act.max}!`, 'error');
            return;
        }
    }

    try {
        await apiUpdateMatch(matchId, parsedA, parsedB);
    } catch (err) {
        return;
    }
    renderSchedule();
    renderPreTournament();
    showToast('Score updated ✓');
}

// ── Delete match ──────────────────────────────────────────────

async function deleteMatch(matchId) {
    const schedule = getSchedule();
    const match = schedule.find(m => m.matchId === matchId);
    if (!match) return;

    const aName = getTeamName(match.teamA);
    const bName = getTeamName(match.teamB);
    const act = getActivityById(match.activityId);
    const actName = act ? act.name : match.activityId;

    const confirmMsg = `Delete this match? ${actName}: ${aName} vs ${bName}` +
        (match.status === 'finished' ? ` (score: ${match.scoreA} – ${match.scoreB})` : '');

    if (!await uiConfirm(confirmMsg)) return;

    try {
        await apiDeleteMatch(matchId);
    } catch (err) {
        return;
    }
    renderSchedule();
    showToast('Match deleted ✓');
}

// ── Data management ───────────────────────────────────────────

function initDataButtons() {
    document.getElementById('export-btn').addEventListener('click', async () => {
        let json;
        try {
            json = await exportAllData();
        } catch (err) {
            showToast('Export failed: ' + err.message, 'error');
            return;
        }
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'olympiske-leker-backup-' + new Date().toISOString().slice(0, 16).replace(/:/g, '-') + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Data exported ✓');
    });

    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                await importAllData(ev.target.result);
                showToast('Data imported ✓');
                renderTeams();
                renderActivities();
                renderSchedule();
                renderPreTournament();
                renderRomantic();
                populatePreTournamentDropdowns();
                populateRomanticDropdown();
            } catch (err) {
                showToast('Import failed: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    document.getElementById('reset-btn').addEventListener('click', async () => {
        if (!await uiConfirm('⚠️ This will delete ALL data in the active tournament (teams, activities, schedule, scores). Are you sure?')) return;
        try {
            await apiReset();
        } catch (err) {
            return;
        }
        showToast('All data reset ✓');
        renderTeams();
        renderActivities();
        renderSchedule();
        renderPreTournament();
        renderRomantic();
        populatePreTournamentDropdowns();
        populateRomanticDropdown();
    });
}

// ── Tournaments ───────────────────────────────────

let _tournamentIndex = null;

function initTournaments() {
    document.getElementById('create-tournament-btn').addEventListener('click', async () => {
        const input = document.getElementById('new-tournament-name');
        const name = input.value.trim();
        if (!name) {
            showToast('Enter a tournament name!', 'error');
            return;
        }
        try {
            const result = await apiCreateTournament(name);
            await apiActivateTournament(result.id);
        } catch (err) {
            return;
        }
        input.value = '';
        showToast('Tournament created and opened ✓');
        renderAllAdmin();
    });
    renderTournaments();
}

async function renderTournaments() {
    const container = document.getElementById('tournament-list');
    if (!container) return;
    try {
        _tournamentIndex = await apiListTournaments();
    } catch (err) {
        container.innerHTML = '<p class="hint">Could not load tournaments.</p>';
        return;
    }

    const { activeId, tournaments } = _tournamentIndex;
    container.innerHTML = tournaments.map(t => {
        const isActive = t.id === activeId;
        const created = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '';
        return `
            <div class="card team-card ${isActive ? 'tournament-active' : ''}">
                <span class="team-name">${escapeHtml(t.name)}
                    <small style="color:#a8b2d1;font-weight:400;"> · ${created}</small>
                    ${isActive ? '<span class="active-badge">● ACTIVE</span>' : ''}
                </span>
                <div class="card-actions">
                    ${isActive ? '' : `<button class="btn btn-small btn-primary" onclick="openTournament('${t.id}')">Open</button>`}
                    ${isActive ? '' : `<button class="btn btn-small btn-danger" onclick="deleteTournament('${t.id}')">✕</button>`}
                </div>
            </div>`;
    }).join('');
}

async function openTournament(id) {
    if (!await uiConfirm('Open this tournament? All phones and the dashboard will switch to it.')) return;
    try {
        await apiActivateTournament(id);
    } catch (err) {
        return;
    }
    showToast('Tournament opened ✓');
    renderAllAdmin();
}

async function deleteTournament(id) {
    const entry = _tournamentIndex && _tournamentIndex.tournaments.find(t => t.id === id);
    const name = entry ? entry.name : id;
    if (!await uiConfirm(`⚠️ Permanently delete tournament "${name}" and all its data?`)) return;
    try {
        await apiDeleteTournament(id);
    } catch (err) {
        return;
    }
    showToast('Tournament deleted ✓');
    renderTournaments();
}

function renderAllAdmin() {
    renderTeams();
    renderActivities();
    renderSchedule();
    renderPreTournament();
    renderRomantic();
    populatePreTournamentDropdowns();
    populateRomanticDropdown();
    renderTournaments();
}

// ── Utilities ─────────────────────────────────────────────────

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, type) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'toast show' + (type === 'error' ? ' toast-error' : '');
    setTimeout(() => { toast.className = 'toast'; }, 3000);
}
