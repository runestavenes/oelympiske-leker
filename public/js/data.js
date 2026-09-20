/* ============================================================
   data.js — client state cache + API sync
   Replaces the old localStorage layer. Keeps synchronous
   getters by holding the full tournament state in memory,
   hydrated by initData() and refreshed by polling.
   ============================================================ */

const POLL_INTERVAL_MS = 3500;

let _state = null;          // full tournament state from server
let _stamp = null;          // server change stamp (tournamentId:version)
let _listeners = [];
let _requireAdmin = false;
let _authPromise = null;
let _offline = false;

// ── Credentials (remembered per device) ──────────────────────

function _getPin() { return localStorage.getItem('ol_event_pin') || ''; }
function _getAdminCode() { return localStorage.getItem('ol_admin_code') || ''; }

function getDeviceId() {
    let id = localStorage.getItem('ol_device_id');
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('ol_device_id', id);
    }
    return id;
}

function _authHeaders() {
    const headers = {};
    const pin = _getPin();
    const admin = _getAdminCode();
    if (pin) headers['X-Event-Pin'] = pin;
    if (admin) headers['X-Admin-Code'] = admin;
    return headers;
}

// ── Init + auth gate ──────────────────────────────────────────

async function initData(options = {}) {
    _requireAdmin = !!options.admin;
    getDeviceId();
    _injectChrome();
    await _ensureAuth();
    await _fetchState(true);
    setInterval(_poll, POLL_INTERVAL_MS);
}

function _ensureAuth() {
    if (_authPromise) return _authPromise;
    _authPromise = (async () => {
        while (true) {
            let check;
            try {
                const res = await fetch('/api/auth/check', { headers: _authHeaders() });
                check = await res.json();
            } catch (err) {
                _setOffline(true);
                await _sleep(2000);
                continue;
            }
            _setOffline(false);

            if (!check.player) {
                const hadPin = !!_getPin();
                localStorage.removeItem('ol_event_pin');
                const pin = await _promptGate('🔑 Event PIN',
                    hadPin ? 'Wrong PIN — try again.' : 'Enter the event PIN you got from the host.');
                localStorage.setItem('ol_event_pin', pin);
                continue;
            }
            if (_requireAdmin && !check.admin) {
                const hadCode = !!_getAdminCode();
                localStorage.removeItem('ol_admin_code');
                const code = await _promptGate('⚙️ Admin Code',
                    hadCode ? 'Wrong admin code — try again.' : 'Enter the admin code.');
                localStorage.setItem('ol_admin_code', code);
                continue;
            }
            break;
        }
    })().finally(() => { _authPromise = null; });
    return _authPromise;
}

// ── State fetch + polling ─────────────────────────────────────

async function _fetchState(force) {
    const url = '/api/state' + (!force && _stamp ? '?stamp=' + encodeURIComponent(_stamp) : '');
    const res = await fetch(url, { headers: _authHeaders() });
    if (res.status === 401) {
        await _ensureAuth();
        return _fetchState(force);
    }
    if (!res.ok) throw new Error('State fetch failed: ' + res.status);
    const json = await res.json();
    if (json.unchanged) return;
    _applyState(json);
}

async function _poll() {
    try {
        await _fetchState(false);
        _setOffline(false);
    } catch (err) {
        _setOffline(true);
    }
}

function _applyState(json) {
    const changed = json.stamp !== _stamp;
    _state = json;
    _stamp = json.stamp;
    if (changed) {
        _listeners.forEach(cb => {
            try { cb({ key: 'state', timestamp: Date.now() }); } catch (e) { console.error(e); }
        });
    }
}

function onDataChange(callback) {
    _listeners.push(callback);
}

// ── Mutations ─────────────────────────────────────────────────

async function _apiMutate(method, url, body, retried) {
    let res;
    try {
        res = await fetch(url, {
            method,
            headers: Object.assign({ 'Content-Type': 'application/json' }, _authHeaders()),
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch (err) {
        _setOffline(true);
        _notify('No connection — change not saved!', true);
        throw err;
    }
    _setOffline(false);

    if (res.status === 401 && !retried) {
        await _ensureAuth();
        return _apiMutate(method, url, body, true);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        _notify(json.error || 'Save failed', true);
        _fetchState(true).catch(() => {}); // resync cache after rejected optimistic update
        throw new Error(json.error || 'Save failed');
    }
    if (json.stamp) _applyState(json);
    return json;
}

// Collection setters (admin) — optimistic cache update, then sync
function setTeams(teams) {
    if (_state) _state.teams = teams;
    return _apiMutate('PUT', '/api/teams', { teams });
}

function setActivities(activities) {
    if (_state) _state.activities = activities;
    return _apiMutate('PUT', '/api/activities', { activities });
}

function setPreScores(preScores) {
    if (_state) _state.preScores = preScores;
    return _apiMutate('PUT', '/api/pre-scores', { preScores });
}

// Player actions
function apiSubmitScore(matchId, scoreA, scoreB) {
    if (_state) {
        const match = _state.schedule.find(m => m.matchId === matchId);
        if (match) {
            match.status = 'finished';
            match.scoreA = scoreA;
            match.scoreB = scoreB;
            match.timestamp = Date.now();
        }
    }
    return _apiMutate('POST', `/api/matches/${matchId}/score`, { scoreA, scoreB, deviceId: getDeviceId() });
}

function apiUndoMyScore() {
    return _apiMutate('POST', '/api/undo', { deviceId: getDeviceId() });
}

function apiAddRomanticObs(teamId, text) {
    return _apiMutate('POST', '/api/romantic', { teamId, text });
}

function apiRemoveRomanticObs(id) {
    if (_state) _state.romanticObs = _state.romanticObs.filter(o => o.id !== id);
    return _apiMutate('DELETE', `/api/romantic/${id}`);
}

// Admin actions
function apiGenerateSchedule(rounds) {
    return _apiMutate('POST', '/api/schedule/generate', { rounds });
}

function apiUpdateMatch(matchId, scoreA, scoreB) {
    return _apiMutate('PATCH', `/api/matches/${matchId}`, { scoreA, scoreB });
}

function apiDeleteMatch(matchId) {
    if (_state) _state.schedule = _state.schedule.filter(m => m.matchId !== matchId);
    return _apiMutate('DELETE', `/api/matches/${matchId}`);
}

function apiClearPendingMatches() {
    if (_state) _state.schedule = _state.schedule.filter(m =>
        m.round === 0 || m.preTournament || m.status === 'finished');
    return _apiMutate('DELETE', '/api/schedule/pending');
}

function apiReset() {
    return _apiMutate('POST', '/api/reset');
}

async function apiListTournaments() {
    const res = await fetch('/api/tournaments', { headers: _authHeaders() });
    if (!res.ok) throw new Error('Could not load tournaments');
    return res.json();
}

function apiCreateTournament(name) {
    return _apiMutate('POST', '/api/tournaments', { name });
}

function apiActivateTournament(id) {
    return _apiMutate('POST', `/api/tournaments/${id}/activate`);
}

function apiRenameTournament(id, name) {
    return _apiMutate('PATCH', `/api/tournaments/${id}`, { name });
}

function apiDeleteTournament(id) {
    return _apiMutate('DELETE', `/api/tournaments/${id}`);
}

// ── Export / Import ───────────────────────────────────────────

async function exportAllData() {
    const res = await fetch('/api/export', { headers: _authHeaders() });
    if (!res.ok) throw new Error('Export failed');
    return JSON.stringify(await res.json(), null, 2);
}

async function importAllData(jsonString) {
    const data = JSON.parse(jsonString);
    return _apiMutate('POST', '/api/import', data);
}

// ── Synchronous getters (from cache) ──────────────────────────

function getTeams() { return _state ? _state.teams : []; }
function getActivities() { return _state ? _state.activities : []; }
function getSchedule() { return _state ? _state.schedule : []; }
function getPreScores() { return _state ? _state.preScores : []; }
function getRomanticObs() { return _state ? _state.romanticObs : []; }
function getTournamentName() { return _state ? _state.tournamentName : ''; }

function getMyLastAction() {
    if (!_state || !_state.lastActions) return null;
    return _state.lastActions[getDeviceId()] || null;
}

function getTeamName(teamId) {
    const team = getTeams().find(t => t.id === teamId);
    return team ? team.name : 'Unknown';
}

function getActivityById(activityId) {
    return getActivities().find(a => a.id === activityId);
}

function getScheduledActivities() {
    return getActivities().filter(a => a.inSchedule !== false);
}

function getPreTournamentActivities() {
    return getActivities().filter(a => a.inSchedule === false);
}

// ── UI chrome: gate overlay + connection banner ───────────────

function _injectChrome() {
    if (document.getElementById('gate-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'gate-overlay';
    overlay.className = 'gate-overlay hidden';
    overlay.innerHTML = `
        <div class="gate-box">
            <h2 id="gate-title"></h2>
            <p id="gate-msg"></p>
            <input id="gate-input" type="password" autocomplete="off" placeholder="Code…">
            <button id="gate-btn" class="btn btn-primary btn-large">Enter →</button>
        </div>`;
    document.body.appendChild(overlay);

    const banner = document.createElement('div');
    banner.id = 'conn-banner';
    banner.className = 'conn-banner hidden';
    banner.textContent = '📡 Connection lost — reconnecting…';
    document.body.appendChild(banner);
}

function _promptGate(title, message) {
    return new Promise(resolve => {
        const overlay = document.getElementById('gate-overlay');
        const input = document.getElementById('gate-input');
        const btn = document.getElementById('gate-btn');
        document.getElementById('gate-title').textContent = title;
        document.getElementById('gate-msg').textContent = message;
        input.value = '';
        overlay.classList.remove('hidden');
        setTimeout(() => input.focus(), 50);

        const submit = () => {
            const value = input.value.trim();
            if (!value) return;
            overlay.classList.add('hidden');
            btn.removeEventListener('click', submit);
            input.removeEventListener('keydown', onKey);
            resolve(value);
        };
        const onKey = (e) => { if (e.key === 'Enter') submit(); };
        btn.addEventListener('click', submit);
        input.addEventListener('keydown', onKey);
    });
}

function _setOffline(offline) {
    if (offline === _offline) return;
    _offline = offline;
    const banner = document.getElementById('conn-banner');
    if (banner) banner.classList.toggle('hidden', !offline);
}

function _notify(message, isError) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'toast show' + (isError ? ' toast-error' : '');
    setTimeout(() => { toast.className = 'toast'; }, 3000);
}

function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
