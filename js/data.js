/* ============================================================
   data.js — localStorage helpers + BroadcastChannel sync
   ============================================================ */

const STORAGE_KEYS = {
    TEAMS: 'ol_teams',
    ACTIVITIES: 'ol_activities',
    SCHEDULE: 'ol_schedule',
    LAST_ACTION: 'ol_last_action',
    PRE_SCORES: 'ol_pre_scores',
    ROMANTIC_OBS: 'ol_romantic_obs'
};

const channel = new BroadcastChannel('ol_sync');

// ── Generic read / write ──────────────────────────────────────

function getData(key) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
}

function setData(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    channel.postMessage({ key, timestamp: Date.now() });
}

// ── Teams ─────────────────────────────────────────────────────

function getTeams() {
    return getData(STORAGE_KEYS.TEAMS) || [];
}

function setTeams(teams) {
    setData(STORAGE_KEYS.TEAMS, teams);
}

// ── Activities ────────────────────────────────────────────────

function getDefaultActivities() {
    return [
        {
            id: 'dart', name: 'Dart',
            scoreType: 'numeric', min: 0, max: 3,
            winPoints: 1, drawPoints: 1, lossPoints: 0,
            marginMultiplier: 0, fixedBonus: 0,
            inSchedule: true, weight: 1
        },
        {
            id: 'pushups', name: 'Push Ups',
            scoreType: 'winlose', min: 0, max: 1,
            winPoints: 4, drawPoints: 1, lossPoints: 0,
            marginMultiplier: 0, fixedBonus: 0,
            inSchedule: true, weight: 1
        },
        {
            id: 'sorting', name: 'Sorting',
            scoreType: 'winlose', min: 0, max: 1,
            winPoints: 4, drawPoints: 1, lossPoints: 0,
            marginMultiplier: 0, fixedBonus: 0,
            inSchedule: true, weight: 1
        },
        {
            id: 'beerpong', name: 'Beerpong',
            scoreType: 'numeric', min: 0, max: 4,
            winPoints: 1, drawPoints: 1, lossPoints: 0,
            marginMultiplier: 1, fixedBonus: 0,
            inSchedule: true, weight: 1
        },
        {
            id: 'flipcup', name: 'Flip Cup',
            scoreType: 'winlose', min: 0, max: 1,
            winPoints: 4, drawPoints: 1, lossPoints: 0,
            marginMultiplier: 0, fixedBonus: 0,
            inSchedule: true, weight: 1
        },
        {
            id: 'fyrstikkiq', name: 'Fyrstikk IQ',
            scoreType: 'numeric', min: 0, max: 3,
            winPoints: 1, drawPoints: 3, lossPoints: 0,
            marginMultiplier: 1, fixedBonus: 0,
            inSchedule: true, weight: 0.5
        },
        {
            id: 'boccia', name: 'Boccia',
            scoreType: 'numeric', min: 0, max: 10,
            winPoints: 3, drawPoints: 1, lossPoints: 0,
            marginMultiplier: 1, fixedBonus: 0,
            inSchedule: false
        },
        {
            id: 'kubespillet', name: 'Kubespillet',
            scoreType: 'numeric', min: 0, max: 10,
            winPoints: 3, drawPoints: 1, lossPoints: 0,
            marginMultiplier: 1, fixedBonus: 0,
            inSchedule: false
        },
        {
            id: 'kongekuben', name: 'Kongekuben',
            scoreType: 'numeric', min: 0, max: 10,
            winPoints: 3, drawPoints: 1, lossPoints: 0,
            marginMultiplier: 1, fixedBonus: 0,
            inSchedule: false
        },
        {
            id: 'hestelop', name: 'Hesteløp',
            scoreType: 'numeric', min: 0, max: 10,
            winPoints: 3, drawPoints: 1, lossPoints: 0,
            marginMultiplier: 1, fixedBonus: 0,
            inSchedule: false
        }
    ];
}

function getActivities() {
    return getData(STORAGE_KEYS.ACTIVITIES) || getDefaultActivities();
}

function setActivities(activities) {
    setData(STORAGE_KEYS.ACTIVITIES, activities);
}

// ── Schedule ──────────────────────────────────────────────────

function getSchedule() {
    return getData(STORAGE_KEYS.SCHEDULE) || [];
}

function setSchedule(schedule) {
    setData(STORAGE_KEYS.SCHEDULE, schedule);
}

// ── Pre-Tournament Scores (individual team entries) ───────────

function getPreScores() {
    return getData(STORAGE_KEYS.PRE_SCORES) || [];
}

function setPreScores(scores) {
    setData(STORAGE_KEYS.PRE_SCORES, scores);
}

// ── Romantic Observations ─────────────────────────────────────

function getRomanticObs() {
    return getData(STORAGE_KEYS.ROMANTIC_OBS) || [];
}

function setRomanticObs(obs) {
    setData(STORAGE_KEYS.ROMANTIC_OBS, obs);
}

// ── Last Action (undo support) ────────────────────────────────

function getLastAction() {
    return getData(STORAGE_KEYS.LAST_ACTION);
}

function setLastAction(action) {
    setData(STORAGE_KEYS.LAST_ACTION, action);
}

function clearLastAction() {
    localStorage.removeItem(STORAGE_KEYS.LAST_ACTION);
    channel.postMessage({ key: STORAGE_KEYS.LAST_ACTION, timestamp: Date.now() });
}

// ── Export / Import ───────────────────────────────────────────

function exportAllData() {
    return JSON.stringify({
        teams: getTeams(),
        activities: getActivities(),
        schedule: getSchedule(),
        preScores: getPreScores(),
        romanticObs: getRomanticObs(),
        exportedAt: new Date().toISOString()
    }, null, 2);
}

function importAllData(jsonString) {
    const data = JSON.parse(jsonString);
    if (data.teams) setTeams(data.teams);
    if (data.activities) setActivities(data.activities);
    if (data.schedule) setSchedule(data.schedule);
    if (data.preScores) setPreScores(data.preScores);
    if (data.romanticObs) setRomanticObs(data.romanticObs);
}

// ── Cross-tab listener ───────────────────────────────────────

function onDataChange(callback) {
    // BroadcastChannel (primary — instant, same-origin)
    channel.addEventListener('message', (event) => {
        callback(event.data);
    });

    // Storage event (backup — fires when another tab changes localStorage)
    window.addEventListener('storage', (event) => {
        if (event.key && event.key.startsWith('ol_')) {
            callback({ key: event.key, timestamp: Date.now() });
        }
    });

    // Polling fallback (every 2s — catches edge cases with file:// URLs)
    let lastSnapshot = _snapshotKeys();
    setInterval(() => {
        const current = _snapshotKeys();
        if (current !== lastSnapshot) {
            lastSnapshot = current;
            callback({ key: 'poll', timestamp: Date.now() });
        }
    }, 2000);
}

function _snapshotKeys() {
    return [STORAGE_KEYS.TEAMS, STORAGE_KEYS.ACTIVITIES, STORAGE_KEYS.SCHEDULE, STORAGE_KEYS.PRE_SCORES, STORAGE_KEYS.ROMANTIC_OBS]
        .map(k => localStorage.getItem(k) || '')
        .join('|');
}

// ── Helpers ───────────────────────────────────────────────────

function getTeamName(teamId) {
    const teams = getTeams();
    const team = teams.find(t => t.id === teamId);
    return team ? team.name : 'Unknown';
}

function getActivityById(activityId) {
    const activities = getActivities();
    return activities.find(a => a.id === activityId);
}

function getScheduledActivities() {
    return getActivities().filter(a => a.inSchedule !== false);
}

function getPreTournamentActivities() {
    return getActivities().filter(a => a.inSchedule === false);
}
