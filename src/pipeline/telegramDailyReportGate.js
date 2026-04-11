const fs = require('fs');
const path = require('path');

const GATE_FILE = path.join(__dirname, '..', '..', 'data', 'logs', 'telegram_daily_report_gate.json');

function readGate() {
  try {
    const raw = fs.readFileSync(GATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Чи вже надсилали в Telegram звіт саме за цю дату (summary.date = день логів). */
function wasDailyReportTelegramSent(summaryDate) {
  if (!summaryDate) return true;
  const g = readGate();
  return g?.lastSummaryDate === summaryDate;
}

function markDailyReportTelegramSent(summaryDate) {
  if (!summaryDate) return;
  const dir = path.dirname(GATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    GATE_FILE,
    JSON.stringify(
      { lastSummaryDate: summaryDate, sentAt: new Date().toISOString() },
      null,
      2
    ),
    'utf8'
  );
}

module.exports = { wasDailyReportTelegramSent, markDailyReportTelegramSent, GATE_FILE };
