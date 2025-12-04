// src/helpers/predictLateGoal.js

function getIntensityZone(stats = {}) {
    const xg = stats.expectedGoalsXg || 0;
    const sOT = stats.shotsOnTarget || 0;
    const touches = stats.touchesInOppositionBox || 0;

    // Zone 1 – dead match
    if (xg <= 0.5 && sOT <= 3 && touches <= 18) return 1;

    // Zone 4 – ultra high intensity
    if (xg >= 2 && sOT >= 8 && touches >= 20) return 4;

    // Zone 2 – high intensity
    if (xg >= 1.3 && sOT >= 6 && touches >= 18) return 2;

    // Zone 3 – moderate
    if (
        xg > 0.5 && xg < 1.3 &&
        sOT > 3 && sOT < 6 &&
        touches >= 12 && touches <= 20
    ) {
        return 3;
    }

    // Zone 0 – undefined
    return 0;
}


export function predictLateGoal(stats) {
    const zone = getIntensityZone(stats);

    // Zone 4 → MUST BET OVER
    if (zone === 4) {
        return {
            bet: "OVER_0_5",
            confidence: "max",
            zone,
            reason: "Ultra-high intensity (Zone 4). Historical PLate=1.00",
        };
    }

    // Zone 2 → STRONG BET OVER
    if (zone === 2) {
        return {
            bet: "OVER_0_5",
            confidence: "strong",
            zone,
            reason: "High intensity (Zone 2). Historical PLate≈0.90",
        };
    }

    // Zone 1 → STRONG BET UNDER
    if (zone === 1) {
        return {
            bet: "UNDER_0_5",
            confidence: "strong",
            zone,
            reason: "Low intensity (Zone 1). PLate≈0.14",
        };
    }

    // Zone 3 → 50/50 → SKIP
    if (zone === 3) {
        return {
            bet: "SKIP",
            confidence: "medium",
            zone,
            reason: "Mixed intensity (Zone 3). PLate≈0.55",
        };
    }

    // Zone 0 → UNDEFINED
    return {
        bet: "SKIP",
        confidence: "low",
        zone,
        reason: "Zone 0 (undefined or noisy stats)",
    };
}

module.exports = {
    predictLateGoal,
    getIntensityZone,
};
