// Board rules and difficulty levels, shared by the game screen and practice mode.
// apps-script/Code.gs has the same rules for the live game — keep them in step.
(function () {
  const SIZE = 13;
  const CENTER = 6;
  const LETTER_POINTS = { A:1,E:1,I:1,O:1,U:1,L:1,N:1,S:1,T:1,R:1,D:2,G:2,B:3,C:3,M:3,P:3,F:4,H:4,V:4,W:4,Y:4,K:5,J:8,X:8,Q:10,Z:10 };

  // Dice in a dice: the system secretly rolls a hidden lucky number (1–6), then you roll a normal die.
  // Miss: you're dealt (base + roll) random tiles. Match the hidden number: you choose how many (up to JACKPOT_MAX).
  // You build your word from some of the tiles; unused tiles become your opponent's decoys.
  //
  // Level-up ladder: every player starts at Level 1 and goes up one level per word they crack (max 10).
  // A challenge uses the opponent's level. Easy/Medium/High are kept only for older games.
  const LEVELS = {
    '1':  { base: 4,  minWord: 3, tries: 3, bonus: 1,    hint: true,  hours: 23 },
    '2':  { base: 5,  minWord: 4, tries: 3, bonus: 1.2,  hint: true,  hours: 23 },
    '3':  { base: 6,  minWord: 4, tries: 3, bonus: 1.4,  hint: true,  hours: 23 },
    '4':  { base: 7,  minWord: 5, tries: 3, bonus: 1.6,  hint: true,  hours: 20 },
    '5':  { base: 8,  minWord: 5, tries: 2, bonus: 1.8,  hint: true,  hours: 20 },
    '6':  { base: 9,  minWord: 6, tries: 2, bonus: 2,    hint: true,  hours: 18 },
    '7':  { base: 10, minWord: 6, tries: 2, bonus: 2.25, hint: false, hours: 16 },
    '8':  { base: 11, minWord: 7, tries: 2, bonus: 2.5,  hint: false, hours: 14 },
    '9':  { base: 12, minWord: 7, tries: 1, bonus: 2.75, hint: false, hours: 12 },
    '10': { base: 13, minWord: 8, tries: 1, bonus: 3,    hint: false, hours: 12 },
    Easy:   { base: 6,  minWord: 3, tries: 3, bonus: 1,   hint: true,  hours: 23 },
    Medium: { base: 8,  minWord: 5, tries: 3, bonus: 1.5, hint: true,  hours: 23 },
    High:   { base: 10, minWord: 7, tries: 2, bonus: 2,   hint: false, hours: 23 }
  };
  const MAX_LEVEL = 10;
  const JACKPOT_MAX = 20;
  const MAX_WORD = 13; // longest word that fits the board
  // Share of the score kept on each try
  const TRY_SHARE = { 1: [1], 2: [1, 0.5], 3: [1, 0.6, 0.3] };

  function levelName(level) { return /^\d+$/.test(String(level)) ? 'Level ' + level : String(level); }

  function blurb(level) {
    const L = LEVELS[level];
    return (L.base + 1) + '–' + (L.base + 6) + ' tiles, words of ' + L.minWord + '+ letters, ' +
      L.tries + (L.tries === 1 ? ' try' : ' tries') + ', ' + (L.hint ? 'hint allowed' : 'no hint') + ', ' +
      L.hours + ' hours' + (L.bonus !== 1 ? ', points ×' + L.bonus : '') + '.';
  }

  const PREMIUM = {
    TW: ['0,0', '0,6', '0,12', '6,0', '6,12', '12,0', '12,6', '12,12'],
    DW: ['1,1', '2,2', '3,3', '4,4', '1,11', '2,10', '3,9', '4,8', '11,1', '10,2', '9,3', '8,4', '11,11', '10,10', '9,9', '8,8', '6,6'],
    TL: ['1,5', '1,7', '5,1', '7,1', '5,11', '7,11', '11,5', '11,7', '5,5', '5,7', '7,5', '7,7'],
    DL: ['0,3', '0,9', '3,0', '9,0', '12,3', '12,9', '3,12', '9,12', '6,3', '6,9', '3,6', '9,6']
  };
  const premiumMap = {};
  Object.keys(PREMIUM).forEach(k => PREMIUM[k].forEach(pos => { premiumMap[pos] = k; }));

  function premiumAt(r, c) { return premiumMap[r + ',' + c] || ''; }

  // cells: [{r, c, letter}] in any order.
  // Returns {ok, word, dir, cells} with cells in reading order, or {ok:false, error}.
  function readPlacement(cells, length) {
    if (cells.length !== length) return { ok: false, error: 'Place exactly ' + length + ' tiles on the board.' };
    const seen = new Set();
    for (const t of cells) {
      if (!(t.r >= 0 && t.r < SIZE && t.c >= 0 && t.c < SIZE)) return { ok: false, error: 'A tile is off the board.' };
      const k = t.r + ',' + t.c;
      if (seen.has(k)) return { ok: false, error: 'Two tiles are on the same square.' };
      seen.add(k);
    }
    const sameRow = cells.every(t => t.r === cells[0].r);
    const sameCol = cells.every(t => t.c === cells[0].c);
    if (!sameRow && !sameCol) return { ok: false, error: 'Tiles must be in one straight line — across or down, no diagonals.' };
    const dir = sameRow ? 'across' : 'down';
    const sorted = cells.slice().sort((a, b) => dir === 'across' ? a.c - b.c : a.r - b.r);
    for (let i = 1; i < sorted.length; i++) {
      const gap = dir === 'across' ? sorted[i].c - sorted[i - 1].c : sorted[i].r - sorted[i - 1].r;
      if (gap !== 1) return { ok: false, error: 'Leave no gaps between your tiles.' };
    }
    if (!seen.has(CENTER + ',' + CENTER)) return { ok: false, error: 'Your word must cover the centre flower.' };
    return { ok: true, dir, cells: sorted, word: sorted.map(t => t.letter).join('') };
  }

  function score(sortedCells) {
    let sum = 0, wordMult = 1;
    sortedCells.forEach(t => {
      const p = premiumAt(t.r, t.c);
      const v = LETTER_POINTS[t.letter] || 0;
      sum += v * (p === 'DL' ? 2 : p === 'TL' ? 3 : 1);
      if (p === 'DW') wordMult *= 2;
      if (p === 'TW') wordMult *= 3;
    });
    return sum * wordMult;
  }

  // Best possible board score for a word placed across or down through the centre
  function maxScore(word) {
    const L = word.length;
    let best = 0;
    for (let start = Math.max(0, CENTER - L + 1); start <= Math.min(CENTER, SIZE - L); start++) {
      const across = word.split('').map((letter, i) => ({ r: CENTER, c: start + i, letter }));
      const down = word.split('').map((letter, i) => ({ r: start + i, c: CENTER, letter }));
      best = Math.max(best, score(across), score(down));
    }
    return best;
  }

  // Final points = board score × level bonus × share kept for that try
  function finalPoints(boardScore, level, tryNumber) {
    const L = LEVELS[level] || LEVELS.Easy;
    return Math.round(boardScore * L.bonus * TRY_SHARE[L.tries][tryNumber - 1]);
  }

  function maxPoints(word, level) {
    return finalPoints(maxScore(word), level, 1);
  }

  // Do the guessed letters come from the rack (which may include decoys)?
  function fromRack(guess, tiles) {
    const pool = {};
    tiles.forEach(t => { pool[t] = (pool[t] || 0) + 1; });
    return guess.split('').every(ch => (pool[ch] = (pool[ch] || 0) - 1) >= 0);
  }

  window.WCRules = { SIZE, CENTER, MAX_WORD, MAX_LEVEL, JACKPOT_MAX, levelName, blurb, LETTER_POINTS, LEVELS, TRY_SHARE, premiumAt, readPlacement, score, maxScore, finalPoints, maxPoints, fromRack };
})();
