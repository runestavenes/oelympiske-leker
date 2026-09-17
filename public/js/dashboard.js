/* ============================================================
   dashboard.js — Dashboard rendering + live updates
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
    await initData();
    _rememberResults();
    renderAll();
    onDataChange(() => {
        checkFanfare();
        renderAll();
    });
});

// ── Result fanfare ────────────────────────────────────────────

let _seenMatchIds = new Set();
let _seenObsIds = new Set();
let _fanfareTimer = null;

function _rememberResults() {
    _seenMatchIds = new Set(getSchedule().filter(m => m.status === 'finished').map(m => m.matchId));
    _seenObsIds = new Set(getRomanticObs().map(o => o.id));
}

function checkFanfare() {
    const newMatches = getSchedule().filter(m => m.status === 'finished' && !_seenMatchIds.has(m.matchId));
    const newObs = getRomanticObs().filter(o => !_seenObsIds.has(o.id));
    _rememberResults();

    let text = null;
    if (newMatches.length > 0) {
        const m = newMatches[newMatches.length - 1];
        const act = getActivityById(m.activityId);
        const aName = getTeamName(m.teamA);
        const bName = getTeamName(m.teamB);
        const emoji = m.scoreA === m.scoreB ? '🤝' : '🏆';
        const headline = m.scoreA > m.scoreB ? `${aName} beats ${bName}!`
            : m.scoreB > m.scoreA ? `${bName} beats ${aName}!`
            : `${aName} and ${bName} draw!`;
        text = `${emoji} ${act ? act.name : m.activityId}: ${headline}  ${m.scoreA} – ${m.scoreB}`;
    } else if (newObs.length > 0) {
        const o = newObs[newObs.length - 1];
        text = `💕 Romantisk observasjon: ${getTeamName(o.teamId)} +1 win!`;
    }
    if (text) showFanfare(text);
}

function showFanfare(text) {
    let el = document.getElementById('fanfare');
    if (!el) {
        el = document.createElement('div');
        el.id = 'fanfare';
        el.className = 'fanfare';
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth; // restart CSS animation
    el.classList.add('show');
    if (_fanfareTimer) clearTimeout(_fanfareTimer);
    _fanfareTimer = setTimeout(() => el.classList.remove('show'), 6000);
}

function renderAll() {
    renderProgress();
    renderLeaderboard();
    renderActiveGames();
    renderRecentResults();
    renderActivityLeaderboards();
    renderTicker();
}

// ── Progress indicator (N4) ───────────────────────────────────

function renderProgress() {
    const schedule = getSchedule();
    const total = schedule.length;
    const finished = schedule.filter(m => m.status === 'finished').length;

    const fill = document.getElementById('progress-fill');
    const text = document.getElementById('progress-text');

    if (total === 0) {
        fill.style.width = '0%';
        text.textContent = 'No matches scheduled';
        return;
    }

    const pct = Math.round((finished / total) * 100);
    fill.style.width = pct + '%';

    // Count rounds
    const scheduledMatches = schedule.filter(m => m.round > 0);
    const totalRounds = scheduledMatches.length > 0
        ? Math.max(...scheduledMatches.map(m => m.round))
        : 0;
    const finishedRounds = totalRounds > 0
        ? countFinishedRounds(scheduledMatches, totalRounds)
        : 0;

    text.textContent = `${finished}/${total} games (${pct}%)` +
        (totalRounds > 0 ? ` — Round ${finishedRounds + 1} of ${totalRounds}` : '');
}

function countFinishedRounds(scheduledMatches, totalRounds) {
    let finished = 0;
    for (let r = 1; r <= totalRounds; r++) {
        const roundMatches = scheduledMatches.filter(m => m.round === r);
        if (roundMatches.every(m => m.status === 'finished')) {
            finished = r;
        } else {
            break;
        }
    }
    return finished;
}

// ── Leaderboard ───────────────────────────────────────────────

function renderLeaderboard() {
    const teams = getTeams();
    const schedule = getSchedule();
    const activities = getActivities();
    const board = calculateLeaderboard(teams, schedule, activities);
    const tbody = document.getElementById('leaderboard-body');

    if (board.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No teams yet</td></tr>';
        return;
    }

    tbody.innerHTML = board.map((s, i) => {
        const rankClass = i === 0 ? 'rank-gold' : i === 1 ? 'rank-silver' : i === 2 ? 'rank-bronze' : '';
        return `
            <tr class="${rankClass}">
                <td class="rank-cell">${i + 1}</td>
                <td class="team-cell">${escapeHtml(s.teamName)}</td>
                <td>${s.wins}</td>
                <td>${s.draws}</td>
                <td>${s.losses}</td>
                <td>${getWinRate(s)}</td>
                <td class="pts-cell">${s.totalPoints}</td>
            </tr>`;
    }).join('');
}

// ── Active games ──────────────────────────────────────────────

function renderActiveGames() {
    const schedule = getSchedule();
    const pending = getPendingMatches(schedule);
    const container = document.getElementById('active-games');

    // Show next few pending games (grouped loosely by round)
    const shown = pending.slice(0, 8);

    if (shown.length === 0) {
        container.innerHTML = '<p class="empty-state-small">🎉 All games finished!</p>';
        return;
    }

    container.innerHTML = shown.map(m => {
        const act = getActivityById(m.activityId);
        const aName = getTeamName(m.teamA);
        const bName = getTeamName(m.teamB);
        return `
            <div class="game-row game-pending">
                <span class="game-activity">${escapeHtml(act ? act.name : m.activityId)}</span>
                <span class="game-teams">${escapeHtml(aName)} <span class="vs-small">vs</span> ${escapeHtml(bName)}</span>
                <span class="game-round">R${m.round}</span>
            </div>`;
    }).join('');
}

// ── Recent results ────────────────────────────────────────────

function renderRecentResults() {
    const schedule = getSchedule();
    const activities = getActivities();
    const romanticObs = getRomanticObs();
    const container = document.getElementById('recent-results');

    const actMap = {};
    activities.forEach(a => { actMap[a.id] = a; });

    // Build combined list: match results + romantic observations, sorted by timestamp
    const allResults = [];

    // Add finished matches
    schedule.forEach(m => {
        if (m.status !== 'finished') return;
        const act = actMap[m.activityId];
        const aName = getTeamName(m.teamA);
        const bName = getTeamName(m.teamB);
        const pts = act ? calculateMatchPoints(m, act) : null;

        let resultClass = '';
        if (pts) {
            if (pts.resultA === 'win') resultClass = 'result-a-wins';
            else if (pts.resultB === 'win') resultClass = 'result-b-wins';
            else resultClass = 'result-draw';
        }

        allResults.push({
            timestamp: m.timestamp || 0,
            html: `
                <div class="game-row game-done ${resultClass}">
                    <span class="game-activity">${escapeHtml(act ? act.name : m.activityId)}</span>
                    <span class="game-teams">
                        ${escapeHtml(aName)} <strong>${m.scoreA}</strong>
                        – <strong>${m.scoreB}</strong> ${escapeHtml(bName)}
                    </span>
                    ${pts ? `<span class="game-pts">+${pts.teamA} / +${pts.teamB}</span>` : ''}
                </div>`
        });
    });

    // Add romantic observations
    romanticObs.forEach(o => {
        const teamName = getTeamName(o.teamId);
        allResults.push({
            timestamp: o.timestamp || 0,
            html: `
                <div class="game-row game-done romantic-result">
                    <span class="game-activity">💕</span>
                    <span class="game-teams">
                        <strong>${escapeHtml(teamName)}</strong> — ${escapeHtml(o.text)}
                    </span>
                    <span class="game-pts">+1 W</span>
                </div>`
        });
    });

    if (allResults.length === 0) {
        container.innerHTML = '<p class="empty-state-small">No results yet</p>';
        return;
    }

    // Sort by timestamp descending and take most recent 8
    allResults.sort((a, b) => b.timestamp - a.timestamp);
    const recentItems = allResults.slice(0, 8).map(r => r.html);

    container.innerHTML = recentItems.join('');
}

// ── Ticker ────────────────────────────────────────────────────

function renderTicker() {
    const schedule = getSchedule();
    const activities = getActivities();
    const recent = getRecentResults(schedule, 10);
    const ticker = document.getElementById('ticker-content');

    if (recent.length === 0) {
        ticker.textContent = '🏅 Ølympiske Leker — Waiting for first results…';
        return;
    }

    const actMap = {};
    activities.forEach(a => { actMap[a.id] = a; });

    const items = recent.map(m => {
        const act = actMap[m.activityId];
        const aName = getTeamName(m.teamA);
        const bName = getTeamName(m.teamB);
        return `${act ? act.name : m.activityId}: ${aName} ${m.scoreA}–${m.scoreB} ${bName}`;
    });

    // Duplicate for seamless loop
    const text = items.join('   ★   ');
    ticker.textContent = text + '   ★   ' + text;
}

// ── Per-activity leaderboard (N6) ─────────────────────────────

function renderActivityLeaderboards() {
    const container = document.getElementById('activity-leaderboards');
    const teams = getTeams();
    const schedule = getSchedule();
    const activities = getActivities();

    // Only show scheduled (in-tournament) activities
    const scheduledActivities = activities.filter(a => a.inSchedule !== false);
    const romanticObs = getRomanticObs();
    const finishedCount = schedule.filter(m => m.status === 'finished').length;

    if (teams.length === 0 || (finishedCount === 0 && romanticObs.length === 0)) {
        container.innerHTML = '';
        return;
    }

    const actMap = {};
    activities.forEach(a => { actMap[a.id] = a; });

    // Build per-activity stats
    const activityStats = {};
    scheduledActivities.forEach(a => {
        activityStats[a.id] = {};
        teams.forEach(t => {
            activityStats[a.id][t.id] = { teamName: t.name, wins: 0, losses: 0, draws: 0, pts: 0, games: 0 };
        });
    });

    schedule.forEach(match => {
        if (match.status !== 'finished') return;
        const activity = actMap[match.activityId];
        if (!activity || !activityStats[match.activityId]) return;

        const result = calculateMatchPoints(match, activity);
        const sA = activityStats[match.activityId][match.teamA];
        const sB = activityStats[match.activityId][match.teamB];

        if (sA) {
            sA.pts += result.teamA;
            sA.games++;
            if (result.resultA === 'win') sA.wins++;
            if (result.resultA === 'loss') sA.losses++;
            if (result.resultA === 'draw') sA.draws++;
        }
        if (sB) {
            sB.pts += result.teamB;
            sB.games++;
            if (result.resultB === 'win') sB.wins++;
            if (result.resultB === 'loss') sB.losses++;
            if (result.resultB === 'draw') sB.draws++;
        }
    });

    // Render horizontal card layout
    let html = '<h2 class="panel-title" style="padding:0.5rem 1rem;">📊 Per-Activity Standings</h2>';
    html += '<div class="activity-lb-cards">';

    scheduledActivities.forEach(a => {
        const stats = activityStats[a.id];
        if (!stats) return;

        const sorted = Object.values(stats)
            .filter(s => s.games > 0)
            .sort((x, y) => y.wins !== x.wins ? y.wins - x.wins : y.pts - x.pts);

        if (sorted.length === 0) return;

        html += `
            <div class="activity-lb-card">
                <div class="activity-lb-card-title">${escapeHtml(a.name)}</div>
                <table class="activity-lb-table">
                    <thead><tr><th>#</th><th>Team</th><th>W</th><th>D</th><th>L</th><th>Pts</th></tr></thead>
                    <tbody>`;
        sorted.forEach((s, i) => {
            html += `<tr><td>${i + 1}</td><td>${escapeHtml(s.teamName)}</td><td>${s.wins}</td><td>${s.draws}</td><td>${s.losses}</td><td>${s.pts}</td></tr>`;
        });
        html += '</tbody></table></div>';
    });

    // Romantic observations standings card
    if (romanticObs.length > 0) {
        const teams = getTeams();
        const romanticCounts = {};
        teams.forEach(t => { romanticCounts[t.id] = { teamName: t.name, count: 0 }; });
        romanticObs.forEach(o => {
            if (romanticCounts[o.teamId]) romanticCounts[o.teamId].count++;
        });

        const romanticSorted = Object.values(romanticCounts)
            .filter(s => s.count > 0)
            .sort((a, b) => b.count - a.count);

        if (romanticSorted.length > 0) {
            html += `
                <div class="activity-lb-card romantic-card">
                    <div class="activity-lb-card-title">💕 Romantiske obs.</div>
                    <table class="activity-lb-table">
                        <thead><tr><th>#</th><th>Team</th><th>W</th></tr></thead>
                        <tbody>`;
            romanticSorted.forEach((s, i) => {
                html += `<tr><td>${i + 1}</td><td>${escapeHtml(s.teamName)}</td><td>${s.count}</td></tr>`;
            });
            html += '</tbody></table></div>';
        }
    }

    html += '</div>';
    container.innerHTML = html;
}

// ── Utilities ─────────────────────────────────────────────────

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
