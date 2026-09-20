/* ============================================================
   api.js — JSON API routes
   All mutation responses return the full tournament state so
   clients can update their cache immediately.
   ============================================================ */

const express = require('express');
const storage = require('./storage');
const { requirePlayer, requireAdmin, isPlayer, isAdmin } = require('./auth');
const { generateSchedule } = require('../public/js/schedule.js');

const router = express.Router();

function stateResponse(id, state) {
    return {
        stamp: id + ':' + state.version,
        tournamentId: id,
        tournamentName: state.name,
        version: state.version,
        teams: state.teams,
        activities: state.activities,
        schedule: state.schedule,
        preScores: state.preScores,
        romanticObs: state.romanticObs,
        lastActions: state.lastActions || {}
    };
}

function wrap(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

function fail(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

// ── Auth check ────────────────────────────────────────────────

router.get('/auth/check', (req, res) => {
    res.json({ player: isPlayer(req), admin: isAdmin(req) });
});

// ── State (polling) ───────────────────────────────────────────

router.get('/state', requirePlayer, wrap(async (req, res) => {
    const { id, state } = await storage.getActiveTournament();
    const stamp = id + ':' + state.version;
    if (req.query.stamp && req.query.stamp === stamp) {
        return res.json({ unchanged: true, stamp });
    }
    res.json(stateResponse(id, state));
}));

// ── Score submission (players) ────────────────────────────────

router.post('/matches/:matchId/score', requirePlayer, wrap(async (req, res) => {
    const matchId = parseInt(req.params.matchId, 10);
    const { scoreA, scoreB, deviceId } = req.body;
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) throw fail(400, 'Invalid scores');

    const { id, state } = await storage.mutateActive(state => {
        const match = state.schedule.find(m => m.matchId === matchId);
        if (!match) throw fail(404, 'Match not found');
        const act = state.activities.find(a => a.id === match.activityId);
        if (act && (scoreA < act.min || scoreA > act.max || scoreB < act.min || scoreB > act.max)) {
            throw fail(400, `Scores must be between ${act.min} and ${act.max}`);
        }
        // Enforce minimum winning score (e.g. Beerpong winner always has 4).
        // Admin PATCH /matches/:id is exempt so odd results can be corrected.
        if (act && act.scoreType === 'numeric' && act.minWinScore > 0 &&
            Math.max(scoreA, scoreB) < act.minWinScore) {
            throw fail(400, `Winning team must have at least ${act.minWinScore} points in ${act.name}`);
        }
        if (deviceId) {
            state.lastActions = state.lastActions || {};
            state.lastActions[deviceId] = {
                type: 'score_submit',
                matchId,
                applied: { scoreA, scoreB },
                previous: { status: match.status, scoreA: match.scoreA, scoreB: match.scoreB },
                timestamp: Date.now()
            };
        }
        match.status = 'finished';
        match.scoreA = scoreA;
        match.scoreB = scoreB;
        match.timestamp = Date.now();
        delete match.dispute; // direct submit overrides any pending change request
    });
    res.json(stateResponse(id, state));
}));

// ── Score change requests / disputes (players) ─────────────
// A team proposes a new score for a finished match it played in.
// The match is reset to pending (drops out of the leaderboard and
// reappears under Active games) until the OTHER team accepts or
// declines. Decline restores the original result.

router.post('/matches/:matchId/dispute', requirePlayer, wrap(async (req, res) => {
    const matchId = parseInt(req.params.matchId, 10);
    const { teamId, scoreA, scoreB } = req.body;
    if (!Number.isFinite(teamId)) throw fail(400, 'teamId required');
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) throw fail(400, 'Invalid scores');

    const { id, state } = await storage.mutateActive(state => {
        const match = state.schedule.find(m => m.matchId === matchId);
        if (!match) throw fail(404, 'Match not found');
        if (match.teamA !== teamId && match.teamB !== teamId) throw fail(403, 'Your team did not play this match');
        if (match.status !== 'finished') throw fail(400, 'Match has no result to change');
        if (match.dispute) throw fail(409, 'A change request is already pending for this match');
        const act = state.activities.find(a => a.id === match.activityId);
        if (act && (scoreA < act.min || scoreA > act.max || scoreB < act.min || scoreB > act.max)) {
            throw fail(400, `Scores must be between ${act.min} and ${act.max}`);
        }
        if (act && act.scoreType === 'numeric' && act.minWinScore > 0 &&
            Math.max(scoreA, scoreB) < act.minWinScore) {
            throw fail(400, `Winning team must have at least ${act.minWinScore} points in ${act.name}`);
        }
        match.dispute = {
            requestedBy: teamId,
            proposedScoreA: scoreA,
            proposedScoreB: scoreB,
            original: { scoreA: match.scoreA, scoreB: match.scoreB, timestamp: match.timestamp },
            requestedAt: Date.now()
        };
        match.status = 'pending';
        match.scoreA = null;
        match.scoreB = null;
    });
    res.json(stateResponse(id, state));
}));

router.post('/matches/:matchId/dispute/resolve', requirePlayer, wrap(async (req, res) => {
    const matchId = parseInt(req.params.matchId, 10);
    const { teamId, accept } = req.body;
    if (!Number.isFinite(teamId)) throw fail(400, 'teamId required');

    const { id, state } = await storage.mutateActive(state => {
        const match = state.schedule.find(m => m.matchId === matchId);
        if (!match) throw fail(404, 'Match not found');
        if (!match.dispute) throw fail(404, 'No pending change request for this match');
        if (match.teamA !== teamId && match.teamB !== teamId) throw fail(403, 'Your team did not play this match');
        if (match.dispute.requestedBy === teamId) throw fail(403, 'The other team must accept or decline');

        if (accept) {
            match.scoreA = match.dispute.proposedScoreA;
            match.scoreB = match.dispute.proposedScoreB;
            match.timestamp = Date.now();
        } else {
            match.scoreA = match.dispute.original.scoreA;
            match.scoreB = match.dispute.original.scoreB;
            match.timestamp = match.dispute.original.timestamp;
        }
        match.status = 'finished';
        delete match.dispute;
    });
    res.json(stateResponse(id, state));
}));

// ── Per-device undo (players) ─────────────────────────────────

router.post('/undo', requirePlayer, wrap(async (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) throw fail(400, 'deviceId required');

    const { id, state } = await storage.mutateActive(state => {
        const action = (state.lastActions || {})[deviceId];
        if (!action || action.type !== 'score_submit') throw fail(404, 'Nothing to undo');
        const match = state.schedule.find(m => m.matchId === action.matchId);
        if (!match) throw fail(404, 'Match not found');
        if (match.scoreA !== action.applied.scoreA || match.scoreB !== action.applied.scoreB) {
            delete state.lastActions[deviceId];
            throw fail(409, 'Score was changed by someone else — cannot undo');
        }
        match.status = action.previous.status;
        match.scoreA = action.previous.scoreA;
        match.scoreB = action.previous.scoreB;
        delete state.lastActions[deviceId];
    });
    res.json(stateResponse(id, state));
}));

// ── Romantic observations (players) ───────────────────────────

router.post('/romantic', requirePlayer, wrap(async (req, res) => {
    const { teamId, text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) throw fail(400, 'Text required');
    if (!Number.isFinite(teamId)) throw fail(400, 'teamId required');

    const { id, state } = await storage.mutateActive(state => {
        if (!state.teams.some(t => t.id === teamId)) throw fail(404, 'Team not found');
        const nextId = state.romanticObs.length > 0 ? Math.max(...state.romanticObs.map(o => o.id)) + 1 : 1;
        state.romanticObs.push({ id: nextId, teamId, text: text.trim().slice(0, 100), timestamp: Date.now() });
    });
    res.json(stateResponse(id, state));
}));

router.delete('/romantic/:id', requirePlayer, wrap(async (req, res) => {
    const obsId = parseInt(req.params.id, 10);
    const { id, state } = await storage.mutateActive(state => {
        state.romanticObs = state.romanticObs.filter(o => o.id !== obsId);
    });
    res.json(stateResponse(id, state));
}));

// ── Admin: collections ────────────────────────────────────────

router.put('/teams', requireAdmin, wrap(async (req, res) => {
    const teams = req.body.teams;
    if (!Array.isArray(teams) || teams.some(t => !Number.isFinite(t.id) || typeof t.name !== 'string')) {
        throw fail(400, 'Invalid teams');
    }
    const { id, state } = await storage.mutateActive(state => {
        state.teams = teams.map(t => ({ id: t.id, name: t.name.trim().slice(0, 30) }));
    });
    res.json(stateResponse(id, state));
}));

router.put('/activities', requireAdmin, wrap(async (req, res) => {
    const activities = req.body.activities;
    if (!Array.isArray(activities) || activities.some(a => !a.id || typeof a.name !== 'string')) {
        throw fail(400, 'Invalid activities');
    }
    const { id, state } = await storage.mutateActive(state => {
        state.activities = activities;
    });
    res.json(stateResponse(id, state));
}));

router.put('/pre-scores', requireAdmin, wrap(async (req, res) => {
    const preScores = req.body.preScores;
    if (!Array.isArray(preScores)) throw fail(400, 'Invalid preScores');
    const { id, state } = await storage.mutateActive(state => {
        state.preScores = preScores;
    });
    res.json(stateResponse(id, state));
}));

// ── Admin: schedule ───────────────────────────────────────────

/* ⚠️⚠️ CRITICAL — MID-TOURNAMENT SCHEDULE EXTENSION ⚠️⚠️
   Regenerating the schedule with more rounds MUST NOT reset scores of
   already-finished matches. Because generateSchedule() is deterministic
   (see warning in public/js/schedule.js), regenerating with the same
   teams/activities/weights reproduces the earlier rounds identically, and
   the carry-over below copies finished results onto the new schedule.
   Finished matches that no longer fit the new schedule (e.g. teams or
   activities changed) are NEVER discarded — they are appended as-is.
   Do not change this behaviour without testing mid-tournament extension. */
router.post('/schedule/generate', requireAdmin, wrap(async (req, res) => {
    const rounds = parseInt(req.body.rounds, 10) || 0;
    const { id, state } = await storage.mutateActive(state => {
        const scheduledActivities = state.activities.filter(a => a.inSchedule !== false);
        if (state.teams.length < 2) throw fail(400, 'Add at least 2 teams first');
        if (scheduledActivities.length === 0) throw fail(400, 'No activities marked "In Schedule"');

        const preMatches = state.schedule.filter(m => m.round === 0 || m.preTournament);
        // Preserve finished results AND matches with a pending change request
        // (disputes hold the original score — losing them would destroy data)
        const finished = state.schedule.filter(m =>
            !(m.round === 0 || m.preTournament) && (m.status === 'finished' || m.dispute));
        const newMatches = generateSchedule(state.teams, scheduledActivities, rounds);

        // Carry finished results over onto the regenerated schedule
        const leftovers = [];
        for (const old of finished) {
            const target = newMatches.find(m => m.status === 'pending' && !m.dispute &&
                m.round === old.round && m.activityId === old.activityId &&
                ((m.teamA === old.teamA && m.teamB === old.teamB) ||
                 (m.teamA === old.teamB && m.teamB === old.teamA)));
            if (target) {
                const swapped = target.teamA !== old.teamA;
                target.status = old.status;
                target.scoreA = swapped ? old.scoreB : old.scoreA;
                target.scoreB = swapped ? old.scoreA : old.scoreB;
                target.timestamp = old.timestamp;
                if (old.dispute) target.dispute = old.dispute;
            } else {
                leftovers.push(old); // no matching slot — keep the result anyway
            }
        }

        const maxPreId = preMatches.length > 0 ? Math.max(...preMatches.map(m => m.matchId)) : 0;
        newMatches.forEach((m, i) => { m.matchId = maxPreId + 1 + i; });
        let nextId = maxPreId + newMatches.length + 1;
        leftovers.forEach(m => { m.matchId = nextId++; });

        state.schedule = [...preMatches, ...newMatches, ...leftovers];
        state.lastActions = {};
    });
    res.json(stateResponse(id, state));
}));

router.patch('/matches/:matchId', requireAdmin, wrap(async (req, res) => {
    const matchId = parseInt(req.params.matchId, 10);
    const { scoreA, scoreB } = req.body;
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) throw fail(400, 'Invalid scores');

    const { id, state } = await storage.mutateActive(state => {
        const match = state.schedule.find(m => m.matchId === matchId);
        if (!match) throw fail(404, 'Match not found');
        match.status = 'finished';
        match.scoreA = scoreA;
        match.scoreB = scoreB;
        if (!match.timestamp) match.timestamp = Date.now();
        delete match.dispute; // admin edit overrides any pending change request
    });
    res.json(stateResponse(id, state));
}));

router.delete('/schedule/pending', requireAdmin, wrap(async (req, res) => {
    const { id, state } = await storage.mutateActive(state => {
        state.schedule = state.schedule.filter(m =>
            m.round === 0 || m.preTournament || m.status === 'finished' || m.dispute);
    });
    res.json(stateResponse(id, state));
}));

router.delete('/matches/:matchId', requireAdmin, wrap(async (req, res) => {
    const matchId = parseInt(req.params.matchId, 10);
    const { id, state } = await storage.mutateActive(state => {
        state.schedule = state.schedule.filter(m => m.matchId !== matchId);
    });
    res.json(stateResponse(id, state));
}));

// ── Admin: tournaments ────────────────────────────────────────

router.get('/tournaments', requireAdmin, wrap(async (req, res) => {
    const index = await storage.getIndex();
    res.json(index);
}));

router.post('/tournaments', requireAdmin, wrap(async (req, res) => {
    const name = (req.body.name || '').trim().slice(0, 50);
    if (!name) throw fail(400, 'Name required');
    const newId = await storage.createTournament(name);
    res.json({ id: newId, index: await storage.getIndex() });
}));

router.post('/tournaments/:id/activate', requireAdmin, wrap(async (req, res) => {
    await storage.activateTournament(req.params.id);
    const { id, state } = await storage.getActiveTournament();
    res.json(stateResponse(id, state));
}));

router.patch('/tournaments/:id', requireAdmin, wrap(async (req, res) => {
    const name = (req.body.name || '').trim().slice(0, 50);
    if (!name) throw fail(400, 'Name required');
    await storage.renameTournament(req.params.id, name);
    res.json({ index: await storage.getIndex() });
}));

router.delete('/tournaments/:id', requireAdmin, wrap(async (req, res) => {
    await storage.deleteTournament(req.params.id);
    res.json({ index: await storage.getIndex() });
}));

// ── Admin: data management ────────────────────────────────────

router.get('/export', requireAdmin, wrap(async (req, res) => {
    const { state } = await storage.getActiveTournament();
    res.json({
        teams: state.teams,
        activities: state.activities,
        schedule: state.schedule,
        preScores: state.preScores,
        romanticObs: state.romanticObs,
        exportedAt: new Date().toISOString()
    });
}));

router.post('/import', requireAdmin, wrap(async (req, res) => {
    const data = req.body;
    if (!data || typeof data !== 'object') throw fail(400, 'Invalid import data');
    const { id, state } = await storage.mutateActive(state => {
        if (Array.isArray(data.teams)) state.teams = data.teams;
        if (Array.isArray(data.activities)) state.activities = data.activities;
        if (Array.isArray(data.schedule)) state.schedule = data.schedule;
        if (Array.isArray(data.preScores)) state.preScores = data.preScores;
        if (Array.isArray(data.romanticObs)) state.romanticObs = data.romanticObs;
        state.lastActions = {};
    });
    res.json(stateResponse(id, state));
}));

router.post('/reset', requireAdmin, wrap(async (req, res) => {
    const { id, state } = await storage.mutateActive(state => {
        state.teams = [];
        state.activities = storage.getDefaultActivities();
        state.schedule = [];
        state.preScores = [];
        state.romanticObs = [];
        state.lastActions = {};
    });
    res.json(stateResponse(id, state));
}));

// ── Errors ────────────────────────────────────────────────────

router.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error' });
});

module.exports = router;
