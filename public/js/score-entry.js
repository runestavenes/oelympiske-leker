/* ============================================================
   score-entry.js — Score entry page logic
   ============================================================ */

let currentMatchId = null;
let currentScoreA = 0;
let currentScoreB = 0;
let currentActivity = null;
let winloseWinner = null; // 'a' or 'b'
let overlayTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    await initData();
    renderMatchList();
    initUndo();
    initRomanticView();

    // Listen for server data changes (e.g. admin adds schedule)
    onDataChange(() => {
        // Only refresh the list if no form is currently open
        if (currentMatchId === null) {
            renderMatchList();
        }
        // Also refresh romantic observations if visible
        const romanticView = document.getElementById('romantic-view');
        if (romanticView && !romanticView.classList.contains('hidden')) {
            renderRomantic();
            populateRomanticDropdown();
        }
    });
});

// ── Match list ────────────────────────────────────────────────

function renderMatchList() {
    const container = document.getElementById('match-list');
    const schedule = getSchedule();
    // Only show scheduled matches (exclude any legacy pre-tournament entries)
    const scheduledMatches = schedule.filter(m => m.round > 0 && !m.preTournament);
    const pending = getPendingMatches(scheduledMatches);

    // Update undo bar visibility (only this device's own last submit)
    const lastAction = getMyLastAction();
    const undoBar = document.getElementById('undo-bar');
    if (lastAction) {
        undoBar.classList.remove('hidden');
    } else {
        undoBar.classList.add('hidden');
    }

    if (pending.length === 0) {
        container.innerHTML = `
            <div class="card empty-state">
                <h2>🎉 All games completed!</h2>
                <p>Check the <a href="dashboard.html">dashboard</a> for final standings.</p>
            </div>`;
        return;
    }

    container.innerHTML = pending.map(m => {
        const act = getActivityById(m.activityId);
        const aName = getTeamName(m.teamA);
        const bName = getTeamName(m.teamB);
        const roundLabel = 'Round ' + m.round;
        return `
            <div class="card match-card" onclick="openScoreForm(${m.matchId})">
                <div class="match-card-header">
                    <span class="match-round">${roundLabel}</span>
                    <span class="match-activity-badge">${escapeHtml(act ? act.name : m.activityId)}</span>
                </div>
                <div class="match-card-teams">
                    <span class="team-name">${escapeHtml(aName)}</span>
                    <span class="vs-badge">VS</span>
                    <span class="team-name">${escapeHtml(bName)}</span>
                </div>
                <button class="btn btn-primary btn-enter-score">Enter Score →</button>
            </div>`;
    }).join('');
}

// ── Score form ────────────────────────────────────────────────

function openScoreForm(matchId) {
    const schedule = getSchedule();
    const match = schedule.find(m => m.matchId === matchId);
    if (!match) return;

    currentMatchId = matchId;
    currentActivity = getActivityById(match.activityId);
    currentScoreA = 0;
    currentScoreB = 0;
    winloseWinner = null;

    const aName = getTeamName(match.teamA);
    const bName = getTeamName(match.teamB);

    document.getElementById('form-title').textContent = `${aName} vs ${bName}`;
    document.getElementById('form-activity').textContent = currentActivity ? currentActivity.name : match.activityId;

    // Show correct input type
    const numericEl = document.getElementById('numeric-inputs');
    const winloseEl = document.getElementById('winlose-inputs');

    if (currentActivity && currentActivity.scoreType === 'winlose') {
        numericEl.classList.add('hidden');
        winloseEl.classList.remove('hidden');
        document.getElementById('wl-a-label').textContent = aName;
        document.getElementById('wl-b-label').textContent = bName;
        // Reset selection
        document.getElementById('wl-team-a').classList.remove('selected');
        document.getElementById('wl-team-b').classList.remove('selected');
        document.getElementById('wl-draw').classList.remove('selected');
    } else {
        winloseEl.classList.add('hidden');
        numericEl.classList.remove('hidden');
        document.getElementById('team-a-label').textContent = aName;
        document.getElementById('team-b-label').textContent = bName;
        document.getElementById('score-a-display').textContent = '0';
        document.getElementById('score-b-display').textContent = '0';
    }

    // Reset confirm bar
    document.getElementById('confirm-bar').classList.add('hidden');
    document.getElementById('submit-bar').style.display = '';

    // Show the form, hide the list
    document.getElementById('match-list').classList.add('hidden');
    document.getElementById('score-form').classList.remove('hidden');
}

function closeForm() {
    document.getElementById('score-form').classList.add('hidden');
    document.getElementById('match-list').classList.remove('hidden');
    currentMatchId = null;
}

// ── Numeric stepper ───────────────────────────────────────────

function adjustScore(team, delta) {
    if (!currentActivity) return;
    const min = currentActivity.min;
    const max = currentActivity.max;

    if (team === 'a') {
        currentScoreA = Math.max(min, Math.min(max, currentScoreA + delta));
        document.getElementById('score-a-display').textContent = currentScoreA;
    } else {
        currentScoreB = Math.max(min, Math.min(max, currentScoreB + delta));
        document.getElementById('score-b-display').textContent = currentScoreB;
    }
}

// ── Win/Lose toggle ───────────────────────────────────────────

function setWinner(team) {
    winloseWinner = team;
    const btnA = document.getElementById('wl-team-a');
    const btnB = document.getElementById('wl-team-b');
    const btnDraw = document.getElementById('wl-draw');
    btnA.classList.toggle('selected', team === 'a');
    btnB.classList.toggle('selected', team === 'b');
    btnDraw.classList.toggle('selected', team === 'draw');

    if (team === 'draw') {
        currentScoreA = 0;
        currentScoreB = 0;
    } else {
        currentScoreA = team === 'a' ? 1 : 0;
        currentScoreB = team === 'b' ? 1 : 0;
    }
}

// ── Confirm flow ──────────────────────────────────────────────

function requestConfirm() {
    if (!currentActivity) return;

    // Validate win/lose selection
    if (currentActivity.scoreType === 'winlose' && winloseWinner === null) {
        showToast('Select a winner first!', 'error');
        return;
    }

    // Validate minimum winning score (numeric activities)
    if (currentActivity.scoreType !== 'winlose' && currentActivity.minWinScore > 0 &&
        Math.max(currentScoreA, currentScoreB) < currentActivity.minWinScore) {
        showToast(`Winning team must have at least ${currentActivity.minWinScore} points in ${currentActivity.name}!`, 'error');
        return;
    }

    const schedule = getSchedule();
    const match = schedule.find(m => m.matchId === currentMatchId);
    if (!match) return;

    const aName = getTeamName(match.teamA);
    const bName = getTeamName(match.teamB);

    document.getElementById('confirm-text').textContent =
        `${aName}: ${currentScoreA}  —  ${bName}: ${currentScoreB}`;
    document.getElementById('confirm-bar').classList.remove('hidden');
    document.getElementById('submit-bar').style.display = 'none';
}

function cancelConfirm() {
    document.getElementById('confirm-bar').classList.add('hidden');
    document.getElementById('submit-bar').style.display = '';
}

async function confirmSubmit() {
    const schedule = getSchedule();
    const match = schedule.find(m => m.matchId === currentMatchId);
    if (!match) return;

    try {
        await apiSubmitScore(match.matchId, currentScoreA, currentScoreB);
    } catch (err) {
        return; // error toast already shown; keep form open for retry
    }

    // Show "next game" overlay
    showNextOverlay(match);

    // Close form and refresh list
    document.getElementById('score-form').classList.add('hidden');
    currentMatchId = null;
    renderMatchList();
}

// ── Next-game overlay ─────────────────────────────────────────

function showNextOverlay(match) {
    const schedule = getSchedule();
    const overlay = document.getElementById('next-overlay');
    const info = document.getElementById('next-info');

    const teamAName = getTeamName(match.teamA);
    const teamBName = getTeamName(match.teamB);

    const nextA = getNextMatch(match.teamA, schedule);
    const nextB = getNextMatch(match.teamB, schedule);

    let html = '';

    html += buildNextLine(teamAName, nextA, match.teamA);
    html += buildNextLine(teamBName, nextB, match.teamB);

    info.innerHTML = html;
    overlay.classList.remove('hidden');
    document.getElementById('match-list').classList.remove('hidden');

    // Auto-dismiss after 8 seconds
    if (overlayTimer) clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
        overlay.classList.add('hidden');
    }, 8000);
}

function buildNextLine(teamName, nextMatch, teamId) {
    if (!nextMatch) {
        return `<p class="next-line"><strong>${escapeHtml(teamName)}</strong> — All games completed! 🎉</p>`;
    }

    const act = getActivityById(nextMatch.activityId);
    const opponentId = nextMatch.teamA === teamId ? nextMatch.teamB : nextMatch.teamA;
    const opponentName = getTeamName(opponentId);
    const actName = act ? act.name : nextMatch.activityId;

    return `<p class="next-line"><strong>${escapeHtml(teamName)}</strong> → ${escapeHtml(actName)} vs ${escapeHtml(opponentName)}</p>`;
}

// ── Undo ──────────────────────────────────────────────────────

function initUndo() {
    document.getElementById('undo-btn').addEventListener('click', undoLastScore);
}

async function undoLastScore() {
    const lastAction = getMyLastAction();
    if (!lastAction || lastAction.type !== 'score_submit') {
        showToast('Nothing to undo', 'error');
        return;
    }

    try {
        await apiUndoMyScore();
    } catch (err) {
        renderMatchList();
        return; // error toast already shown
    }

    showToast('Score reverted ✓');
    renderMatchList();
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

// ── View Switching ────────────────────────────────────────────

function switchView(view) {
    const scoresView = document.getElementById('scores-view');
    const romanticView = document.getElementById('romantic-view');
    const toggleScores = document.getElementById('toggle-scores');
    const toggleRomantic = document.getElementById('toggle-romantic');
    const undoBar = document.getElementById('undo-bar');

    if (view === 'scores') {
        scoresView.classList.remove('hidden');
        romanticView.classList.add('hidden');
        toggleScores.classList.add('active');
        toggleRomantic.classList.remove('active');
        undoBar.classList.remove('hidden');
        // Update undo bar visibility based on last action
        const lastAction = getMyLastAction();
        if (!lastAction) {
            undoBar.classList.add('hidden');
        }
    } else if (view === 'romantic') {
        scoresView.classList.add('hidden');
        romanticView.classList.remove('hidden');
        toggleScores.classList.remove('active');
        toggleRomantic.classList.add('active');
        undoBar.classList.add('hidden');
        renderRomantic();
    }
}

// ── Romantic Observations ─────────────────────────────────────

function initRomanticView() {
    populateRomanticDropdown();
    renderRomantic();
    
    // Add enter key support for text input
    const textInput = document.getElementById('romantic-text-input');
    if (textInput) {
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addRomanticObs();
        });
    }
}

function populateRomanticDropdown() {
    const teams = getTeams();
    const select = document.getElementById('romantic-team-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">Select team…</option>' +
        teams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

async function addRomanticObs() {
    const textInput = document.getElementById('romantic-text-input');
    const teamSelect = document.getElementById('romantic-team-select');
    
    if (!textInput || !teamSelect) return;
    
    const text = textInput.value.trim();
    const teamId = parseInt(teamSelect.value, 10);

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
        return; // error toast already shown
    }
    
    textInput.value = '';
    teamSelect.selectedIndex = 0;
    renderRomantic();
    showToast('Romantisk observasjon added (+1 win) ✓');
}

async function removeRomanticObs(id) {
    if (!await uiConfirm('Remove this observation?')) return;
    
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
    if (!container) return;
    
    const obs = getRomanticObs();

    if (obs.length === 0) {
        container.innerHTML = '<p class="hint" style="text-align:center;padding:2rem 0;color:#a8b2d1;">No romantic observations yet. 💕</p>';
        return;
    }

    // Show most recent first
    const sorted = obs.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    container.innerHTML = sorted.map(o => {
        const teamName = getTeamName(o.teamId);
        return `
            <div class="match-row match-done" style="margin-bottom:0.5rem;">
                <span class="match-teams" style="min-width:150px;"><strong>${escapeHtml(teamName)}</strong></span>
                <span class="match-activity" style="flex:1;">${escapeHtml(o.text)}</span>
                <span class="match-score" style="color:#06ffa5;">+1 W</span>
                <button class="btn btn-small btn-danger" onclick="removeRomanticObs(${o.id})" title="Remove">✕</button>
            </div>`;
    }).join('');
}
