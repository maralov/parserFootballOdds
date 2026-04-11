const fs = require('fs');
const path = require('path');

const ANALYZED_DIR = path.join(__dirname, '..', '..', '..', 'data', 'historical', 'analyzed');

function loadAllMatches(dir) {
  const srcDir = dir || ANALYZED_DIR;
  if (!fs.existsSync(srcDir)) {
    return { matches: [], dateRange: { from: null, to: null }, totalFiles: 0 };
  }

  const files = fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  const allMatches = [];
  let from = null;
  let to = null;

  for (const file of files) {
    const fp = path.join(srcDir, file);
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));

    const matches = Array.isArray(raw) ? raw : (raw.matches || []);
    const date = raw.meta?.date || file.replace('.json', '');

    if (!from || date < from) from = date;
    if (!to || date > to) to = date;

    for (const m of matches) {
      if (m.pipeline && m.pipeline !== 'analyzed') continue;
      allMatches.push(m);
    }
  }

  return {
    matches: allMatches,
    dateRange: { from, to },
    totalFiles: files.length,
  };
}

module.exports = { loadAllMatches, ANALYZED_DIR };
