const { LIVE_BASE_URL } = require('./helpers/constants');
const { collectLiveMatches } = require('./providers/flashscoreMobileUa/liveSource');

async function scrapeLiveMatches(page) {
  try {
    console.log('Opening:', LIVE_BASE_URL);
    const { matches, health } = await collectLiveMatches(page, LIVE_BASE_URL);
    console.log(
      `Provider health: rows=${health.totalRows}, missingId=${health.missingId}, missingMinute=${health.missingMinute}, missingUrl=${health.missingUrl}`
    );

    const badRows = health.missingId + health.missingMinute + health.missingUrl;
    if (health.totalRows > 0 && badRows / health.totalRows > 0.4) {
      console.log('⚠️ Live provider quality is low; parser fallback likely needed');
    }

    return matches;
  } catch (e) {
    console.log('LIVE MATCHES ERROR:', e.message);
    return [];
  }
}

module.exports = scrapeLiveMatches;
