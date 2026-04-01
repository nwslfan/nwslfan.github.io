#!/usr/bin/env node
// Fetches all completed NWSL game results from ESPN and writes results.json

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'results.json');

const SEASON_START = '20260313';
const SEASON_END   = '20261231';

const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/usa.nwsl/scoreboard?dates=${SEASON_START}-${SEASON_END}`;

const res = await fetch(url);
if (!res.ok) { console.error(`ESPN error: ${res.status}`); process.exit(1); }
const data = await res.json();

const games = (data.events || [])
    .filter(e => e.status.type.completed)
    .map(e => {
        const comp = e.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        const winner = home?.winner ? home.team.displayName
            : away?.winner ? away.team.displayName
            : 'Draw';
        const score = `${home?.score}-${away?.score}`;
        const date = e.date.slice(0, 10); // YYYY-MM-DD
        return { date, home: home.team.displayName, away: away.team.displayName, winner, score };
    });

const out = { updatedAt: new Date().toISOString(), games };
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`Wrote ${games.length} completed games to results.json`);
