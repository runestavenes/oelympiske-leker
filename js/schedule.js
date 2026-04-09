/* ============================================================
   schedule.js — Round-robin schedule generator (circle method)
   ============================================================ */

/**
 * Generate a full round-robin schedule.
 * Uses the "circle method": fix one team, rotate the rest.
 * Greedy balanced activity assignment distributes activities evenly.
 *
 * With 10 teams: 9 rounds × 5 matches = 45 total matches.
 * With 6 activities: each round uses 5 of 6 (one sits out, rotating).
 *
 * @param {Array} teams      — array of { id, name }
 * @param {Array} activities — array of activity configs
 * @returns {Array} schedule — array of match objects
 */
function generateSchedule(teams, activities, maxRounds) {
    const n = teams.length;
    if (n < 2 || activities.length === 0) return [];

    const teamIds = teams.map(t => t.id);
    const fixed   = teamIds[0];
    const rotating = teamIds.slice(1);

    // If odd number of teams, add a "bye" placeholder
    const isOdd = n % 2 !== 0;
    if (isOdd) {
        rotating.push(-1); // -1 = bye
    }

    const totalPerRound = Math.floor((isOdd ? n + 1 : n) / 2);
    const fullRounds = isOdd ? n : n - 1;
    const rounds = (maxRounds && maxRounds > 0 && maxRounds < fullRounds) ? maxRounds : fullRounds;

    // Phase 1: Generate all round pairings
    const allRoundPairs = [];

    for (let r = 0; r < rounds; r++) {
        const roundPairs = [];

        if (rotating[0] !== -1) {
            roundPairs.push({ teamA: fixed, teamB: rotating[0] });
        }

        for (let i = 1; i < totalPerRound; i++) {
            const a = rotating[i];
            const b = rotating[rotating.length - i];
            if (a !== -1 && b !== -1) {
                roundPairs.push({ teamA: a, teamB: b });
            }
        }

        allRoundPairs.push(roundPairs);
        rotating.push(rotating.shift());
    }

    // Phase 2: Greedy balanced activity assignment
    // For each round, assign activities to match slots so every team
    // plays each activity roughly the same number of times.
    const teamActCount = {};
    teams.forEach(t => {
        teamActCount[t.id] = {};
        activities.forEach(a => { teamActCount[t.id][a.id] = 0; });
    });

    const schedule = [];
    let matchId = 1;

    for (let r = 0; r < allRoundPairs.length; r++) {
        const pairs = allRoundPairs[r];
        const available = activities.map((_, i) => i);
        const assignment = new Array(pairs.length).fill(null);

        // Greedy: pick the (pair, activity) combo with the lowest
        // weighted count so far.  Lower-weight activities accumulate
        // a penalty faster, so the greedy picker avoids them.
        for (let step = 0; step < pairs.length; step++) {
            let bestScore = Infinity;
            let bestPair  = -1;
            let bestAct   = -1;

            for (let pi = 0; pi < pairs.length; pi++) {
                if (assignment[pi] !== null) continue;
                const tA = pairs[pi].teamA;
                const tB = pairs[pi].teamB;

                for (const ai of available) {
                    const act = activities[ai];
                    const aid = act.id;
                    const w = act.weight != null ? act.weight : 1;
                    // Divide raw count by weight so low-weight activities
                    // look "more used" and get picked less often.
                    const rawA = teamActCount[tA] ? teamActCount[tA][aid] : 0;
                    const rawB = teamActCount[tB] ? teamActCount[tB][aid] : 0;
                    const score = (rawA + rawB) / w;
                    if (score < bestScore) {
                        bestScore = score;
                        bestPair  = pi;
                        bestAct   = ai;
                    }
                }
            }

            assignment[bestPair] = bestAct;
            available.splice(available.indexOf(bestAct), 1);

            const tA = pairs[bestPair].teamA;
            const tB = pairs[bestPair].teamB;
            const aid = activities[bestAct].id;
            if (teamActCount[tA]) teamActCount[tA][aid]++;
            if (teamActCount[tB]) teamActCount[tB][aid]++;
        }

        for (let pi = 0; pi < pairs.length; pi++) {
            schedule.push({
                matchId:    matchId++,
                round:      r + 1,
                activityId: activities[assignment[pi]].id,
                teamA:      pairs[pi].teamA,
                teamB:      pairs[pi].teamB,
                status:     'pending',
                scoreA:     null,
                scoreB:     null
            });
        }
    }

    return schedule;
}

/**
 * Quick validation: log activity distribution per team (debug helper).
 */
function validateSchedule(schedule, teams, activities) {
    const stats = {};
    teams.forEach(t => {
        stats[t.id] = { games: 0, activities: {} };
        activities.forEach(a => { stats[t.id].activities[a.id] = 0; });
    });

    schedule.forEach(m => {
        [m.teamA, m.teamB].forEach(tid => {
            if (stats[tid]) {
                stats[tid].games++;
                stats[tid].activities[m.activityId]++;
            }
        });
    });

    return stats;
}
