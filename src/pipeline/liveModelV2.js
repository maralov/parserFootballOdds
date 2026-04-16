const engine = require('./liveModelEngine');

/**
 * Live-модель v2: без pre-match форми/H2H (лише live-стат і кф).
 * @param {object} input — той самий контракт, що й evaluateLiveModel у engine
 */
function evaluateLiveModelV2(input) {
  return engine.evaluateLiveModel(input, {
    applyPreMatchFormBias: false,
    modelArtifactVersion: '2.0.0',
    scoredVersion: 'v2',
  });
}

module.exports = {
  evaluateLiveModelV2,
  getLiveTimeWindow: engine.getLiveTimeWindow,
  drySignalsFromRaw: engine.drySignalsFromRaw,
  classifyState: engine.classifyState,
};
