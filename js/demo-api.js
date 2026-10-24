// Practice-mode stand-in for the Google Sheets backend.
// Mirrors apps-script/Code.gs so the game can be tried before the web app is deployed.
(function () {
  const R = () => window.WCRules;
  const hoursFor = g => (R().LEVELS[g.level] || R().LEVELS['1']).hours;
  const KEY = 'wc-demo-games-v4';
  const DEALS_KEY = 'wc-demo-deals-v3';
  const BAG = { E: 12, A: 9, I: 9, O: 8, N: 6, R: 6, T: 6, L: 4, S: 4, U: 4, D: 4, G: 3,
    B: 2, C: 2, M: 2, P: 2, F: 2, H: 2, V: 2, W: 2, Y: 2, K: 1, J: 1, X: 1, Q: 1, Z: 1 };
  let dealsMem = {};
  function loadDeals() { try { return JSON.parse(localStorage.getItem(DEALS_KEY)) || {}; } catch (e) { return dealsMem; } }
  function saveDeals(d) { dealsMem = d; try { localStorage.setItem(DEALS_KEY, JSON.stringify(d)); } catch (e) {} }
  function drawTiles(n) {
    const bag = [];
    Object.keys(BAG).forEach(ch => { for (let i = 0; i < BAG[ch]; i++) bag.push(ch); });
    let hand = '';
    for (let a = 0; a < 60; a++) {
      const b = bag.slice();
      for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
      hand = b.slice(0, n).join('');
      const v = hand.replace(/[^AEIOU]/g, '').length;
      if (v >= Math.ceil(n * 0.35) && v <= Math.ceil(n * 0.6)) break;
    }
    return hand;
  }
  let memory = [];

  function save(g) { memory = g; try { localStorage.setItem(KEY, JSON.stringify(g)); } catch (e) {} }
  function load() {
    let g; try { g = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { g = memory; }
    let changed = false;
    g.forEach(x => {
      if (x.status === 'Pending' && Date.now() >= new Date(x.created).getTime() + hoursFor(x) * 3600000) {
        x.status = 'Expired'; x.points = 0; changed = true;
      }
    });
    if (changed) save(g);
    return g;
  }
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 30);

  function scramble(letters) {
    const l = letters.split('');
    if (new Set(l).size === 1) return letters;
    let out = letters;
    for (let t = 0; t < 20 && out === letters; t++) {
      for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
      out = l.join('');
    }
    return out;
  }

  function pub(g) {
    const over = g.status !== 'Pending';
    const tries = R().LEVELS[g.level].tries;
    return {
      id: g.id, setter: g.setter, opponent: g.opponent, hint: g.hint, level: g.level,
      tiles: g.scrambled.split(''), length: g.word.length, dice: g.dice, lucky: g.lucky || null,
      jackpot: !!g.lucky && g.lucky === g.dice, status: g.status,
      attempts: g.attempts, attemptsLeft: Math.max(0, tries - g.attempts), maxAttempts: tries,
      maxPoints: R().maxPoints(g.word, g.level), points: g.points, guesses: g.guesses,
      expiresAt: new Date(new Date(g.created).getTime() + hoursFor(g) * 3600000).toISOString(),
      word: over ? g.word : null, created: g.created
    };
  }

  function playerLevel(name) {
    const n = clean(name).toLowerCase();
    if (!n) return 1;
    const solved = load().filter(g => g.status === 'Solved' && g.opponent.toLowerCase() === n).length;
    return Math.min(R().MAX_LEVEL, 1 + solved);
  }

  const actions = {
    level(p) {
      const level = playerLevel(p.name);
      return { ok: true, name: clean(p.name), level, rules: R().LEVELS[String(level)] };
    },
    deal(p) {
      const deals = loadDeals();
      let forName = clean(p.opponent);
      if (!forName) throw new Error("Enter your opponent's name first.");
      let level = String(playerLevel(forName));
      let isRedraw = false;
      if (p.prev) {
        const prev = deals[p.prev];
        if (!prev) throw new Error('That roll was not found. Roll again.');
        if (prev.isRedraw) throw new Error("You've used your free redraw — make a word from these tiles.");
        if (prev.used) throw new Error('That roll has already been used.');
        prev.used = 'redrawn'; level = prev.level; forName = prev.forName || forName; isRedraw = true;
      }
      const lucky = 1 + Math.floor(Math.random() * 6); // the system's hidden die
      const roll = 1 + Math.floor(Math.random() * 6);  // the player's die
      const jackpot = roll === lucky;
      const letters = jackpot ? '' : drawTiles(R().LEVELS[level].base + roll);
      const id = 'D' + Math.random().toString(36).slice(2, 12).toUpperCase();
      deals[id] = { level, roll, lucky, letters, isRedraw, used: '', forName };
      saveDeals(deals);
      return { ok: true, dealId: id, level, opponent: forName, roll, lucky, jackpot, letters: letters ? letters.split('') : [],
        canRedraw: !isRedraw, chooseFrom: jackpot ? R().LEVELS[level].minWord : null, chooseTo: jackpot ? R().JACKPOT_MAX : null };
    },
    claim(p) {
      const deals = loadDeals();
      const d = deals[p.deal];
      if (!d) throw new Error('That roll was not found. Roll again.');
      if (d.roll !== d.lucky) throw new Error("That roll didn't hit your lucky number.");
      if (d.letters) throw new Error('You already chose your tiles.');
      const count = Number(p.count), min = R().LEVELS[d.level].minWord;
      if (!(count >= min && count <= R().JACKPOT_MAX)) throw new Error('Choose between ' + min + ' and ' + R().JACKPOT_MAX + ' tiles.');
      d.letters = drawTiles(count);
      saveDeals(deals);
      return { ok: true, dealId: p.deal, letters: d.letters.split('') };
    },
    create(p) {
      const setter = clean(p.setter), opponent = clean(p.opponent);
      const word = String(p.word || '').trim().toUpperCase();
      if (!setter) throw new Error('Enter your name.');
      if (!opponent) throw new Error("Enter your opponent's name.");
      if (setter.toLowerCase() === opponent.toLowerCase()) throw new Error("You can't challenge yourself.");
      const deals = loadDeals();
      const deal = deals[p.deal];
      if (!deal) throw new Error('Roll the dice first.');
      if (deal.used) throw new Error('That draw has already been used. Roll again.');
      if (deal.forName && deal.forName.toLowerCase() !== opponent.toLowerCase()) throw new Error('That roll was for ' + deal.forName + '. Roll again for ' + opponent + '.');
      const level = deal.level, L = R().LEVELS[level], dice = deal.roll;
      if (!deal.letters) throw new Error('Choose how many tiles you want first.');
      if (!/^[A-Z]+$/.test(word)) throw new Error('The word can only use letters A–Z.');
      if (word.length < L.minWord) throw new Error(R().levelName(level) + ' needs a word of at least ' + L.minWord + ' letters.');
      if (word.length > R().MAX_WORD) throw new Error('Words can be at most ' + R().MAX_WORD + ' letters.');
      if (!R().fromRack(word, deal.letters.split(''))) throw new Error('Use only the tiles you were dealt.');
      const games = load();
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let id;
      do { id = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
      while (games.some(g => g.id === id));
      deal.used = id; saveDeals(deals);
      games.push({ id, setter, opponent, word, level, dice, lucky: deal.lucky,
        hint: L.hint ? String(p.hint || '').trim().slice(0, 120) : '',
        scrambled: scramble(deal.letters), status: 'Pending', attempts: 0, points: null, guesses: [],
        created: new Date().toISOString() });
      save(games);
      return { ok: true, id, maxPoints: R().maxPoints(word, level) };
    },
    game(p) {
      const g = load().find(x => x.id === String(p.id || '').toUpperCase());
      if (!g) throw new Error('No game found with code ' + String(p.id || '').toUpperCase() + '.');
      return { ok: true, game: pub(g) };
    },
    guess(p) {
      const games = load();
      const g = games.find(x => x.id === String(p.id || '').toUpperCase());
      if (!g) throw new Error('No game found with that code.');
      if (g.status !== 'Pending') return { ok: true, result: 'over', game: pub(g) };
      const player = clean(p.player);
      if (player && player.toLowerCase() === g.setter.toLowerCase()) throw new Error("You set this word — it's your opponent's turn to guess.");
      const cells = String(p.cells || '').split(';').filter(Boolean).map(x => {
        const b = x.split(','); return { r: Number(b[0]), c: Number(b[1]), letter: String(b[2] || '').toUpperCase() };
      });
      const placed = R().readPlacement(cells, g.word.length);
      if (!placed.ok) throw new Error(placed.error);
      const guess = placed.word;
      if (!R().fromRack(guess, g.scrambled.split(''))) throw new Error('Use only the tiles you were given.');
      const tries = R().LEVELS[g.level].tries;
      g.attempts += 1; g.guesses.push(guess);
      let result = 'wrong', boardScore = null;
      if (guess === g.word) {
        boardScore = R().score(placed.cells);
        g.status = 'Solved'; g.points = R().finalPoints(boardScore, g.level, g.attempts); result = 'correct';
      } else if (g.attempts >= tries) { g.status = 'Failed'; g.points = 0; result = 'failed'; }
      save(games);
      const out = { ok: true, result, boardScore, dir: placed.dir, game: pub(g) };
      if (result === 'correct') out.newLevel = playerLevel(g.opponent);
      return out;
    },
    inbox(p) {
      const n = clean(p.name).toLowerCase();
      if (!n) throw new Error('Enter your name.');
      const games = load().slice().reverse();
      return { ok: true,
        toPlay: games.filter(g => g.opponent.toLowerCase() === n).map(pub),
        sent: games.filter(g => g.setter.toLowerCase() === n).map(pub) };
    },
    leaderboard() {
      const t = {};
      load().filter(g => g.status === 'Solved').forEach(g => {
        const k = g.opponent.toLowerCase();
        t[k] = t[k] || { player: g.opponent, points: 0, solved: 0 };
        t[k].points += g.points; t[k].solved += 1;
      });
      Object.values(t).forEach(x => { x.level = Math.min(R().MAX_LEVEL, 1 + x.solved); });
      return { ok: true, leaderboard: Object.values(t).sort((a, b) => b.points - a.points || b.solved - a.solved) };
    }
  };

  window.DemoApi = function (action, params) {
    return new Promise(resolve => setTimeout(() => {
      try { resolve(actions[action](params || {})); }
      catch (e) { resolve({ ok: false, error: e.message }); }
    }, 150));
  };
})();
