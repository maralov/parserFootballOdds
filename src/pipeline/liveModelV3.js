const engine = require('./liveModelEngine');

/**
 * Live-модель v3: v2 + pre-match bias з форми команд та очних (60–70).
 * @param {object} input — як у v2; опційно `preMatchContext` з scrapeMatchFormAndH2h
 */
function evaluateLiveModelV3(input) {
  return engine.evaluateLiveModel(input, {
    applyPreMatchFormBias: true,
    modelArtifactVersion: '3.0.0',
    scoredVersion: 'v3',
  });
}

module.exports = {
  evaluateLiveModelV3,
  getLiveTimeWindow: engine.getLiveTimeWindow,
  drySignalsFromRaw: engine.drySignalsFromRaw,
  classifyState: engine.classifyState,
};
