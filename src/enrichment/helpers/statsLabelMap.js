'use strict';

/**
 * Maps flashscore stat label text (lowercased, trimmed) → camelCase key.
 * Labels come from SG field of the feed string or DOM category text.
 */
const LABEL_MAP = {
  // Possession
  'ball possession':             'ballPossession',

  // Shots
  'total shots':                 'totalShots',
  'shots on target':             'shotsOnTarget',
  'shots off target':            'shotsOffTarget',
  'blocked shots':               'blockedShots',
  'shots inside the box':        'shotsInsideTheBox',
  'shots outside the box':       'shotsOutsideTheBox',
  'hit the woodwork':            'hitTheWoodwork',

  // xG
  'expected goals (xg)':         'expectedGoalsXg',
  'xg on target (xgot)':         'xgOnTargetXgot',

  // Attack
  'big chances':                 'bigChances',
  'corner kicks':                'cornerKicks',
  'touches in opposition box':   'touchesInOppositionBox',
  'touches in opp. box':         'touchesInOppositionBox',
  'offsides':                    'offsides',
  'headed goals':                'headedGoals',

  // Passes
  'passes':                      'passes',
  'long passes':                 'longPasses',
  'passes in final third':       'passesInFinalThird',
  'crosses':                     'crosses',
  'throw-ins':                   'throwIns',
  'throw ins':                   'throwIns',
  'expected assists (xa)':       'expectedAssistsXa',
  'accurate through passes':     'accurateThroughPasses',

  // Defense
  'fouls':                       'fouls',
  'free kicks':                  'freeKicks',
  'tackles':                     'tackles',
  'duels won':                   'duelsWon',
  'clearances':                  'clearances',
  'interceptions':               'interceptions',
  'errors leading to shot':      'errorsLeadingToShot',
  'errors leading to goal':      'errorsLeadingToGoal',

  // Goalkeeping
  'goalkeeper saves':            'goalkeeperSaves',
  'xgot faced':                  'xgotFaced',
  'goals prevented':             'goalsPrevented',

  // Cards
  'yellow cards':                'yellowCards',
  'red cards':                   'redCards',
};

/**
 * Map a flashscore stat label to its camelCase key.
 * Returns null if unmapped (field will be ignored).
 */
function mapStatsLabel(label) {
  if (!label) return null;
  return LABEL_MAP[label.trim().toLowerCase()] || null;
}

module.exports = { mapStatsLabel, LABEL_MAP };
