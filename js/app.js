(function () {
  const API = (window.WORD_CHALLENGE_API || '').trim();
  const DEMO = !API;
  const R = window.WCRules;
  const PTS = R.LETTER_POINTS;

  const $ = id => document.getElementById(id);
  const views = ['home', 'create', 'share', 'play', 'inbox', 'leaderboard', 'howto'];

  /* ---------- storage (best effort) ---------- */
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- API ---------- */
  async function api(action, params) {
    $('loading').hidden = false;
    try {
      if (DEMO) return await window.DemoApi(action, params);
      const qs = new URLSearchParams(Object.assign({ action }, params || {}));
      const res = await fetch(API + '?' + qs.toString());
      return await res.json();
    } catch (e) {
      return { ok: false, error: "Couldn't reach the game. Check your signal and try again." };
    } finally {
      $('loading').hidden = true;
    }
  }

  /* ---------- helpers ---------- */
  function tileEl(letter, tag) {
    const t = document.createElement(tag || 'button');
    t.className = 'tile';
    if (t.tagName === 'BUTTON') t.type = 'button';
    t.innerHTML = letter + '<sub>' + (PTS[letter] || '') + '</sub>';
    t.setAttribute('aria-label', letter + ', ' + (PTS[letter] || 0) + ' points');
    return t;
  }

  function fitTiles(container, count, max) {
    // Shrink tiles so a rack fits in at most two rows
    const width = Math.min(($('view-play').clientWidth || document.querySelector('.panel-wrap').clientWidth || 360), 560) - 20;
    const perRow = count > 9 ? Math.ceil(count / 2) : count;
    const size = Math.max(30, Math.min(max || 52, Math.floor((width - (perRow - 1) * 6) / perRow)));
    container.style.setProperty('--tile', size + 'px');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function shareUrl(id) {
    return location.origin + location.pathname + '?g=' + id;
  }

  /* ---------- routing ---------- */
  let current = 'home';
  function show(name) {
    current = name;
    views.forEach(v => { $('view-' + v).hidden = v !== name; });
    window.scrollTo(0, 0);
    if (name === 'create') resetCreate();
    if (name === 'leaderboard') loadLeaderboard();
    if (name === 'inbox') {
      const n = store.get('wc-name');
      const input = $('inbox-form').elements.name;
      if (n && !input.value) { input.value = n; loadInbox(n); }
    }
    if (name !== 'play') stopClock();
  }

  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) {
      e.preventDefault();
      if (go.dataset.go === 'home' || go.dataset.go === 'create') history.replaceState(null, '', location.pathname);
      show(go.dataset.go);
    }
  });

  /* ---------- create: level, lucky number, die, lucky draw ---------- */
  const form = $('create-form');
  let deal = null;       // {dealId, roll, lucky, jackpot, letters, level, canRedraw}
  let wordPick = [];     // indexes into deal.letters, in spelling order
  let rot = { x: -18, y: 24 };
  // Cube rotation that brings each pip value to the front (opposite faces add to 7)
  const PIP_ROT = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };
  const PIP_LAYOUT = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  function pipsHtml(n) {
    let h = '';
    for (let i = 0; i < 9; i++) h += '<i class="pip' + (PIP_LAYOUT[n].includes(i) ? '' : ' blank') + '"></i>';
    return h;
  }

  // Draw pips on the player's die
  form.querySelectorAll('.face').forEach(f => { f.classList.add('pipface'); f.innerHTML = pipsHtml(Number(f.dataset.pips)); });

  function hideLucky() {
    const lf = $('lucky-face');
    lf.classList.remove('revealed', 'match');
    lf.innerHTML = '<span class="q">?</span>';
    lf.setAttribute('aria-label', 'Hidden lucky number');
  }
  function revealLucky(n, match) {
    const lf = $('lucky-face');
    lf.innerHTML = pipsHtml(n);
    lf.classList.add('revealed');
    lf.classList.toggle('match', match);
    lf.setAttribute('aria-label', 'Lucky number was ' + n);
  }

  function chosenLevel() {
    const el = form.querySelector('input[name="level"]:checked');
    return el ? el.value : 'High';
  }

  function paintLevel() {
    const L = R.LEVELS[chosenLevel()];
    $('level-blurb').textContent = L.blurb;
    $('hint-field').hidden = !L.hint;
  }
  form.querySelectorAll('input[name="level"]').forEach(r => r.addEventListener('change', paintLevel));

  function lockChoices(locked) {
    form.querySelectorAll('input[name="level"]').forEach(r => { r.disabled = locked; });
  }

  function resetCreate() {
    const keepSetter = store.get('wc-name');
    form.reset();
    deal = null; wordPick = [];
    lockChoices(false);
    $('dice').disabled = false;
    $('dice').classList.remove('rolled');
    $('cube').style.transform = '';
    rot = { x: -18, y: 24 };
    $('dice-caption').textContent = 'The game has rolled a hidden lucky number. Tap your die. Match it and you choose your tiles.';
    hideLucky();
    $('jackpot').hidden = true;
    $('draw').hidden = true;
    $('create-error').textContent = '';
    if (keepSetter) form.elements.setter.value = keepSetter;
    paintLevel();
  }

  function spinTo(value) {
    const [fx, fy] = PIP_ROT[value];
    const turnsX = 2 + Math.floor(Math.random() * 2);
    const turnsY = 2 + Math.floor(Math.random() * 2);
    const nx = Math.ceil(rot.x / 360) * 360 + turnsX * 360 + fx;
    const ny = Math.ceil(rot.y / 360) * 360 + turnsY * 360 + fy;
    rot = { x: nx, y: ny };
    $('cube').style.transform = 'rotateX(' + nx + 'deg) rotateY(' + ny + 'deg)';
  }

  async function roll(prevId) {
    $('create-error').textContent = '';
    const d = $('dice');
    d.disabled = true;
    $('btn-redraw').disabled = true;
    const params = prevId ? { prev: prevId } : { level: chosenLevel() };
    hideLucky();
    const res = await api('deal', params);
    $('btn-redraw').disabled = false;
    if (!res.ok) {
      $('create-error').textContent = res.error;
      if (!deal) d.disabled = false;
      return;
    }
    deal = res;
    wordPick = [];
    d.classList.add('rolled');
    lockChoices(true);
    $('draw').hidden = true;
    $('jackpot').hidden = true;
    spinTo(res.roll);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      const L = R.LEVELS[res.level];
      revealLucky(res.lucky, res.jackpot);
      if (res.jackpot) {
        $('dice-caption').innerHTML = 'You rolled <strong>' + res.roll + '</strong> and the hidden number was ' + res.lucky + '!';
        $('jackpot-title').textContent = 'Jackpot! You choose your tiles.';
        const range = $('jackpot-count');
        range.min = res.chooseFrom; range.max = res.chooseTo;
        range.value = Math.min(res.chooseTo, Math.max(res.chooseFrom, 16));
        $('jackpot-out').textContent = range.value;
        $('jackpot').hidden = false;
      } else {
        $('dice-caption').innerHTML = 'You rolled <strong>' + res.roll + '</strong>, the hidden number was ' + res.lucky + '. ' +
          'That deals ' + res.letters.length + ' random tiles. Build a word of ' + L.minWord + '+ letters.';
        showDraw();
      }
    }, reduce ? 0 : 1350);
  }

  $('jackpot-count').addEventListener('input', e => { $('jackpot-out').textContent = e.target.value; });
  $('btn-claim').addEventListener('click', async () => {
    if (!deal || !deal.jackpot) return;
    const res = await api('claim', { deal: deal.dealId, count: $('jackpot-count').value });
    if (!res.ok) { $('create-error').textContent = res.error; return; }
    deal.letters = res.letters;
    $('jackpot').hidden = true;
    const L = R.LEVELS[deal.level];
    $('dice-caption').innerHTML = 'Jackpot <strong>' + deal.roll + '</strong>! You chose ' + res.letters.length +
      ' tiles. Build a word of ' + L.minWord + '+ letters.';
    showDraw();
  });

  function showDraw() {
    $('draw').hidden = false;
    $('btn-redraw').hidden = !deal.canRedraw;
    renderDraw();
  }

  $('dice').addEventListener('click', () => { if (!deal) roll(); });
  $('btn-redraw').addEventListener('click', () => { if (deal && deal.canRedraw) roll(deal.dealId); });
  $('btn-word-clear').addEventListener('click', () => { wordPick = []; renderDraw(); });

  function renderDraw() {
    if (!deal || !deal.letters.length) return;
    const L = R.LEVELS[deal.level];
    const rack = $('draw-rack');
    rack.innerHTML = '';
    fitTiles(rack, deal.letters.length, 44);
    deal.letters.forEach((letter, i) => {
      const t = tileEl(letter);
      if (wordPick.includes(i)) { t.classList.add('used'); t.tabIndex = -1; }
      t.addEventListener('click', () => {
        if (wordPick.includes(i) || wordPick.length >= R.MAX_WORD) return;
        wordPick.push(i); renderDraw();
      });
      rack.appendChild(t);
    });
    const slots = $('word-slots');
    slots.innerHTML = '';
    slots.style.setProperty('--tile', rack.style.getPropertyValue('--tile'));
    wordPick.forEach((idx, pos) => {
      const t = tileEl(deal.letters[idx]);
      t.setAttribute('aria-label', deal.letters[idx] + ', tap to remove');
      t.addEventListener('click', () => { wordPick.splice(pos, 1); renderDraw(); });
      slots.appendChild(t);
    });
    const n = wordPick.length;
    $('draw-count').textContent = deal.letters.length + ' tiles';
    $('word-count').textContent = n < L.minWord
      ? n + ' letters, need ' + (L.minWord - n) + ' more'
      : n + ' letters, worth up to ' + R.maxPoints(currentWord(), deal.level) + ' points';
  }

  function currentWord() {
    return deal ? wordPick.map(i => deal.letters[i]).join('') : '';
  }

  // Typing on the create screen picks matching tiles
  document.addEventListener('keydown', e => {
    if (current !== 'create' || !deal || $('draw').hidden) return;
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toUpperCase();
    if (/^[A-Z]$/.test(k)) {
      const idx = deal.letters.findIndex((l, i) => l === k && !wordPick.includes(i));
      if (idx > -1 && wordPick.length < R.MAX_WORD) { wordPick.push(idx); renderDraw(); }
    } else if (e.key === 'Backspace' && wordPick.length) {
      e.preventDefault(); wordPick.pop(); renderDraw();
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = form.elements;
    $('create-error').textContent = '';
    if (!deal) { $('create-error').textContent = 'Roll the die first.'; return; }
    if (!deal.letters.length) { $('create-error').textContent = 'Choose how many tiles you want first.'; return; }
    const word = currentWord();
    const L = R.LEVELS[deal.level];
    if (word.length < L.minWord) {
      $('create-error').textContent = deal.level + ' needs a word of at least ' + L.minWord + ' letters.';
      return;
    }
    const res = await api('create', {
      setter: f.setter.value, opponent: f.opponent.value, word, hint: L.hint ? f.hint.value : '', deal: deal.dealId
    });
    if (!res.ok) { $('create-error').textContent = res.error; return; }
    store.set('wc-name', f.setter.value.trim());
    showShare(res.id, f.opponent.value.trim(), res.maxPoints);
  });

  /* ---------- share ---------- */
  function showShare(id, opponent, maxPoints) {
    show('share');
    $('share-text').textContent = 'Send this code to ' + opponent + '. They have 23 hours to crack it, with up to ' + maxPoints + ' points to win.';
    const codeBox = $('share-code');
    codeBox.innerHTML = '';
    id.split('').forEach(c => codeBox.appendChild(tileEl(c, 'div')));
    const url = shareUrl(id);
    // Opponent-facing invite, in a cheeky British voice (one picked at random)
    const invites = [
      "Right then, I've set you a Word Challenge. Fancy your chances? You've got 23 hours to crack my secret word, so get your thinking cap on: ",
      "Oi! Word Challenge for you. Bet you can't crack this one. 23 hours, no pressure: ",
      "Alright? I've hidden a word in a pile of tiles. Have a go, if you're feeling brave. You've got 23 hours: ",
      "Go on then, clever clogs. Crack my secret word before the 23 hours are up: "
    ];
    const msg = invites[Math.floor(Math.random() * invites.length)] + url + ' (code ' + id + '). Cheers!';
    $('share-whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
    $('copied').textContent = '';
    $('share-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(url); $('copied').textContent = 'Link copied.'; }
      catch (e) { $('copied').textContent = url; }
    };
  }

  /* ---------- play ---------- */
  let game = null;
  let rack = [];      // [{letter, onBoard}]
  let board = {};     // "r,c" -> rack index
  let order = [];     // placement order, for Backspace
  let selected = null;
  let lastPlacement = null;

  $('code-form').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('code-input').value.trim().toUpperCase();
    if (code) openGame(code);
  });

  async function openGame(code) {
    const res = await api('game', { id: code });
    if (!res.ok) {
      show('home');
      $('code-input').value = code;
      alert(res.error);
      return;
    }
    history.replaceState(null, '', '?g=' + res.game.id);
    startGame(res.game);
  }

  function fitGrid() {
    const avail = Math.min($('view-play').clientWidth || 340, 560) + 12;
    const cell = Math.max(20, Math.min(40, Math.floor((avail - 12 - (R.SIZE - 1) * 2) / R.SIZE)));
    $('grid').style.setProperty('--cell', cell + 'px');
    $('grid').classList.toggle('small', cell < 26);
    fitTiles($('rack'), game ? game.tiles.length : 10, 48);
  }

  function startGame(g) {
    game = g;
    show('play');
    rack = g.tiles.map(letter => ({ letter, onBoard: false }));
    board = {}; order = []; selected = null; lastPlacement = null;
    const how = g.jackpot ? ' hit the hidden lucky number and chose ' + g.tiles.length + ' tiles'
      : g.dice ? ' rolled a <span class="mini-die" aria-label="' + g.dice + '">' + g.dice + '</span>for ' + g.tiles.length + ' tiles'
      : ' drew ' + g.tiles.length + ' tiles';
    $('play-from').innerHTML = 'Right then! <strong>' + esc(g.setter) + '</strong>' + how + ' and hid a ' + g.length +
      '-letter word <span class="level-tag ' + g.level + '">' + g.level + '</span>';
    $('play-hint').hidden = !g.hint;
    $('play-hint').textContent = g.hint ? 'Hint: ' + g.hint : '';
    $('play-error').textContent = '';
    const decoys = g.tiles.length - g.length;
    $('play-rule').textContent = 'Tap a tile, then a square. Pop the word in one line through the flower, reading across or down.' +
      (decoys > 0 ? ' Mind the ' + decoys + (decoys === 1 ? ' decoy, it\'s a sneaky one.' : ' decoys, they\'re sneaky.') : '');
    $('grid').classList.remove('won', 'shake');
    fitGrid();
    startClock(g);
    if (g.status !== 'Pending') return showResult(g, 'over');
    $('play-actions').hidden = false;
    $('rack').hidden = false;
    $('play-rule').hidden = false;
    $('play-result').hidden = true;
    renderBoard();
  }

  function premiumLabel(r, c) {
    if (r === R.CENTER && c === R.CENTER) return '';
    return { TW: '3W', DW: '2W', TL: '3L', DL: '2L' }[R.premiumAt(r, c)] || '';
  }

  function drawGrid(tilesAt, interactive) {
    const grid = $('grid');
    grid.innerHTML = '';
    grid.classList.toggle('picking', interactive);
    const names = { TW: 'triple word', DW: 'double word', TL: 'triple letter', DL: 'double letter' };
    for (let r = 0; r < R.SIZE; r++) {
      for (let c = 0; c < R.SIZE; c++) {
        const cell = document.createElement(interactive ? 'button' : 'div');
        if (interactive) cell.type = 'button';
        const p = R.premiumAt(r, c);
        const star = r === R.CENTER && c === R.CENTER;
        cell.className = 'cell' + (p ? ' ' + p : '') + (star ? ' star' : '');
        cell.setAttribute('role', 'gridcell');
        const letter = tilesAt(r, c);
        const where = 'Row ' + (r + 1) + ', column ' + (c + 1);
        if (letter) {
          cell.classList.add('filled');
          cell.appendChild(tileEl(letter, 'span'));
          cell.setAttribute('aria-label', where + ': ' + letter + (interactive ? ', tap to take back' : ''));
        } else {
          cell.textContent = premiumLabel(r, c);
          cell.setAttribute('aria-label', where + (star ? ', centre flower' : p ? ', ' + names[p] : ''));
        }
        if (interactive) cell.addEventListener('click', () => cellClick(r, c));
        grid.appendChild(cell);
      }
    }
  }

  function renderBoard() {
    drawGrid((r, c) => {
      const idx = board[r + ',' + c];
      return idx === undefined ? '' : rack[idx].letter;
    }, true);
    const rk = $('rack');
    rk.innerHTML = '';
    rack.forEach((t, idx) => {
      const el = tileEl(t.letter);
      if (t.onBoard) { el.classList.add('used'); el.tabIndex = -1; }
      if (selected === idx) el.classList.add('selected');
      el.addEventListener('click', () => { selected = selected === idx ? null : idx; renderBoard(); });
      rk.appendChild(el);
    });
    $('play-worth').textContent = 'Worth up to ' + game.maxPoints + ' points';
    $('play-tries').innerHTML = Array.from({ length: game.maxAttempts },
      (_, i) => '<i class="' + (i < game.attempts ? 'spent' : '') + '"></i>').join('');
    $('play-tries').setAttribute('aria-label', game.attemptsLeft + (game.attemptsLeft === 1 ? ' try left' : ' tries left'));
    $('btn-submit').disabled = order.length !== game.length;
    $('btn-submit').textContent = order.length > game.length
      ? 'Too many tiles (' + order.length + '/' + game.length + ')'
      : 'Check word';
  }

  function cellClick(r, c) {
    const key = r + ',' + c;
    $('play-error').textContent = '';
    if (board[key] !== undefined) {           // take a tile back
      rack[board[key]].onBoard = false;
      order = order.filter(k => k !== key);
      delete board[key];
      renderBoard();
      return;
    }
    let idx = selected;
    if (idx === null || rack[idx].onBoard) {
      $('play-error').textContent = 'Hang on, pick a tile from your rack first.';
      return;
    }
    board[key] = idx;
    rack[idx].onBoard = true;
    order.push(key);
    selected = null;
    renderBoard();
  }

  function clearBoard() {
    rack.forEach(t => { t.onBoard = false; });
    board = {}; order = []; selected = null;
    renderBoard();
  }

  $('btn-clear').addEventListener('click', clearBoard);
  $('btn-shuffle').addEventListener('click', () => {
    clearBoard();
    for (let i = rack.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rack[i], rack[j]] = [rack[j], rack[i]];
    }
    renderBoard();
  });

  $('btn-submit').addEventListener('click', submitGuess);

  async function submitGuess() {
    if (!game || game.status !== 'Pending' || order.length !== game.length) return;
    const cells = Object.keys(board).map(k => {
      const [r, c] = k.split(',').map(Number);
      return { r, c, letter: rack[board[k]].letter };
    });
    // Check the layout here first so a crooked word never costs a try
    const local = R.readPlacement(cells, game.length);
    if (!local.ok) { $('play-error').textContent = local.error; return; }
    lastPlacement = local.cells;
    const res = await api('guess', {
      id: game.id, player: store.get('wc-name'),
      cells: cells.map(t => t.r + ',' + t.c + ',' + t.letter).join(';')
    });
    if (!res.ok) { $('play-error').textContent = res.error; return; }
    game = res.game;
    if (res.result === 'wrong') {
      const g = $('grid');
      g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake');
      $('play-error').textContent = 'Not quite, mate. ' + local.word + " isn't it. " +
        (game.attemptsLeft === 1 ? 'Last go, make it count!' : game.attemptsLeft + ' goes left.');
      clearBoard();
      return;
    }
    showResult(game, res.result, res.boardScore);
  }

  function showResult(g, result, boardScore) {
    stopClock();
    $('play-actions').hidden = true;
    $('rack').hidden = true;
    $('play-rule').hidden = true;
    $('play-error').textContent = '';
    $('play-tries').innerHTML = '';
    $('play-worth').textContent = '';
    $('play-clock').textContent = '';

    // Show the word where it was placed, or across the centre
    const word = g.word || '';
    let cells = lastPlacement && lastPlacement.map(t => t.letter).join('') === word ? lastPlacement : null;
    if (!cells) {
      const start = Math.max(0, R.CENTER - Math.floor((word.length - 1) / 2));
      cells = word.split('').map((letter, i) => ({ r: R.CENTER, c: start + i, letter }));
    }
    const at = {};
    cells.forEach(t => { at[t.r + ',' + t.c] = t.letter; });
    drawGrid((r, c) => at[r + ',' + c] || '', false);
    if (g.status === 'Solved') $('grid').classList.add('won');

    const box = $('play-result');
    box.hidden = false;
    const again = '<button class="btn btn-primary" data-go="create">Get your own back</button>';
    if (g.status === 'Solved') {
      const L = R.LEVELS[g.level];
      const share = R.TRY_SHARE[L.tries][g.attempts - 1];
      const parts = [];
      if (boardScore) parts.push('Board score ' + boardScore);
      if (L.bonus !== 1) parts.push(g.level + ' bonus ×' + L.bonus);
      if (share !== 1) parts.push('try ' + g.attempts + ' keeps ' + Math.round(share * 100) + '%');
      box.innerHTML = '<img class="bloom" src="img/hibiscus.svg" alt=""><div class="points">+' + g.points + '</div>' +
        '<h2>' + (result === 'correct' ? 'Brilliant, you cracked it!' : esc(g.opponent) + ' cracked it') + '</h2>' +
        '<p class="detail">' + (parts.length ? parts.join(', ') + '. ' : '') +
        'Solved in ' + g.attempts + (g.attempts === 1 ? ' try' : ' tries') + '.</p>' + again;
    } else if (g.status === 'Expired') {
      box.innerHTML = '<h2>Out of time, I\'m afraid</h2><p>The 23 hours are up. The word was ' + esc(word) + '. Better luck next time.</p>' + again;
    } else {
      box.innerHTML = '<h2>' + (result === 'failed' ? 'Gutted, that\'s your lot' : 'This one\'s done and dusted') + '</h2>' +
        '<p>The word was ' + esc(word) + '. No points this time, but chin up.</p>' + again;
    }
  }

  /* ---------- 23-hour clock ---------- */
  let clockTimer = null;
  function fmtLeft(ms) {
    const m = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(m / 60);
    return h > 0 ? h + 'h ' + (m % 60) + 'm left' : (m % 60) + 'm left';
  }
  function startClock(g) {
    stopClock();
    const el = $('play-clock');
    if (g.status !== 'Pending' || !g.expiresAt) { el.textContent = ''; return; }
    const end = new Date(g.expiresAt).getTime();
    const tick = () => {
      const left = end - Date.now();
      el.textContent = fmtLeft(left) + ' on the clock';
      el.classList.toggle('urgent', left < 3600000);
      if (left <= 0) {
        stopClock();
        api('game', { id: game.id }).then(r => { if (r.ok) { game = r.game; showResult(game, 'over'); } });
      }
    };
    tick();
    clockTimer = setInterval(tick, 30000);
  }
  function stopClock() { if (clockTimer) clearInterval(clockTimer); clockTimer = null; }

  // Keyboard on the board: type a letter to pick that tile, Backspace takes the last one back, Enter checks
  document.addEventListener('keydown', e => {
    if (current !== 'play' || !game || game.status !== 'Pending') return;
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toUpperCase();
    if (/^[A-Z]$/.test(k)) {
      const idx = rack.findIndex(t => !t.onBoard && t.letter === k);
      if (idx > -1) { selected = idx; renderBoard(); }
    } else if (e.key === 'Backspace' && order.length) {
      const [r, c] = order[order.length - 1].split(',').map(Number);
      cellClick(r, c);
    } else if (e.key === 'Enter' && !$('btn-submit').disabled) {
      submitGuess();
    }
  });

  window.addEventListener('resize', () => {
    if (game && current === 'play') fitGrid();
    if (deal && current === 'create') renderDraw();
  });

  /* ---------- inbox ---------- */
  $('inbox-form').addEventListener('submit', e => {
    e.preventDefault();
    const n = e.target.elements.name.value.trim();
    if (!n) return;
    store.set('wc-name', n);
    loadInbox(n);
  });

  async function loadInbox(name) {
    const res = await api('inbox', { name });
    const box = $('inbox-list');
    if (!res.ok) { box.innerHTML = '<p class="empty">' + esc(res.error) + '</p>'; return; }
    const row = (g, mine) => {
      const who = mine ? 'From ' + esc(g.setter) : 'To ' + esc(g.opponent);
      const label = g.status === 'Pending' ? (mine ? 'Play' : 'Waiting') : g.status;
      const left = g.status === 'Pending' && g.expiresAt ? ', ' + fmtLeft(new Date(g.expiresAt) - Date.now()) : '';
      const sub = g.level + ', ' + g.length + ' letters' + (g.points ? ', ' + g.points + ' pts' : '') +
        (!mine && g.word ? ', ' + esc(g.word) : '') + left;
      return '<a class="game-row" href="?g=' + g.id + '"><span><span class="who">' + who + '</span><br><span class="sub">' +
        sub + '</span></span><span class="status ' + g.status + '">' + label + '</span></a>';
    };
    const toPlay = res.toPlay.slice().sort((a, b) => (b.status === 'Pending') - (a.status === 'Pending'));
    box.innerHTML =
      '<h2 class="list-title">For you to solve</h2>' +
      (toPlay.length ? toPlay.map(g => row(g, true)).join('') : '<p class="empty">Nothing yet. Ask a friend to send you a word.</p>') +
      '<h2 class="list-title">You sent</h2>' +
      (res.sent.length ? res.sent.map(g => row(g, false)).join('') : '<p class="empty">You haven\'t sent a challenge yet.</p>');
  }

  /* ---------- leaderboard ---------- */
  async function loadLeaderboard() {
    const res = await api('leaderboard');
    const list = $('leaders');
    if (!res.ok) { list.innerHTML = '<p class="empty">' + esc(res.error) + '</p>'; return; }
    list.innerHTML = res.leaderboard.length
      ? res.leaderboard.map(p => '<li><span>' + esc(p.player) + '<span class="solved">' + p.solved +
          (p.solved === 1 ? ' word' : ' words') + ' solved</span></span><span class="pts">' + p.points + '</span></li>').join('')
      : '<p class="empty">No one has solved a word yet. Send the first challenge.</p>';
  }

  /* ---------- boot ---------- */
  if (DEMO) $('demo-banner').hidden = false;
  window.WordChallenge = { ready: true };
  const code = new URLSearchParams(location.search).get('g');
  if (code) openGame(code.toUpperCase()); else show('home');
})();
