/**
 * Word Challenge — Google Sheets backend (Apps Script web app)
 *
 * The sheet is the database:
 *   Games       — one row per challenge
 *   Leaderboard — formula tab, totals by player
 *
 * The game screen (GitHub Pages) calls this web app with GET requests:
 *   ?action=deal&level=Easy|Medium|High[&prev=DEALID]   system rolls a hidden lucky number, player rolls; deal tiles (one free redraw)
 *   ?action=claim&deal=DEALID&count=N   after hitting the lucky number, choose how many tiles
 *   ?action=create&setter=&opponent=&word=&hint=&deal=DEALID
 *   ?action=game&id=
 *   ?action=guess&id=&player=&cells=6,2,C;6,3,O;...   (row,col,letter for each tile on the board)
 *   ?action=inbox&name=
 *   ?action=leaderboard
 *
 * The secret word is never sent to the browser until the game is over.
 * Board and level rules match js/rules.js in the GitHub repo — keep them in step.
 */

const SHEET_GAMES = 'Games';
const RESPONSE_HOURS = 23; // opponent must answer within this time

// Dice in a dice: the system secretly rolls a die for a hidden lucky number (1–6), then the setter rolls.
// Miss: they're dealt (base + roll) random tiles. Match the hidden number: they choose how many tiles (up to JACKPOT_MAX).
// They build a word from some of the tiles; unused tiles become the opponent's decoys.
const LEVELS = {
  Easy:   { base: 6,  minWord: 3, tries: 3, bonus: 1,   hint: true },
  Medium: { base: 8,  minWord: 5, tries: 3, bonus: 1.5, hint: true },
  High:   { base: 10, minWord: 7, tries: 2, bonus: 2,   hint: false }
};
const JACKPOT_MAX = 20;
const MAX_WORD = 13; // longest word that fits the board
const SHEET_DEALS = 'Deals';
const DEAL_HEADERS = ['DealID', 'Created', 'Level', 'Roll', 'Lucky', 'Letters', 'IsRedraw', 'Used'];
const D = { id: 0, created: 1, level: 2, roll: 3, lucky: 4, letters: 5, redraw: 6, used: 7 };
// Letter bag, Scrabble-style frequencies (no blanks)
const BAG = { E: 12, A: 9, I: 9, O: 8, N: 6, R: 6, T: 6, L: 4, S: 4, U: 4, D: 4, G: 3,
  B: 2, C: 2, M: 2, P: 2, F: 2, H: 2, V: 2, W: 2, Y: 2, K: 1, J: 1, X: 1, Q: 1, Z: 1 };
const TRY_SHARE = { 2: [1, 0.5], 3: [1, 0.6, 0.3] };

const HEADERS = ['GameID', 'Created', 'Setter', 'Opponent', 'Word', 'Hint',
  'Scrambled', 'Status', 'Guess', 'Attempts', 'Points', 'SolvedAt', 'Dice', 'Level', 'Lucky'];
const COL = {}; HEADERS.forEach((h, i) => COL[h] = i);

/* ---- board rules (same as js/rules.js) ---- */
const BOARD_SIZE = 13;
const CENTER = 6;
const PREMIUM = {
  TW: ['0,0', '0,6', '0,12', '6,0', '6,12', '12,0', '12,6', '12,12'],
  DW: ['1,1', '2,2', '3,3', '4,4', '1,11', '2,10', '3,9', '4,8', '11,1', '10,2', '9,3', '8,4', '11,11', '10,10', '9,9', '8,8', '6,6'],
  TL: ['1,5', '1,7', '5,1', '7,1', '5,11', '7,11', '11,5', '11,7', '5,5', '5,7', '7,5', '7,7'],
  DL: ['0,3', '0,9', '3,0', '9,0', '12,3', '12,9', '3,12', '9,12', '6,3', '6,9', '3,6', '9,6']
};
const PREMIUM_MAP = {};
Object.keys(PREMIUM).forEach(k => PREMIUM[k].forEach(pos => PREMIUM_MAP[pos] = k));

const LETTER_POINTS = {
  A: 1, E: 1, I: 1, O: 1, U: 1, L: 1, N: 1, S: 1, T: 1, R: 1,
  D: 2, G: 2,
  B: 3, C: 3, M: 3, P: 3,
  F: 4, H: 4, V: 4, W: 4, Y: 4,
  K: 5,
  J: 8, X: 8,
  Q: 10, Z: 10
};

/* ---------------- entry point ---------------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  let out;
  try {
    switch (p.action) {
      case 'deal':        out = deal_(p); break;
      case 'claim':       out = claim_(p); break;
      case 'create':      out = createGame_(p); break;
      case 'game':        out = getGame_(p.id); break;
      case 'guess':       out = submitGuess_(p); break;
      case 'inbox':       out = inbox_(p.name); break;
      case 'leaderboard': out = leaderboard_(); break;
      case 'ping':        out = { ok: true, pong: true }; break;
      default:            out = { ok: true, app: 'Word Challenge API' };
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- actions ---------------- */

/**
 * The system rolls a hidden lucky number, then the player's die is rolled.
 * Both rolls happen here on the server, so neither can be faked.
 * Miss: deals (base + roll) random tiles. Hit: the player then chooses how many tiles (see claim_).
 * One free redraw per challenge.
 */
function deal_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = dealsSheet_();
    let level = LEVELS[p.level] ? p.level : 'High';
    let isRedraw = false;
    if (p.prev) {
      const prev = findDeal_(p.prev);
      if (!prev) throw new Error('That roll was not found. Roll again.');
      if (prev.row[D.redraw] === true || prev.row[D.redraw] === 'TRUE') throw new Error("You've used your free redraw — make a word from these tiles.");
      if (prev.row[D.used]) throw new Error('That roll has already been used.');
      sh.getRange(prev.rowNum, D.used + 1).setValue('redrawn');
      level = prev.row[D.level];
      isRedraw = true;
    }
    const lucky = 1 + Math.floor(Math.random() * 6); // the system's hidden die
    const roll = 1 + Math.floor(Math.random() * 6);  // the player's die
    const jackpot = roll === lucky;
    const letters = jackpot ? '' : drawTiles_(LEVELS[level].base + roll);
    const id = 'D' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
    sh.appendRow([id, new Date(), level, roll, lucky, letters, isRedraw, '']);
    return {
      ok: true, dealId: id, level: level, roll: roll, lucky: lucky, jackpot: jackpot,
      letters: letters ? letters.split('') : [], canRedraw: !isRedraw,
      chooseFrom: jackpot ? LEVELS[level].minWord : null, chooseTo: jackpot ? JACKPOT_MAX : null
    };
  } finally {
    lock.releaseLock();
  }
}

/** After hitting the lucky number: deal the number of tiles the player chose. */
function claim_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const deal = findDeal_(p.deal);
    if (!deal) throw new Error('That roll was not found. Roll again.');
    if (Number(deal.row[D.roll]) !== Number(deal.row[D.lucky])) throw new Error("That roll didn't match the lucky number.");
    if (deal.row[D.letters]) throw new Error('You already chose your tiles.');
    const level = deal.row[D.level];
    const count = Number(p.count);
    if (!(count >= LEVELS[level].minWord && count <= JACKPOT_MAX)) {
      throw new Error('Choose between ' + LEVELS[level].minWord + ' and ' + JACKPOT_MAX + ' tiles.');
    }
    const letters = drawTiles_(count);
    dealsSheet_().getRange(deal.rowNum, D.letters + 1).setValue(letters);
    return { ok: true, dealId: deal.row[D.id], letters: letters.split('') };
  } finally {
    lock.releaseLock();
  }
}

function createGame_(p) {
  const setter = cleanName_(p.setter);
  const opponent = cleanName_(p.opponent);
  const word = String(p.word || '').trim().toUpperCase();

  if (!setter) throw new Error('Enter your name.');
  if (!opponent) throw new Error("Enter your opponent's name.");
  if (setter.toLowerCase() === opponent.toLowerCase()) throw new Error("You can't challenge yourself.");
  const deal = findDeal_(p.deal);
  if (!deal) throw new Error('Roll the dice first.');
  if (deal.row[D.used]) throw new Error('That roll has already been used. Roll again.');
  const level = deal.row[D.level];
  const L = LEVELS[level];
  const letters = String(deal.row[D.letters]);
  if (!letters) throw new Error('Choose how many tiles you want first.');
  if (!/^[A-Z]+$/.test(word)) throw new Error('The word can only use letters A–Z.');
  if (word.length < L.minWord) throw new Error(level + ' needs a word of at least ' + L.minWord + ' letters.');
  if (word.length > MAX_WORD) throw new Error('Words can be at most ' + MAX_WORD + ' letters.');
  if (!fromRack_(word, letters)) throw new Error('Use only the tiles you were dealt.');
  const hint = L.hint ? String(p.hint || '').trim().slice(0, 120) : '';

  const res = insertGame_(setter, opponent, word, hint, Number(deal.row[D.roll]), level, letters, Number(deal.row[D.lucky]));
  dealsSheet_().getRange(deal.rowNum, D.used + 1).setValue(res.id);
  return res;
}

/**
 * Writes a new challenge row. rackLetters = every dealt tile (word + unused decoys).
 * Also used by addChallenge() for setting a word by hand.
 */
function insertGame_(setter, opponent, word, hint, dice, level, rackLetters, lucky) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = gamesSheet_();
    const id = newId_();
    const rack = scramble_(rackLetters);
    sh.appendRow([id, new Date(), setter, opponent, word, hint, rack,
      'Pending', '', 0, '', '', dice, level, lucky || '']);
    return { ok: true, id: id, maxPoints: maxPoints_(word, level) };
  } finally {
    lock.releaseLock();
  }
}

function getGame_(id) {
  expireOldGames();
  const found = findGame_(id);
  if (!found) throw new Error('No game found with code ' + String(id || '').toUpperCase() + '.');
  return { ok: true, game: publicGame_(found.row) };
}

function submitGuess_(p) {
  const player = cleanName_(p.player);
  const cells = parseCells_(p.cells);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    expireOldGames_();
    const found = findGame_(p.id);
    if (!found) throw new Error('No game found with that code.');
    const row = found.row;
    if (row[COL.Status] !== 'Pending') {
      return { ok: true, result: 'over', game: publicGame_(row) };
    }
    if (player && player.toLowerCase() === String(row[COL.Setter]).toLowerCase()) {
      throw new Error("You set this word — it's your opponent's turn to guess.");
    }
    const word = String(row[COL.Word]);
    const level = levelOf_(row);
    const tries = LEVELS[level].tries;
    const placed = readPlacement_(cells, word.length); // throws on rule breaks — no try used
    const guess = placed.word;
    if (!fromRack_(guess, String(row[COL.Scrambled]))) throw new Error('Use only the tiles you were given.');

    const attempts = Number(row[COL.Attempts] || 0) + 1;
    const entry = guess + ' (row ' + (placed.cells[0].r + 1) + ', col ' + (placed.cells[0].c + 1) + ' ' + placed.dir + ')';
    const guesses = row[COL.Guess] ? String(row[COL.Guess]) + '; ' + entry : entry;
    let result;
    let boardScore = null;

    if (guess === word) {
      boardScore = boardScore_(placed.cells);
      row[COL.Status] = 'Solved';
      row[COL.Points] = finalPoints_(boardScore, level, attempts);
      row[COL.SolvedAt] = new Date();
      result = 'correct';
    } else if (attempts >= tries) {
      row[COL.Status] = 'Failed';
      row[COL.Points] = 0;
      result = 'failed';
    } else {
      result = 'wrong';
    }
    row[COL.Attempts] = attempts;
    row[COL.Guess] = guesses;
    gamesSheet_().getRange(found.rowNum, 1, 1, HEADERS.length).setValues([row]);

    return { ok: true, result: result, boardScore: boardScore, dir: placed.dir, game: publicGame_(row) };
  } finally {
    lock.releaseLock();
  }
}

function inbox_(name) {
  const n = cleanName_(name).toLowerCase();
  if (!n) throw new Error('Enter your name.');
  expireOldGames();
  const rows = allRows_();
  const mine = r => String(r[COL.Opponent]).toLowerCase() === n;
  const sent = r => String(r[COL.Setter]).toLowerCase() === n;
  return {
    ok: true,
    toPlay: rows.filter(mine).reverse().slice(0, 30).map(publicGame_),
    sent: rows.filter(sent).reverse().slice(0, 30).map(publicGame_)
  };
}

function leaderboard_() {
  const totals = {};
  allRows_().forEach(r => {
    if (r[COL.Status] !== 'Solved') return;
    const name = String(r[COL.Opponent]);
    const key = name.toLowerCase();
    totals[key] = totals[key] || { player: name, points: 0, solved: 0 };
    totals[key].points += Number(r[COL.Points] || 0);
    totals[key].solved += 1;
  });
  const list = Object.keys(totals).map(k => totals[k])
    .sort((a, b) => b.points - a.points || b.solved - a.solved)
    .slice(0, 20);
  return { ok: true, leaderboard: list };
}

/* ---------------- helpers ---------------- */

function publicGame_(row) {
  const over = row[COL.Status] !== 'Pending';
  const word = String(row[COL.Word]);
  const level = levelOf_(row);
  const tries = LEVELS[level].tries;
  return {
    id: row[COL.GameID],
    setter: row[COL.Setter],
    opponent: row[COL.Opponent],
    hint: row[COL.Hint] || '',
    level: level,
    tiles: String(row[COL.Scrambled]).split(''),
    length: word.length,
    dice: Number(row[COL.Dice]) || null,
    lucky: Number(row[COL.Lucky]) || null,
    jackpot: !!row[COL.Lucky] && Number(row[COL.Lucky]) === Number(row[COL.Dice]),
    status: row[COL.Status],
    attempts: Number(row[COL.Attempts] || 0),
    attemptsLeft: Math.max(0, tries - Number(row[COL.Attempts] || 0)),
    maxAttempts: tries,
    maxPoints: maxPoints_(word, level),
    points: row[COL.Points] === '' ? null : Number(row[COL.Points]),
    guesses: row[COL.Guess] ? String(row[COL.Guess]).split('; ') : [],
    expiresAt: expiresAt_(row).toISOString(),
    word: over ? word : null, // revealed only when the game is finished
    created: row[COL.Created] instanceof Date ? row[COL.Created].toISOString() : String(row[COL.Created])
  };
}

function levelOf_(row) {
  return LEVELS[row[COL.Level]] ? row[COL.Level] : 'Easy';
}

function expiresAt_(row) {
  const created = row[COL.Created] instanceof Date ? row[COL.Created] : new Date(row[COL.Created]);
  return new Date(created.getTime() + RESPONSE_HOURS * 3600 * 1000);
}

/**
 * Marks unanswered games older than 23 hours as Expired.
 * Runs before every read, and hourly from the trigger that setup() creates.
 */
function expireOldGames() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { expireOldGames_(); } finally { lock.releaseLock(); }
}

function expireOldGames_() {
  const sh = gamesSheet_();
  const rows = allRows_();
  const now = Date.now();
  rows.forEach((r, i) => {
    if (r[COL.Status] === 'Pending' && r[COL.Created] && expiresAt_(r).getTime() <= now) {
      sh.getRange(i + 2, COL.Status + 1).setValue('Expired');
      sh.getRange(i + 2, COL.Points + 1).setValue(0);
    }
  });
}

function gamesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_GAMES);
  if (!sh) {
    sh = ss.insertSheet(SHEET_GAMES);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function allRows_() {
  const sh = gamesSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
}

function findGame_(id) {
  const code = String(id || '').trim().toUpperCase();
  if (!code) return null;
  const rows = allRows_();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][COL.GameID]).toUpperCase() === code) {
      return { row: rows[i], rowNum: i + 2 };
    }
  }
  return null;
}

function newId_() {
  // 5-character code without easily confused letters/digits
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const existing = new Set(allRows_().map(r => String(r[COL.GameID])));
  let id;
  do {
    id = '';
    for (let i = 0; i < 5; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  } while (existing.has(id));
  return id;
}

/** Draws n random tiles from the bag, keeping a playable mix of vowels (35–60%). */
function drawTiles_(n) {
  const bag = [];
  Object.keys(BAG).forEach(ch => { for (let i = 0; i < BAG[ch]; i++) bag.push(ch); });
  let hand = '';
  for (let attempt = 0; attempt < 60; attempt++) {
    const b = bag.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = b[i]; b[i] = b[j]; b[j] = t;
    }
    hand = b.slice(0, n).join('');
    const vowels = hand.replace(/[^AEIOU]/g, '').length;
    if (vowels >= Math.ceil(n * 0.35) && vowels <= Math.ceil(n * 0.6)) break;
  }
  return hand;
}

function dealsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_DEALS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_DEALS);
    sh.appendRow(DEAL_HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function findDeal_(id) {
  const code = String(id || '').trim().toUpperCase();
  if (!code) return null;
  const sh = dealsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const rows = sh.getRange(2, 1, last - 1, DEAL_HEADERS.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]).toUpperCase() === code) return { row: rows[i], rowNum: i + 2 };
  }
  return null;
}

function scramble_(letters) {
  const arr = letters.split('');
  if (new Set(arr).size === 1) return letters;
  let out = letters;
  for (let tries = 0; tries < 20 && out === letters; tries++) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    out = arr.join('');
  }
  return out;
}

function fromRack_(guess, rack) {
  const pool = {};
  rack.split('').forEach(c => pool[c] = (pool[c] || 0) + 1);
  return guess.split('').every(c => (pool[c] = (pool[c] || 0) - 1) >= 0);
}

function parseCells_(raw) {
  return String(raw || '').split(';').filter(Boolean).map(part => {
    const bits = part.split(',');
    return { r: Number(bits[0]), c: Number(bits[1]), letter: String(bits[2] || '').toUpperCase() };
  });
}

// Word must be one straight, gap-free line through the centre square,
// read across (left to right) or down (top to bottom) only.
function readPlacement_(cells, length) {
  if (cells.length !== length) throw new Error('Place exactly ' + length + ' tiles on the board.');
  const seen = {};
  cells.forEach(t => {
    if (!(t.r >= 0 && t.r < BOARD_SIZE && t.c >= 0 && t.c < BOARD_SIZE) || !/^[A-Z]$/.test(t.letter)) {
      throw new Error('A tile is off the board.');
    }
    const k = t.r + ',' + t.c;
    if (seen[k]) throw new Error('Two tiles are on the same square.');
    seen[k] = true;
  });
  const sameRow = cells.every(t => t.r === cells[0].r);
  const sameCol = cells.every(t => t.c === cells[0].c);
  if (!sameRow && !sameCol) throw new Error('Tiles must be in one straight line — across or down, no diagonals.');
  const dir = sameRow ? 'across' : 'down';
  const sorted = cells.slice().sort((a, b) => dir === 'across' ? a.c - b.c : a.r - b.r);
  for (let i = 1; i < sorted.length; i++) {
    const gap = dir === 'across' ? sorted[i].c - sorted[i - 1].c : sorted[i].r - sorted[i - 1].r;
    if (gap !== 1) throw new Error('Leave no gaps between your tiles.');
  }
  if (!seen[CENTER + ',' + CENTER]) throw new Error('Your word must cover the centre flower.');
  return { dir: dir, cells: sorted, word: sorted.map(t => t.letter).join('') };
}

function boardScore_(sortedCells) {
  let sum = 0, wordMult = 1;
  sortedCells.forEach(t => {
    const p = PREMIUM_MAP[t.r + ',' + t.c] || '';
    sum += (LETTER_POINTS[t.letter] || 0) * (p === 'DL' ? 2 : p === 'TL' ? 3 : 1);
    if (p === 'DW') wordMult *= 2;
    if (p === 'TW') wordMult *= 3;
  });
  return sum * wordMult;
}

function maxScore_(word) {
  const L = word.length;
  const letters = String(word).split('');
  let best = 0;
  for (let start = Math.max(0, CENTER - L + 1); start <= Math.min(CENTER, BOARD_SIZE - L); start++) {
    const across = letters.map((letter, i) => ({ r: CENTER, c: start + i, letter: letter }));
    const down = letters.map((letter, i) => ({ r: start + i, c: CENTER, letter: letter }));
    best = Math.max(best, boardScore_(across), boardScore_(down));
  }
  return best;
}

function finalPoints_(boardScore, level, tryNumber) {
  const L = LEVELS[level];
  return Math.round(boardScore * L.bonus * TRY_SHARE[L.tries][tryNumber - 1]);
}

function maxPoints_(word, level) {
  return finalPoints_(maxScore_(word), level, 1);
}

function cleanName_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

/** Run once from the editor: checks the sheet and sets the hourly 23-hour expiry check. */
function setup() {
  gamesSheet_();
  dealsSheet_();
  const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'expireOldGames');
  if (!exists) ScriptApp.newTrigger('expireOldGames').timeBased().everyHours(1).create();
  Logger.log('Games sheet ready and hourly expiry check set. Now Deploy → New deployment → Web app.');
}

/**
 * Set a word by hand, skipping the dice (edit the values, then Run).
 * Logs the game code to send to your opponent.
 */
function addChallenge() {
  const word = 'PUGNACIOUS';
  const level = 'High';
  const tiles = 14; // tiles on the opponent's rack: the word plus random decoys
  const rack = word + drawTiles_(tiles - word.length);
  const res = insertGame_('Rawley', 'Opponent', word, '', '', level, rack, '');
  Logger.log('Challenge code: ' + res.id + '  (worth up to ' + res.maxPoints + ' points)');
}
