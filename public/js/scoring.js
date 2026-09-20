/* ============================================================
   scoring.js — Points calculation + leaderboard
   ============================================================ */

/**
 * Calculate the points both teams earn from a single finished match.
 *
 * Numeric activities:
 *   teamPts = basePoints(win/draw/loss) + rawScore × marginMultiplier
 *
 * Win/lose activities:
 *   winner: winPoints + fixedBonus
 *   loser:  lossPoints + 0
 */
function calculateMatchPoints(match, activity) {
    if (match.status !== 'finished' || match.scoreA === null || match.scoreB === null) {
        return { teamA: 0, teamB: 0, resultA: null, resultB: null };
    }

    const sA = match.scoreA;
    const sB = match.scoreB;
    let ptsA = 0;
    let ptsB = 0;
    let resultA, resultB;

    // Determine win / draw / loss
    if (sA > sB)      { resultA = 'win';  resultB = 'loss'; }
    else if (sA < sB) { resultA = 'loss'; resultB = 'win';  }
    else               { resultA = 'draw'; resultB = 'draw'; }

    // Base points
    ptsA += resultA === 'win' ? activity.winPoints
          : resultA === 'draw' ? activity.drawPoints
          : activity.lossPoints;

    ptsB += resultB === 'win' ? activity.winPoints
          : resultB === 'draw' ? activity.drawPoints
          : activity.lossPoints;

    // Bonus points
    if (activity.scoreType === 'numeric') {
        ptsA += sA * activity.marginMultiplier;
        ptsB += sB * activity.marginMultiplier;
    } else if (activity.scoreType === 'winlose') {
        if (resultA === 'win') ptsA += activity.fixedBonus;
        if (resultB === 'win') ptsB += activity.fixedBonus;
    }

    return { teamA: ptsA, teamB: ptsB, resultA, resultB };
}

/**
 * Build sorted leaderboard from all finished matches.
 * Sort: wins DESC, then totalPoints DESC.
 */
function calculateLeaderboard(teams, schedule, activities) {
    const actMap = {};
    activities.forEach(a => { actMap[a.id] = a; });

    // Initialise per-team stats
    const stats = {};
    teams.forEach(t => {
        stats[t.id] = {
            teamId:      t.id,
            teamName:    t.name,
            wins:        0,
            losses:      0,
            draws:       0,
            totalPoints: 0,
            gamesPlayed: 0
        };
    });

    // Accumulate from matches
    schedule.forEach(match => {
        if (match.status !== 'finished') return;
        const activity = actMap[match.activityId];
        if (!activity) return;

        const pts = calculateMatchPoints(match, activity);

        const sA = stats[match.teamA];
        const sB = stats[match.teamB];

        if (sA) {
            sA.totalPoints += pts.teamA;
            sA.gamesPlayed++;
            if (pts.resultA === 'win')  sA.wins++;
            if (pts.resultA === 'loss') sA.losses++;
            if (pts.resultA === 'draw') sA.draws++;
        }
        if (sB) {
            sB.totalPoints += pts.teamB;
            sB.gamesPlayed++;
            if (pts.resultB === 'win')  sB.wins++;
            if (pts.resultB === 'loss') sB.losses++;
            if (pts.resultB === 'draw') sB.draws++;
        }
    });

    // Accumulate pre-tournament individual scores (result-based)
    const preScores = getPreScores();
    preScores.forEach(entry => {
        const s = stats[entry.teamId];
        if (!s) return;
        if (entry.result === 'win')  { s.totalPoints += 3; s.wins++; }
        if (entry.result === 'draw') { s.totalPoints += 2; s.draws++; }
        // lose = 0 pts, but count the loss
        if (entry.result === 'lose') { s.losses++; }
    });

    // Accumulate romantic observations (1 win each, no points)
    const romanticObs = getRomanticObs();
    romanticObs.forEach(entry => {
        const s = stats[entry.teamId];
        if (s) {
            s.wins += 1;
        }
    });

    // Sort: (wins - losses) first, then points as tiebreaker
    return Object.values(stats).sort((a, b) => {
        const netA = a.wins - a.losses;
        const netB = b.wins - b.losses;
        if (netB !== netA) return netB - netA;
        return b.totalPoints - a.totalPoints;
    });
}

/**
 * Win-rate as a percentage string based on total W+D+L.
 * Returns "–" if no results recorded.
 */
function getWinRate(stat) {
    const total = stat.wins + stat.draws + stat.losses;
    if (total === 0) return '–';
    return Math.round((stat.wins / total) * 100) + '%';
}

/**
 * Find a team's next pending match (earliest in schedule order).
 * Matches awaiting a score-change decision are not playable.
 */
function getNextMatch(teamId, schedule) {
    return schedule.find(m =>
        m.status === 'pending' && !m.dispute && (m.teamA === teamId || m.teamB === teamId)
    );
}

/**
 * Get recently finished matches, newest first.
 */
function getRecentResults(schedule, limit) {
    return schedule
        .filter(m => m.status === 'finished')
        .reverse()
        .slice(0, limit || 5);
}

/**
 * Get all currently pending matches.
 */
function getPendingMatches(schedule) {
    return schedule.filter(m => m.status === 'pending');
}
