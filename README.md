# NWSL Fantasy League

A single-page fantasy league tracker for NWSL 2026. Players pick match winners each week and earn points for correct picks. Underdog bonus points awarded for correctly picking a winner chosen by fewer than 30% of players.

Live at: **https://nwslfan.github.io**

---

## How it works

Each week, players submit their picks via a Google Form. The app fetches responses from the linked Google Sheet, scores them against match results pulled automatically from the schedule spreadsheet, and displays a live leaderboard.

---

## Setup

All configuration is at the top of `index.html`.

### Schedule spreadsheet

The app reads match results and scores from:
```js
const SCHEDULE_URL = 'https://docs.google.com/spreadsheets/d/...';
```
This sheet must have columns: `WEEK`, `Date`, `Day`, `Time`, `Home Team`, `Away Team`, `Broadcast`, `Score`, `Winner`.

The `Winner` column drives scoring automatically — no manual entry needed.

### Adding a new week

1. Create a new Google Form for the week's matches
2. Open the linked responses sheet, copy the CSV export URL (change `/edit` to `/export?format=csv&gid=SHEET_GID`)
3. Add an entry to `WEEKS` in `index.html`:

```js
{ week: 2, picksUrl: 'YOUR_CSV_URL', formUrl: 'YOUR_FORM_URL', results: {}, bonusAnswer: null }
```

- `picksUrl` — CSV export URL of the form responses sheet
- `formUrl` — link to the Google Form (shown in the app for upcoming weeks)
- `results` — optional manual overrides if the schedule sheet hasn't been updated yet
- `bonusAnswer` — actual total goals scored (for bonus closest-guess scoring)

### Google Sheet access

The responses sheet must be shared as **"Anyone with the link can view"** (File → Share → Share with others).

---

## Scoring

| Event | Points |
|---|---|
| Correct pick | +1 |
| Correct underdog pick (<30% of players chose them) | +1 bonus |
| Closest goals guess (bonus question) | noted on leaderboard |

---

## Deployment

Pushes to `main` automatically deploy to GitHub Pages.
