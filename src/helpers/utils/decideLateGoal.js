// stats = stats2h з твоєї моделі (сума по обом командам)
function decideLateGoal(stats) {
    const xg = stats.expectedGoalsXg || 0;
    const shotsOnTarget = stats.shotsOnTarget || 0;
    const touchesInOppBox = stats.touchesInOppositionBox || 0;

    const signals = {
        underStrong:
            xg <= 0.5 &&
            shotsOnTarget <= 3 &&
            touchesInOppBox <= 18,

        overStrong:
            xg >= 1.3 &&
            shotsOnTarget >= 6 &&
            touchesInOppBox >= 18,

        // базові (більш мʼякі) сигнали, якщо захочеш розширити стратегію:
        underBase: xg <= 0.6,
        overBase: xg >= 1.5 && shotsOnTarget >= 5,
    };

    // Пріоритет: спочатку сильні сигнали
    if (signals.underStrong && !signals.overStrong) {
        return {
            bet: "UNDER_0_5",
            strength: "strong",
            reason: {
                xg,
                shotsOnTarget,
                touchesInOppBox,
                rule: "xg<=0.5 & shotsOnTarget<=3 & touches<=18",
            },
        };
    }

    if (signals.overStrong && !signals.underStrong) {
        return {
            bet: "OVER_0_5",
            strength: "strong",
            reason: {
                xg,
                shotsOnTarget,
                touchesInOppBox,
                rule: "xg>=1.3 & shotsOnTarget>=6 & touches>=18",
            },
        };
    }

    // Якщо хочеш використовувати більш мʼякі сигнали:
    if (signals.underBase && !signals.overBase) {
        return {
            bet: "UNDER_0_5",
            strength: "medium",
            reason: {
                xg,
                shotsOnTarget,
                touchesInOppBox,
                rule: "xg<=0.6",
            },
        };
    }

    if (signals.overBase && !signals.underBase) {
        return {
            bet: "OVER_0_5",
            strength: "medium",
            reason: {
                xg,
                shotsOnTarget,
                touchesInOppBox,
                rule: "xg>=1.5 & shotsOnTarget>=5",
            },
        };
    }

    // Якщо немає чіткого edge – пропускаємо матч
    return {
        bet: "SKIP",
        strength: "none",
        reason: {
            xg,
            shotsOnTarget,
            touchesInOppBox,
            rule: "no strong signal",
        },
    };
}

module.exports = {decideLateGoal};
