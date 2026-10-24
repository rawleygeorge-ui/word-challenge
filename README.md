# Word Challenge

A two-player word game in a tropical garden. One player rolls the dice, gets a lucky draw of random letter tiles and hides a secret word in them. The other player rebuilds it on the board before time runs out, and climbs a 10-level ladder as they win.

- **Game data:** Google Sheet "Word Challenge – Game Data" (tabs: Games, Deals, Leaderboard)
- **Game screen, graphics and app wrapper:** this repo, hosted free on GitHub Pages
- **Link between them:** an Apps Script web app inside the sheet (`apps-script/Code.gs`)

Until step 2 is done the game runs in **practice mode** (games saved on that phone only), so you can try it straight away.

---

## Setup (about 10 minutes, once)

### 1. Put the script in the sheet

1. Open the sheet **Word Challenge – Game Data** → **Extensions → Apps Script**.
2. Delete what's in `Code.gs` and paste in everything from [`apps-script/Code.gs`](apps-script/Code.gs).
3. Click **Project Settings** (gear) → tick **Show "appsscript.json" manifest file**. Open it and replace it with [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. Back in the editor, pick **setup** in the function dropdown → **Run** → allow the permissions.
   This checks the tabs and sets an hourly check that expires unanswered challenges after 23 hours.

### 2. Publish it as a web app

1. **Deploy → New deployment** → type **Web app**.
2. Execute as: **Me**. Who has access: **Anyone**.
3. **Deploy**, then copy the **Web app URL** (ends in `/exec`).
4. In this repo, open [`js/config.js`](js/config.js) and paste it in:

   ```js
   window.WORD_CHALLENGE_API = "https://script.google.com/macros/s/XXXX/exec";
   ```

5. Commit. The practice-mode banner disappears and games now save to the sheet.

> After any later change to `Code.gs`: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.

### 3. Turn on GitHub Pages

1. In this repo: **Settings → Pages**.
2. Source: **Deploy from a branch** → branch **main**, folder **/ (root)** → **Save**.
3. After 1–2 minutes the game is live at **https://rawleygeorge-ui.github.io/word-challenge/**

### 4. Install it on your phone (the app wrapper)

- **Android (Chrome):** open the link → tap **Install** on the bar at the bottom (or ⋮ → Add to Home screen).
- **iPhone (Safari):** open the link → Share → **Add to Home Screen**.

It opens full-screen with the round Word Challenge icon, a tropical splash screen, and a "No signal" screen when offline, just like the KGEES FSR app.

### Your first word: PUGNACIOUS

The dice normally decide your tiles, so to send a specific word without rolling:

1. In Apps Script, open `Code.gs` and find `addChallenge()` at the bottom.
2. Change `'Opponent'` to your opponent's name (and `'Rawley'` if needed).
3. Pick **addChallenge** in the function dropdown → **Run** → **Execution log** shows the 5-letter game code.
4. Send your opponent the link: `https://rawleygeorge-ui.github.io/word-challenge/?g=CODE`

---

## How to play (player manual)

The same guide is in the game under **How to play**.

### Send a challenge
1. Tap **Send a challenge**, enter your name and your opponent's name.
2. The game shows your opponent's **level** (1–10). It decides how hard the challenge is.
3. Tap the die. The game has secretly rolled its own die too: the **hidden lucky number**.
4. **Match it (jackpot):** you choose how many tiles you get, up to 20.
   **Miss it:** your roll decides how many tiles (see the level table).
5. The letters on your tiles are always random (a lucky draw). Tap tiles to spell your secret word. One free **redraw** if your hand is bad.
6. Add a hint if their level allows one, then tap **Create challenge** and send the link or code on WhatsApp.

### Solve a challenge
1. Open the link, or type the code on the home screen. You have **23 hours**.
2. Tap a tile on your rack, then tap a square on the board. Tap a placed tile to take it back.
3. Lay the word in **one straight line through the centre flower**.
4. Tap **Check word**.

### Board rules
- Words go **across** (read left → right) or **down** (read top → bottom) only. No diagonals, no backwards, no gaps.
- Breaking a board rule doesn't use up a try — only a wrong word does.
- Your rack holds every tile the setter was dealt. The ones they didn't use are **decoys**.

### Levels (the level-up ladder)
Everyone starts at **Level 1**. Crack a word and you move up one level, up to **Level 10**. Miss one or run out of time and you stay where you are. Challenges sent to you use your level, so they get harder as you climb.

| Level | Tiles dealt | Shortest word | Tries | Hint | Time to answer | Points |
|---|---|---|---|---|---|---|
| 1 | 5–10 | 3 | 3 | yes | 23 h | ×1 |
| 2 | 6–11 | 4 | 3 | yes | 23 h | ×1.2 |
| 3 | 7–12 | 4 | 3 | yes | 23 h | ×1.4 |
| 4 | 8–13 | 5 | 3 | yes | 20 h | ×1.6 |
| 5 | 9–14 | 5 | 2 | yes | 20 h | ×1.8 |
| 6 | 10–15 | 6 | 2 | yes | 18 h | ×2 |
| 7 | 11–16 | 6 | 2 | no | 16 h | ×2.25 |
| 8 | 12–17 | 7 | 2 | no | 14 h | ×2.5 |
| 9 | 13–18 | 7 | 1 | no | 12 h | ×2.75 |
| 10 | 14–19 | 8 | 1 | no | 12 h | ×3 |

Jackpot (any level): match the hidden lucky number and choose up to 20 tiles. More tiles means more decoys for your opponent.

### Scoring
- Each letter's value is in the corner of its tile (A = 1 … Q, Z = 10).
- Coloured squares: **pink-red** triple word, **pink** double word (and the centre flower), **teal** triple letter, **pale aqua** double letter.
- Score = board score × level bonus. A later try keeps less: 60% then 30% with 3 tries, 50% on the second of 2 tries.
- Points go to the solver and add up on the **Leaderboard** (also a tab in the sheet).

---

## What's in this repo

| Path | What it is |
|---|---|
| `index.html` | The game screen, plus the app wrapper's splash, no-signal screen and install bar |
| `css/style.css` | Tropical garden theme |
| `js/app.js` | Game screens: dice, lucky draw, board, scoring display, inbox, leaderboard |
| `js/rules.js` | Board layout, levels and scoring (mirrors `Code.gs`) |
| `js/config.js` | **Your web app URL goes here** |
| `js/demo-api.js` | Practice mode, used until `config.js` has a URL |
| `js/wrapper.js`, `sw.js`, `manifest.json` | Installable app wrapper (same idea as the FSR app) |
| `img/` | Landscape, foliage, flowers, logo artwork (SVG) |
| `icons/` | App icons |
| `apps-script/` | `Code.gs` and `appsscript.json` for the sheet |

If you change files in `img/`, `css/` or `js/`, bump `CACHE` in `sw.js` (v1 → v2) so installed phones pick up the update.
