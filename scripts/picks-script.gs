// NWSL Fantasy Picks — Google Apps Script
// Deploy as Web App: Execute as Me, Anyone can access
//
// POST ?action=submit  — submit/update picks for a player
// GET  ?action=picks&week=N — return all picks for week N as JSON

const SPREADSHEET_ID = '1oZCW1_eE2sBVyG9HgApT6EF4NTXfx5FiICsayko6xJI';
const PLAYERS_TAB = 'Players';

const HEADERS = ['Timestamp', 'Team Name', 'Team Name/Nickname', 'Full Name', 'Email'];
const BONUS_HEADER = 'BONUS: Total goals scored this week';

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'picks') {
    const week = parseInt(e.parameter.week);
    return jsonResponse(getPicks(week));
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

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tabName = `Week ${week}`;

  // Build ordered game columns from submitted picks
  const gameCols = Object.keys(picks);

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

  // Build row values in header order
  const ts = new Date().toISOString();
  const row = headers.map(h => {
    if (h === 'Timestamp') return ts;
    if (h === 'Team Name') return teamName || '';
    if (h === 'Team Name/Nickname') return nickname || '';
    if (h === 'Full Name') return fullName || '';
    if (h === 'Email') return email || '';
    if (h === BONUS_HEADER) return bonus !== undefined ? bonus : '';
    return picks[h] || '';
  });

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
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
        sheet.getRange(i + 2, 1).setValue(displayName);
        found = true;
        break;
      }
    }
  }
  if (!found) {
    sheet.appendRow([displayName, fullName || '', email || '', new Date().toISOString()]);
  }
}

// ── Get picks ─────────────────────────────────────────────────────

function getPicks(week) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tabName = `Week ${week}`;
  const sheet = ss.getSheetByName(tabName);
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
    if (!byPlayer[player] || ts > byPlayer[player].timestamp) {
      const picks = {};
      matchCols.forEach(ci => { const v = String(row[ci] || '').trim(); if (v) picks[headers[ci]] = v; });
      const bonusRaw = bonusCol >= 0 ? row[bonusCol] : null;
      byPlayer[player] = { player, timestamp: ts, picks, bonus: bonusRaw !== '' && bonusRaw !== null ? parseInt(bonusRaw) || null : null };
    }
  }
  return Object.values(byPlayer);
}

// ── Helpers ───────────────────────────────────────────────────────

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
