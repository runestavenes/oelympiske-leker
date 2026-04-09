/* ============================================================
   score-entry.js — Score entry page logic
   ============================================================ */

let currentMatchId = null;
let currentScoreA = 0;
let currentScoreB = 0;
let currentActivity = null;
let winloseWinner = null; // 'a' or 'b'
let overlayTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    renderMatchList();
    initUndo();

    // Listen for cross-tab data changes (e.g. admin adds schedule)
    onDataChange(() => {
        // Only refresh the list if no form is currently open
        if (currentMatchId === null) {
            renderMatchList();
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

    // Update undo bar visibility
    const lastAction = getLastAction();
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

function confirmSubmit() {
    const schedule = getSchedule();
    const match = schedule.find(m => m.matchId === currentMatchId);
    if (!match) return;

    // Save undo state before changing
    setLastAction({
        type: 'score_submit',
        matchId: match.matchId,
        previous: {
            status: match.status,
            scoreA: match.scoreA,
            scoreB: match.scoreB
        }
    });

    // Update the match
    match.status = 'finished';
    match.scoreA = currentScoreA;
    match.scoreB = currentScoreB;
    setSchedule(schedule);

    // Show "next game" overlay
    showNextOverlay(match);

    // Close form and refresh list
    document.getElementById('score-form').classList.add('hidden');
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

function undoLastScore() {
    const lastAction = getLastAction();
    if (!lastAction || lastAction.type !== 'score_submit') {
        showToast('Nothing to undo', 'error');
        return;
    }

    const schedule = getSchedule();
    const match = schedule.find(m => m.matchId === lastAction.matchId);
    if (!match) {
        showToast('Match not found', 'error');
        return;
    }

    // Revert
    match.status = lastAction.previous.status;
    match.scoreA = lastAction.previous.scoreA;
    match.scoreB = lastAction.previous.scoreB;
    setSchedule(schedule);
    clearLastAction();

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
