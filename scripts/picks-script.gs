// NWSL Fantasy Picks — Google Apps Script
// Deploy as Web App: Execute as Me, Anyone can access
//
// POST ?action=submit  — submit/update picks for a player
// GET  ?action=picks&week=N — return all picks for week N as JSON
// GET  ?action=allPicks — return picks for every week as { "N": [...] }

const SPREADSHEET_ID = '1oZCW1_eE2sBVyG9HgApT6EF4NTXfx5FiICsayko6xJI';
const PLAYERS_TAB = 'Players';
const SCHEDULE_CSV_URL = 'https://docs.google.com/spreadsheets/d/1x6eyrqwe64kLfzvKfkP6x1mAOHQTnA9SA4WQMacHdFY/export?format=csv&gid=0';
const RESULTS_JSON_URL = 'https://nwslfan.github.io/results.json'; // ESPN kickoff times (refreshed daily by GitHub Actions)

const HEADERS = ['Timestamp', 'Team Name', 'Team Name/Nickname', 'Full Name', 'Email'];
const BONUS_HEADER = 'BONUS: Total goals scored this week';

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'picks') {
    const week = parseInt(e.parameter.week);
    return jsonResponse(getPicks(week));
  }
  if (action === 'allPicks') {
    return jsonResponse(getAllPicks());
  }
  return jsonResponse({ error: 'Unknown action' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || 'submit';
    if (action === 'submit') {
      submitPicks(body);
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── Submit picks ──────────────────────────────────────────────────

function submitPicks(body) {
  const { week, teamName, nickname, fullName, email, picks, bonus } = body;
  // picks = { "Team A vs Team B": "Team A", ... }

  // Per-game lockout: each game locks 2 hours before kickoff. Drop picks
  // for locked games; reject only if every game in the week has locked.
  // The bonus locks with the week's first game.
  const lockInfo = getGameLocks(week);
  const now = new Date();
  let submittedPicks = picks || {};
  let bonusVal = bonus;
  if (lockInfo) {
    const cols = Object.keys(lockInfo.locks);
    if (cols.length > 0 && cols.every(col => now >= lockInfo.locks[col])) {
      throw new Error(`Picks for Week ${week} are closed — every game has locked (picks lock 2 hours before kickoff).`);
    }
    const filtered = {};
    Object.keys(submittedPicks).forEach(col => {
      if (!(lockInfo.locks[col] && now >= lockInfo.locks[col])) filtered[col] = submittedPicks[col];
    });
    submittedPicks = filtered;
    if (lockInfo.firstLock && now >= lockInfo.firstLock) bonusVal = undefined;
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tabName = `Week ${week}`;

  // Build ordered game columns from submitted picks
  const gameCols = Object.keys(submittedPicks);

  // Ensure week tab exists with correct headers
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    const headers = [...HEADERS, ...gameCols, BONUS_HEADER];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    // Add any new game columns not yet in headers
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    gameCols.forEach(col => {
      if (!existingHeaders.includes(col)) {
        const nextCol = sheet.getLastColumn() + 1;
        // Insert before bonus column if it exists, otherwise append
        const bonusIdx = existingHeaders.indexOf(BONUS_HEADER);
        const insertAt = bonusIdx >= 0 ? bonusIdx + 1 : nextCol;
        sheet.insertColumnBefore(insertAt);
        sheet.getRange(1, insertAt).setValue(col);
        existingHeaders.splice(bonusIdx >= 0 ? bonusIdx : existingHeaders.length, 0, col);
      }
    });
  }

  // Get current headers (may have been updated)
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Determine player identity (team name or nickname for new players)
  const playerKey = (teamName && !/^i'?m new$/i.test(teamName)) ? teamName : (nickname || fullName || email || 'Unknown');

  // Find existing row for this player (by team name column)
  const teamNameColIdx = headers.indexOf('Team Name');
  const nickColIdx = headers.indexOf('Team Name/Nickname');
  let existingRow = -1;
  if (sheet.getLastRow() > 1) {
    const teamNames = sheet.getRange(2, teamNameColIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
    const nicks = sheet.getRange(2, nickColIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat();
    for (let i = 0; i < teamNames.length; i++) {
      if (teamNames[i] === playerKey || nicks[i] === playerKey) {
        existingRow = i + 2;
        break;
      }
    }
  }

  // Build row values in header order, merging with the player's existing
  // row so a late update never wipes picks for games that already locked.
  const existingVals = existingRow > 0
    ? sheet.getRange(existingRow, 1, 1, headers.length).getValues()[0]
    : null;
  const ts = new Date().toISOString();
  const row = headers.map((h, i) => {
    if (h === 'Timestamp') return ts;
    if (h === 'Team Name') return teamName || '';
    if (h === 'Team Name/Nickname') return nickname || '';
    if (h === 'Full Name') return fullName || '';
    if (h === 'Email') return email || '';
    if (h === BONUS_HEADER) {
      if (bonusVal !== undefined && bonusVal !== null) return bonusVal;
      return existingVals ? existingVals[i] : '';
    }
    if (submittedPicks[h]) return submittedPicks[h];
    return existingVals ? existingVals[i] : '';
  });

  const safeRow = row.map(sanitizeCell);
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, safeRow.length).setValues([safeRow]);
  } else {
    sheet.appendRow(safeRow);
  }

  // Update Players tab
  upsertPlayer(ss, { teamName, nickname, fullName, email });
}

function upsertPlayer(ss, { teamName, nickname, fullName, email }) {
  if (!email && !fullName) return;

  // Use nickname when teamName is "I'm new"
  const displayName = (teamName && !/^i'?m new$/i.test(teamName)) ? teamName : (nickname || '');

  let sheet = ss.getSheetByName(PLAYERS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(PLAYERS_TAB);
    sheet.getRange(1, 1, 1, 4).setValues([['Team Name', 'Full Name', 'Email', 'Joined']]);
    sheet.setFrozenRows(1);
  }

  const key = email || fullName;
  let found = false;
  if (sheet.getLastRow() > 1) {
    const emails = sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues().flat();
    const names  = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();
    for (let i = 0; i < emails.length; i++) {
      if (emails[i] === key || names[i] === key) {
        sheet.getRange(i + 2, 1).setValue(sanitizeCell(displayName));
        found = true;
        break;
      }
    }
  }
  if (!found) {
    sheet.appendRow([displayName, fullName || '', email || '', new Date().toISOString()].map(sanitizeCell));
  }
}

// ── Get picks ─────────────────────────────────────────────────────

function getPicks(week) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return parsePicksSheet(ss.getSheetByName(`Week ${week}`));
}

// All weeks in one call — opens the spreadsheet once, so it's far faster
// than one request per week.
function getAllPicks() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const out = {};
  ss.getSheets().forEach(sheet => {
    const m = sheet.getName().match(/^Week (\d+)$/);
    if (m) out[m[1]] = parsePicksSheet(sheet);
  });
  return out;
}

function parsePicksSheet(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const teamNameCol = headers.indexOf('Team Name');
  const nickCol     = headers.indexOf('Team Name/Nickname');
  const fullNameCol = headers.indexOf('Full Name');
  const emailCol    = headers.indexOf('Email');
  const tsCol       = headers.indexOf('Timestamp');
  const bonusCol    = headers.findIndex(h => /^bonus/i.test(String(h).trim()));
  const matchCols   = headers.map((h, i) => / vs /i.test(h) ? i : -1).filter(i => i >= 0);

  const byPlayer = {};
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const primaryName = teamNameCol >= 0 ? String(row[teamNameCol] || '').trim() : '';
    const player = (
      (primaryName && !/^i'?m new$/i.test(primaryName) ? primaryName : null) ||
      (nickCol >= 0 && String(row[nickCol] || '').trim()) ||
      (fullNameCol >= 0 && String(row[fullNameCol] || '').trim()) ||
      (emailCol >= 0 && String(row[emailCol] || '').trim()) || 'Unknown'
    );
    const ts = tsCol >= 0 ? String(row[tsCol] || '') : '';
    if (!byPlayer[player] || new Date(ts) > new Date(byPlayer[player].timestamp)) {
      const picks = {};
      matchCols.forEach(ci => { const v = String(row[ci] || '').trim(); if (v) picks[headers[ci]] = v; });
      const bonusRaw = bonusCol >= 0 ? row[bonusCol] : null;
      const bonusNum = parseInt(bonusRaw);
      byPlayer[player] = { player, timestamp: ts, picks, bonus: Number.isNaN(bonusNum) ? null : bonusNum };
    }
  }
  return Object.values(byPlayer);
}

// ── Per-game locks (mirrors getGameLockTime in index.html) ────────
// Each game locks 2 hours before its kickoff. Kickoff comes from the
// public schedule sheet CSV (Pacific date + Time), overridden by ESPN
// kickoff times published in results.json when available (handles moved
// games while the sheet is stale). Games with no time at all lock at
// midnight Pacific on their game day. Returns
// { locks: { "Home vs Away": Date }, firstLock: Date }, or null (fail
// open, no locking) if the schedule can't be fetched.

function getGameLocks(week) {
  try {
    const csv = UrlFetchApp.fetch(SCHEDULE_CSV_URL).getContentText();
    const rows = Utilities.parseCsv(csv);
    const headers = rows[0];
    const weekCol = headers.indexOf('WEEK');
    const dateCol = headers.indexOf('Date');
    const timeCol = headers.indexOf('Time');
    const homeCol = headers.indexOf('Home Team');
    const awayCol = headers.indexOf('Away Team');
    if (weekCol < 0 || dateCol < 0 || homeCol < 0 || awayCol < 0) return null;

    let weekNum = 0;
    const games = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (/^WEEK\s+OF/i.test(String(row[weekCol] || '').trim())) weekNum++;
      if (weekNum > week) break;
      if (weekNum !== week) continue;
      const dateStr = String(row[dateCol] || '').trim();
      const home = String(row[homeCol] || '').trim();
      const away = String(row[awayCol] || '').trim();
      if (!dateStr || !home || !away) continue;
      const [m, d, y] = dateStr.split('/').map(Number);
      if (!m || !d || !y) continue;
      const t = parseTime12(timeCol >= 0 ? row[timeCol] : '');
      games.push({
        home: home, away: away,
        sheetDay: pacificTime(y, m, d, 0, 0),
        kickoff: t ? pacificTime(y, m, d, t.h, t.min) : null,
      });
    }
    if (!games.length) return null;

    // Override with ESPN kickoff times. Matched by teams + date proximity
    // (the same pairing can recur later in the season). Fails open to
    // sheet times if results.json can't be fetched.
    try {
      const data = JSON.parse(UrlFetchApp.fetch(RESULTS_JSON_URL).getContentText());
      const kickoffs = (data && data.kickoffs) || [];
      games.forEach(g => {
        const k = kickoffs.find(k => k.kickoff && k.home && k.away &&
          teamsMatch(k.home, g.home) && teamsMatch(k.away, g.away) &&
          Math.abs(new Date(k.kickoff) - g.sheetDay) < 2.5 * 24 * 60 * 60 * 1000);
        if (k) {
          const d = new Date(k.kickoff);
          if (!isNaN(d.getTime())) g.kickoff = d;
        }
      });
    } catch (err) {}

    const locks = {};
    let firstLock = null;
    games.forEach(g => {
      const lock = g.kickoff
        ? new Date(g.kickoff.getTime() - 2 * 60 * 60 * 1000)
        : g.sheetDay; // no parseable time: lock at midnight Pacific on game day
      locks[g.home + ' vs ' + g.away] = lock;
      if (!firstLock || lock < firstLock) firstLock = lock;
    });
    return { locks: locks, firstLock: firstLock };
  } catch (err) {
    return null;
  }
}

// Loose team name matching, ported from index.html
function normTeam(s) {
  return String(s).toLowerCase()
    .replace(/\s*fc\s*$/i, '')
    .replace(/^kc\b/, 'kansas city')
    .replace(/\bbay\b$/, 'bay fc')
    .trim();
}
function teamsMatch(a, b) {
  const na = normTeam(a), nb = normTeam(b);
  return na === nb || na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0;
}

function parseTime12(timeStr) {
  const match = String(timeStr || '').trim().match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  let h = Number(match[1]);
  const min = Number(match[2]);
  if (match[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
  return { h: h, min: min };
}

// The given Pacific wall-clock time as a Date, DST-safe (same trick as
// pacificToDate in index.html: guess UTC, correct by the local offset).
function pacificTime(y, m, d, h, min) {
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  const local = Utilities.formatDate(guess, 'America/Los_Angeles', 'HH:mm');
  const parts = local.split(':');
  const diff = h * 60 + min - (Number(parts[0]) * 60 + Number(parts[1]));
  return new Date(guess.getTime() + diff * 60000);
}

// ── Helpers ───────────────────────────────────────────────────────

// Prevent formula injection: neutralize user strings starting with =, +, - or @.
function sanitizeCell(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
