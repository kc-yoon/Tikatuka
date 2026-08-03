// ==================== DICE HELPERS ====================

const PIP_MAP = {
  1: [4], 2: [2, 6], 3: [2, 4, 6],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
};

function dieInner(value) {
  const on = new Set(PIP_MAP[value] || []);
  let h = '';
  for (let i = 0; i < 9; i++) h += '<span class="' + (on.has(i) ? 'on' : '') + '"></span>';
  return h;
}

function setDie(el, value, opp) {
  el.setAttribute('data-pips', value);
  el.classList.toggle('opp', !!opp);
  el.innerHTML = dieInner(value);
}

// ==================== GAME RULES ====================
// A die is { v: 1..6, im: immune(무적, cannot be removed by 알까기) }.
// Column score: for each group of n same-value dice → v × (2n − 1).

function columnScore(col) {
  const counts = {};
  for (const d of col) counts[d.v] = (counts[d.v] || 0) + 1;
  let s = 0;
  for (const v in counts) { const k = counts[v]; s += Number(v) * (2 * k - 1); }
  return s;
}

function playerScore(grid) {
  return grid.reduce((sum, col) => sum + columnScore(col), 0);
}

function fieldFull(grid) {
  return grid.every(col => col.length >= 3);
}

function validColumns(grid) {
  const cols = [];
  for (let c = 0; c < 3; c++) if (grid[c].length < 3) cols.push(c);
  return cols;
}

function maxBy(arr, fn) {
  let best = arr[0], bestVal = -Infinity;
  for (const x of arr) { const v = fn(x); if (v > bestVal) { bestVal = v; best = x; } }
  return best;
}

// does opponent column `col` contain a removable (non-immune) die of value v?
function hasKill(grid, col, v) {
  return grid[col].some(d => !d.im && d.v === v);
}

// ==================== NETWORK ====================

class Net {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.onGameStart = null;
    this.onAction = null;
    this.onDisconnect = null;
    this.onRematch = null;
    this.onRematchStart = null;
    this.onChat = null;
  }

  connect() {
    return new Promise((resolve) => {
      if (this.socket && this.connected) return resolve(true);
      this.socket = io();
      this.socket.on('connect', () => { this.connected = true; resolve(true); });
      this.socket.on('gameStart', (d) => { if (this.onGameStart) this.onGameStart(d); });
      this.socket.on('gameAction', (d) => { if (this.onAction) this.onAction(d); });
      this.socket.on('opponentLeft', () => { if (this.onDisconnect) this.onDisconnect(); });
      this.socket.on('rematchRequested', () => { if (this.onRematch) this.onRematch(); });
      this.socket.on('rematchStart', () => { if (this.onRematchStart) this.onRematchStart(); });
      this.socket.on('chatMessage', (d) => { if (this.onChat) this.onChat(d); });
    });
  }

  createRoom(nickname) {
    return new Promise((resolve) => {
      this.socket.emit('createRoom', { nickname });
      this.socket.once('roomCreated', (d) => resolve(d));
    });
  }

  joinRoom(code, nickname) {
    return new Promise((resolve, reject) => {
      this.socket.emit('joinRoom', { code, nickname });
      this.socket.once('roomJoined', (d) => resolve(d));
      this.socket.once('roomError', (msg) => reject(msg));
    });
  }

  sendAction(data) { if (this.socket) this.socket.emit('gameAction', data); }
  sendRematch() { if (this.socket) this.socket.emit('rematch'); }
  acceptRematch() { if (this.socket) this.socket.emit('rematchAccept'); }
  sendChat(text) { if (this.socket) this.socket.emit('chatMessage', text); }
  disconnect() { if (this.socket) { this.socket.disconnect(); this.socket = null; this.connected = false; } }
}

// ==================== APP ====================

class App {
  constructor() {
    this.net = new Net();
    this.mode = null;
    this.grids = null;
    this.turn = 0;
    this.currentDie = 0;
    this.gameOver = false;
    this.rolling = false;
    this.awaitingRoll = false;
    this.placeAnywhere = false;   // phase 2: placing the immune reroll die

    this.rerollUsed = [false, false];
    this.held = [false, false];
    this.immuneFirstUsed = false;  // starting player's first die is immune

    this.myPlayer = 0;
    this.aiPlayer = 1;
    this.difficulty = 'medium';
    this.names = ['Player 1', 'Player 2'];
    this.lastPlaced = null;
    this.pendingRematch = false;
    this.chatUnread = 0;

    this.nickname = localStorage.getItem('tikatuka_nickname') || '';
    this.bindNet();
    this.initUI();
  }

  // ---------- init ----------
  initUI() {
    document.querySelectorAll('.logo-dice .die-face').forEach((el, i) => {
      setDie(el, i === 0 ? 5 : 3, i === 1);
      if (i === 1) el.classList.add('alt');
    });
    document.getElementById('room-code-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.joinRoom();
    });
    document.getElementById('password-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.login();
    });
    document.getElementById('die-stage').addEventListener('click', () => this.doRoll());
    const onResize = () => this.sizeBoards();
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    if (this.nickname) this.showMenuButtons();
  }

  sizeBoards() {
    const layout = document.querySelector('#screen-game .game-layout');
    if (!layout || !document.getElementById('screen-game').classList.contains('active')) return;
    const vw = Math.min(window.innerWidth, 460);
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const root = document.documentElement;
    let cell = Math.min(Math.floor((vw - 34) / 3), Math.floor((vh - 150) / 6), 88);
    cell = Math.max(cell, 32);
    root.style.setProperty('--cell', cell + 'px');
    for (let i = 0; i < 60 && cell > 30; i++) {
      if (layout.scrollHeight <= layout.clientHeight + 1) break;
      cell -= 2;
      root.style.setProperty('--cell', cell + 'px');
    }
  }

  // ---------- auth ----------
  async login() {
    const name = document.getElementById('nickname-input').value.trim();
    const pw = document.getElementById('password-input').value.trim();
    const msg = document.getElementById('auth-msg');
    if (!name || !pw) { msg.textContent = '닉네임과 비밀번호를 입력해주세요.'; msg.className = 'nickname-msg error'; return; }
    try {
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: name, password: pw })
      });
      const data = await res.json();
      if (!data.ok) { msg.textContent = data.reason || '로그인 실패'; msg.className = 'nickname-msg error'; return; }
      this.nickname = data.nickname;
      localStorage.setItem('tikatuka_nickname', data.nickname);
      msg.textContent = '';
      this.showMenuButtons();
    } catch {
      msg.textContent = '서버 연결 실패. 다시 시도해주세요.'; msg.className = 'nickname-msg error';
    }
  }

  async register() {
    const name = document.getElementById('nickname-input').value.trim();
    const pw = document.getElementById('password-input').value.trim();
    const msg = document.getElementById('auth-msg');
    if (!name || name.length < 2 || name.length > 12) { msg.textContent = '닉네임은 2~12자로 입력해주세요.'; msg.className = 'nickname-msg error'; return; }
    if (!pw || pw.length < 4 || pw.length > 20) { msg.textContent = '비밀번호는 4~20자로 입력해주세요.'; msg.className = 'nickname-msg error'; return; }
    try {
      const res = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: name, password: pw })
      });
      const data = await res.json();
      if (!data.ok) { msg.textContent = data.reason || '회원가입 실패'; msg.className = 'nickname-msg error'; return; }
      this.nickname = data.nickname;
      localStorage.setItem('tikatuka_nickname', data.nickname);
      msg.textContent = '';
      this.showMenuButtons();
    } catch {
      msg.textContent = '서버 연결 실패. 다시 시도해주세요.'; msg.className = 'nickname-msg error';
    }
  }

  showMenuButtons() {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('menu-buttons').style.display = '';
    document.getElementById('welcome-msg').textContent = this.nickname + '님 환영합니다!';
  }

  logout() {
    this.nickname = '';
    localStorage.removeItem('tikatuka_nickname');
    document.getElementById('password-input').value = '';
    document.getElementById('auth-section').style.display = '';
    document.getElementById('menu-buttons').style.display = 'none';
  }

  async showLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '<p class="dim">불러오는 중...</p>';
    this.showScreen('screen-leaderboard');
    try {
      const res = await fetch('/api/leaderboard');
      const rows = await res.json();
      if (!rows.length) { list.innerHTML = '<p class="dim">아직 기록이 없습니다.</p>'; return; }
      let html = '<div class="lb-row lb-head"><span class="lb-rank">#</span><span class="lb-name">닉네임</span><span class="lb-w">승</span><span class="lb-l">패</span></div>';
      rows.forEach((r, i) => {
        const me = r.nickname === this.nickname ? ' me' : '';
        html += '<div class="lb-row' + me + '"><span class="lb-rank">' + (i + 1) + '</span>' +
                '<span class="lb-name"></span><span class="lb-w">' + r.wins + '</span>' +
                '<span class="lb-l">' + r.losses + '</span></div>';
      });
      list.innerHTML = html;
      const nameCells = list.querySelectorAll('.lb-row:not(.lb-head) .lb-name');
      rows.forEach((r, i) => { if (nameCells[i]) nameCells[i].textContent = r.nickname; });
    } catch {
      list.innerHTML = '<p class="dim">불러오기 실패</p>';
    }
  }

  bindNet() {
    this.net.onGameStart = (d) => this.onOnlineStart(d);
    this.net.onAction = (d) => this.onNetAction(d);
    this.net.onDisconnect = () => this.onOpponentLeft();
    this.net.onRematch = () => this.onRematchRequested();
    this.net.onRematchStart = () => this.startRematch();
    this.net.onChat = (d) => this.receiveChat(d);
  }

  // ---------- screens ----------
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }
  showMenu() {
    if (this.mode === 'online') this.net.disconnect();
    this.mode = null;
    this.closeOverlay();
    this.showScreen('screen-menu');
  }
  showRules() { document.getElementById('overlay-rules').classList.add('active'); }
  closeOverlay() { document.querySelectorAll('.overlay').forEach(o => o.classList.remove('active')); }
  showAISetup() { this.showScreen('screen-ai'); }

  async showOnlineLobby() {
    document.getElementById('lobby-message').textContent = '';
    this.showScreen('screen-online');
    await this.net.connect();
  }

  // ---------- online lobby ----------
  async createRoom() {
    await this.net.connect();
    const d = await this.net.createRoom(this.nickname || 'Player 1');
    this.myPlayer = 0;
    this.pendingCode = d.code;
    document.getElementById('room-code-display').textContent = d.code;
    this.showScreen('screen-waiting');
  }

  async joinRoom() {
    const code = document.getElementById('room-code-input').value.toUpperCase().trim();
    const msg = document.getElementById('lobby-message');
    if (code.length !== 4) { msg.textContent = '4자리 코드를 입력하세요.'; return; }
    try {
      await this.net.connect();
      const d = await this.net.joinRoom(code, this.nickname || 'Player 2');
      this.myPlayer = d.playerNumber - 1;
    } catch (err) {
      msg.textContent = err || '참가 실패';
    }
  }

  copyRoomCode() {
    const code = document.getElementById('room-code-display').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
  }

  leaveRoom() { this.net.disconnect(); this.showMenu(); }

  onOnlineStart(data) {
    this.mode = 'online';
    const nn = data.nicknames || {};
    this.names = [nn[1] || 'Player 1', nn[2] || 'Player 2'];
    document.getElementById('btn-chat-toggle').style.display = '';
    this.startGame();
  }

  // ---------- start modes ----------
  startAI(difficulty) {
    this.mode = 'ai';
    this.difficulty = difficulty;
    this.myPlayer = 0;
    this.aiPlayer = 1;
    const diffName = { easy: '쉬움', medium: '보통', hard: '어려움' }[difficulty];
    this.names = [this.nickname || '나', 'AI · ' + diffName];
    document.getElementById('btn-chat-toggle').style.display = 'none';
    this.startGame();
  }

  startLocal() {
    this.mode = 'local';
    this.myPlayer = 0;
    this.names = ['Player 1', 'Player 2'];
    document.getElementById('btn-chat-toggle').style.display = 'none';
    this.startGame();
  }

  startGame() {
    this.grids = [[[], [], []], [[], [], []]];
    this.turn = 0;
    this.currentDie = 0;
    this.gameOver = false;
    this.placeAnywhere = false;
    this.lastPlaced = null;
    this.pendingRematch = false;
    this.rerollUsed = [false, false];
    this.held = [false, false];
    this.immuneFirstUsed = false;
    document.getElementById('chat-messages').innerHTML = '';
    this.closeOverlay();
    this.setupBoardLabels();
    this.renderBoards();
    const h2h = document.getElementById('h2h-record');
    h2h.style.display = 'none';
    h2h.textContent = '';
    this.showScreen('screen-game');
    this.sizeBoards();
    if (this.mode === 'online') this.loadH2H();
    this.startTurn();
  }

  async loadH2H() {
    const opponent = this.names[1 - this.myPlayer];
    const me = this.nickname;
    if (!opponent || !me) return;
    try {
      const res = await fetch('/api/h2h?player=' + encodeURIComponent(me) +
                              '&opponent=' + encodeURIComponent(opponent));
      const d = await res.json();
      const el = document.getElementById('h2h-record');
      el.textContent = '상대전적 ' + d.wins + '승 ' + d.losses + '패';
      el.style.display = '';
      this.sizeBoards();
    } catch {}
  }

  // ---------- perspective ----------
  bottomPlayer() { return this.mode === 'online' ? this.myPlayer : 0; }
  topPlayer() { return 1 - this.bottomPlayer(); }
  isBottom(player) { return player === this.bottomPlayer(); }

  humanControlsActive() {
    if (this.gameOver || !this.currentDie) return false;
    if (this.mode === 'ai') return this.turn === this.myPlayer;
    if (this.mode === 'online') return this.turn === this.myPlayer;
    return true;
  }

  // do I generate randomness (rolls) for the current turn?
  generatesRandomness() {
    return this.mode !== 'online' || this.turn === this.myPlayer;
  }

  // ---------- turn flow ----------
  startTurn() {
    if (this.gameOver) return;
    this.currentDie = 0;
    this.awaitingRoll = false;
    this.placeAnywhere = false;
    this.renderDie(0, false);
    this.updateTurnUI();
    this.disablePlacement();

    // Hold: skip held player's turns
    if (this.held[this.turn]) {
      if (this.held[1 - this.turn]) { this.endGame(); return; }
      this.turn = 1 - this.turn;
      setTimeout(() => this.startTurn(), 200);
      return;
    }

    if (this.mode === 'ai') {
      if (this.turn === this.aiPlayer) this.rollDie(() => this.scheduleAIMove());
      else this.promptRoll();
    } else if (this.mode === 'local') {
      this.promptRoll();
    } else {
      if (this.turn === this.myPlayer) this.promptRoll();
    }
  }

  promptRoll() {
    this.awaitingRoll = true;
    this.renderDie(0, !this.isBottom(this.turn));
    document.getElementById('die-stage').classList.add('rollable');
    const label = document.getElementById('turn-label');
    label.classList.add('my-turn');
    const who = this.mode === 'local' ? this.names[this.turn] + ' · ' : '';
    label.textContent = who + '주사위를 탭하세요';
  }

  doRoll() {
    if (!this.awaitingRoll || this.rolling || this.gameOver) return;
    this.awaitingRoll = false;
    document.getElementById('die-stage').classList.remove('rollable');
    this.rollDie((v) => {
      if (this.mode === 'online' && this.turn === this.myPlayer) {
        this.net.sendAction({ type: 'roll', player: this.myPlayer, die: v });
      }
      this.enablePlacement();
    });
  }

  doReroll() {
    if (this.gameOver || this.rolling || !this.currentDie || this.placeAnywhere) return;
    if (!this.humanControlsActive()) return;
    const p = this.turn;
    if (this.rerollUsed[p]) return;
    this.rerollUsed[p] = true;
    this.disablePlacement();
    this.rollDie((v) => {
      if (this.mode === 'online') this.net.sendAction({ type: 'roll', player: p, die: v });
      this.enablePlacement();
    });
  }

  doHold() {
    if (this.gameOver || this.placeAnywhere) return;
    if (!this.humanControlsActive()) return;
    const p = this.turn;
    this.held[p] = true;
    if (this.mode === 'online') this.net.sendAction({ type: 'hold', player: p });
    this.currentDie = 0;
    this.disablePlacement();
    this.renderDie(0, false);
    if (this.held[1 - p]) { this.endGame(); return; }
    this.turn = 1 - p;
    setTimeout(() => this.startTurn(), 250);
  }

  rollDie(cb) {
    this.rolling = true;
    const v = 1 + Math.floor(Math.random() * 6);
    const el = document.getElementById('current-die');
    const opp = !this.isBottom(this.turn);
    el.classList.remove('rolling');
    void el.offsetWidth;
    el.classList.add('rolling');
    let ticks = 0;
    const iv = setInterval(() => {
      setDie(el, 1 + Math.floor(Math.random() * 6), opp);
      if (++ticks >= 9) {
        clearInterval(iv);
        this.currentDie = v;
        this.renderDie(v, opp);
        el.classList.remove('rolling');
        this.rolling = false;
        if (cb) cb(v);
      }
    }, 75);
  }

  renderDie(value, opp) { setDie(document.getElementById('current-die'), value, opp); }

  // ---------- placement ----------
  place(owner, col) {
    if (this.gameOver || this.rolling || !this.currentDie) return;
    if (!this.humanControlsActive()) return;
    if (this.grids[owner][col].length >= 3) return;

    if (this.placeAnywhere) {
      if (this.mode === 'online') this.net.sendAction({ type: 'place2', player: this.turn, owner, col, v: this.currentDie });
      this.applyPhase2(owner, col, this.currentDie);
      return;
    }
    if (owner !== this.turn) return;
    const im = (this.turn === 0 && !this.immuneFirstUsed);
    if (this.mode === 'online') this.net.sendAction({ type: 'place1', player: this.turn, col, v: this.currentDie, im });
    this.applyPhase1(this.turn, col, { v: this.currentDie, im });
  }

  // phase 1: placing the rolled die into your own column (may trigger 알까기)
  applyPhase1(placer, col, die) {
    if (this.gameOver) return;
    this.grids[placer][col].push(die);
    if (placer === 0 && die.im) this.immuneFirstUsed = true;

    let removed = 0;
    if (!die.im) {
      const opp = 1 - placer;
      const before = this.grids[opp][col].length;
      this.grids[opp][col] = this.grids[opp][col].filter(d => d.im || d.v !== die.v);
      removed = before - this.grids[opp][col].length;
    }

    if (removed > 0) {
      // 알까기: your die is also removed, then reroll an immune die placed anywhere
      this.grids[placer][col].pop();
      this.currentDie = 0;
      this.lastPlaced = null;
      this.disablePlacement();
      this.renderBoards();
      this.flashKill(1 - placer, col);
      setTimeout(() => this.afterKillReroll(), 480);
    } else {
      this.lastPlaced = { player: placer, col };
      this.finishPlacement();
    }
  }

  afterKillReroll() {
    if (this.gameOver) return;
    if (!this.generatesRandomness()) return; // opponent will send reroll2 + place2
    this.rollDie((Y) => {
      this.placeAnywhere = true;
      if (this.mode === 'online') this.net.sendAction({ type: 'reroll2', player: this.turn, die: Y });
      if (this.mode === 'ai' && this.turn === this.aiPlayer) setTimeout(() => this.aiPlaceY(), 500);
      else this.enablePlacement();
    });
  }

  // phase 2: place the immune reroll die into any column
  applyPhase2(owner, col, v) {
    if (this.gameOver) return;
    this.grids[owner][col].push({ v, im: true });
    this.lastPlaced = { player: owner, col };
    this.finishPlacement();
  }

  finishPlacement() {
    this.currentDie = 0;
    this.placeAnywhere = false;
    this.disablePlacement();
    this.renderBoards();
    this.renderDie(0, false);
    if (fieldFull(this.grids[0]) || fieldFull(this.grids[1])) { this.endGame(); return; }
    this.turn = 1 - this.turn;
    setTimeout(() => this.startTurn(), 350);
  }

  // ---------- AI ----------
  scheduleAIMove() { setTimeout(() => this.aiAct(), 700); }

  aiAct() {
    if (this.gameOver) return;
    const ai = this.aiPlayer;
    if (this.difficulty === 'hard' && this.currentDie <= 2 && !this.rerollUsed[ai]) {
      this.rerollUsed[ai] = true;
      this.rollDie(() => setTimeout(() => this.aiPlace1(), 450));
      return;
    }
    this.aiPlace1();
  }

  aiPlace1() {
    if (this.gameOver) return;
    const ai = this.aiPlayer, opp = 1 - ai, X = this.currentDie;
    const cols = validColumns(this.grids[ai]);
    if (cols.length === 0) return;
    const killCols = cols.filter(c => hasKill(this.grids[opp], c, X));
    let choice;
    if (killCols.length && this.difficulty !== 'easy') {
      // 알까기 the column that destroys the most opponent points
      choice = maxBy(killCols, c => {
        const after = this.grids[opp][c].filter(d => d.im || d.v !== X);
        return columnScore(this.grids[opp][c]) - columnScore(after);
      });
    } else {
      // otherwise place where it adds the most of my own score
      choice = maxBy(cols, c =>
        columnScore(this.grids[ai][c].concat({ v: X, im: false })) - columnScore(this.grids[ai][c]));
    }
    this.applyPhase1(ai, choice, { v: X, im: false });
  }

  aiPlaceY() {
    if (this.gameOver) return;
    const ai = this.aiPlayer, opp = 1 - ai, Y = this.currentDie;
    if (Y <= 2) {
      const oc = validColumns(this.grids[opp]);
      if (oc.length) { this.applyPhase2(opp, maxBy(oc, c => columnScore(this.grids[opp][c])), Y); return; }
    }
    const mc = validColumns(this.grids[ai]);
    if (mc.length) {
      const c = maxBy(mc, c => columnScore(this.grids[ai][c].concat({ v: Y, im: true })) - columnScore(this.grids[ai][c]));
      this.applyPhase2(ai, c, Y); return;
    }
    const oc = validColumns(this.grids[opp]);
    if (oc.length) this.applyPhase2(opp, oc[0], Y);
  }

  // ---------- network actions ----------
  onNetAction(d) {
    if (this.mode !== 'online') return;
    if (d.type === 'roll') {
      this.turn = d.player;
      this.currentDie = d.die;
      this.updateTurnUI();
      this.renderDie(d.die, !this.isBottom(d.player));
    } else if (d.type === 'place1') {
      this.turn = d.player;
      this.applyPhase1(d.player, d.col, { v: d.v, im: !!d.im });
    } else if (d.type === 'reroll2') {
      this.turn = d.player;
      this.currentDie = d.die;
      this.placeAnywhere = true;
      this.renderDie(d.die, !this.isBottom(d.player));
      this.updateTurnUI();
    } else if (d.type === 'place2') {
      this.turn = d.player;
      this.applyPhase2(d.owner, d.col, d.v);
    } else if (d.type === 'hold') {
      this.held[d.player] = true;
    }
  }

  onOpponentLeft() {
    if (this.mode !== 'online') return;
    this.gameOver = true;
    this.showGameOverBox('👋', '상대가 나갔어요', '상대방과의 연결이 끊어졌습니다.', false);
  }

  // ---------- render ----------
  setupBoardLabels() {
    document.getElementById('name-bottom').textContent = this.names[this.bottomPlayer()];
    document.getElementById('name-top').textContent = this.names[this.topPlayer()];
  }

  renderBoards() {
    this.renderBoard(document.getElementById('board-bottom'), this.bottomPlayer(), true);
    this.renderBoard(document.getElementById('board-top'), this.topPlayer(), false);
    document.getElementById('total-bottom').textContent = playerScore(this.grids[this.bottomPlayer()]);
    document.getElementById('total-top').textContent = playerScore(this.grids[this.topPlayer()]);
  }

  renderBoard(el, player, isBottom) {
    const grid = this.grids[player];
    const opp = !isBottom;
    let html = '';
    for (let c = 0; c < 3; c++) {
      const col = grid[c];
      const scoreLabel = '<div class="col-score">' + (col.length ? columnScore(col) : '') + '</div>';
      let slots = '';
      for (let row = 0; row < 3; row++) {
        let d = null;
        if (isBottom) { const idx = col.length - (3 - row); if (idx >= 0) d = col[idx]; }
        else { if (row < col.length) d = col[row]; }
        if (d) {
          const isNew = this.lastPlaced && this.lastPlaced.player === player &&
                        this.lastPlaced.col === c && this.isTopOfStack(col, isBottom, row);
          const cls = 'die-face' + (opp ? ' opp' : '') + (d.im ? ' immune' : '') + (isNew ? ' pop' : '');
          slots += '<div class="slot"><div class="' + cls + '" data-pips="' + d.v + '">' + dieInner(d.v) + '</div></div>';
        } else {
          slots += '<div class="slot"></div>';
        }
      }
      const inner = isBottom ? (slots + scoreLabel) : (scoreLabel + slots);
      html += '<div class="board-col" data-col="' + c + '">' + inner + '</div>';
    }
    el.innerHTML = html;
  }

  isTopOfStack(col, isBottom, row) {
    if (isBottom) { const idx = col.length - (3 - row); return idx === col.length - 1; }
    return row === col.length - 1;
  }

  flashKill(owner, col) {
    const id = this.isBottom(owner) ? 'board-bottom' : 'board-top';
    const cE = document.querySelector('#' + id + ' .board-col[data-col="' + col + '"]');
    if (cE) { cE.classList.remove('killed'); void cE.offsetWidth; cE.classList.add('killed'); }
  }

  colorWonColumns() {
    for (let c = 0; c < 3; c++) {
      const s0 = columnScore(this.grids[0][c]), s1 = columnScore(this.grids[1][c]);
      const winner = s0 > s1 ? 0 : s1 > s0 ? 1 : null;
      [['board-bottom', this.bottomPlayer()], ['board-top', this.topPlayer()]].forEach(([id, owner]) => {
        const cE = document.querySelector('#' + id + ' .board-col[data-col="' + c + '"]');
        if (!cE) return;
        cE.classList.remove('col-won', 'col-lost');
        if (winner === null) return;
        cE.classList.add(winner === owner ? 'col-won' : 'col-lost');
      });
    }
  }

  updateTurnUI() {
    const bottomEl = document.getElementById('panel-bottom');
    const topEl = document.getElementById('panel-top');
    bottomEl.classList.remove('active-turn', 'opp-turn');
    topEl.classList.remove('active-turn', 'opp-turn');
    if (this.gameOver) return;
    if (this.isBottom(this.turn)) bottomEl.classList.add('active-turn');
    else topEl.classList.add('active-turn', 'opp-turn');

    const label = document.getElementById('turn-label');
    label.classList.remove('my-turn');
    if (this.mode === 'local') {
      label.textContent = this.names[this.turn] + ' 차례';
      label.classList.add('my-turn');
    } else if (this.turn === this.myPlayer) {
      label.textContent = '내 차례 · 열을 선택하세요';
      label.classList.add('my-turn');
    } else {
      label.textContent = this.names[this.turn] + ' 차례...';
    }
  }

  makeClickable(owner) {
    const id = this.isBottom(owner) ? 'board-bottom' : 'board-top';
    const el = document.getElementById(id);
    el.classList.add('can-place');
    const grid = this.grids[owner];
    el.querySelectorAll('.board-col').forEach((cE) => {
      const c = Number(cE.dataset.col);
      if (grid[c].length < 3) { cE.classList.add('placeable'); cE.onclick = () => this.place(owner, c); }
    });
  }

  enablePlacement() {
    this.updateTurnUI();
    this.clearColumnHandlers();
    const rerollBtn = document.getElementById('btn-reroll');
    const holdBtn = document.getElementById('btn-hold');
    if (!this.humanControlsActive()) { rerollBtn.style.display = 'none'; holdBtn.style.display = 'none'; return; }
    const p = this.turn;

    if (this.placeAnywhere) {
      document.getElementById('turn-label').textContent = '🎯 새 무적 주사위를 아무 칸에나!';
      rerollBtn.style.display = 'none';
      holdBtn.style.display = 'none';
      this.makeClickable(this.bottomPlayer());
      this.makeClickable(this.topPlayer());
    } else {
      rerollBtn.style.display = this.rerollUsed[p] ? 'none' : '';
      holdBtn.style.display = '';
      this.makeClickable(p);
    }
  }

  clearColumnHandlers() {
    ['board-bottom', 'board-top'].forEach(id => {
      const el = document.getElementById(id);
      el.classList.remove('can-place');
      el.querySelectorAll('.board-col').forEach(cE => { cE.classList.remove('placeable'); cE.onclick = null; });
    });
  }

  disablePlacement() {
    this.clearColumnHandlers();
    document.getElementById('btn-reroll').style.display = 'none';
    document.getElementById('btn-hold').style.display = 'none';
  }

  // ---------- game over ----------
  lineResult() {
    let w0 = 0, w1 = 0, m0 = 0, m1 = 0;
    for (let c = 0; c < 3; c++) {
      const s0 = columnScore(this.grids[0][c]), s1 = columnScore(this.grids[1][c]);
      if (s0 > s1) { w0++; m0 += s0 - s1; }
      else if (s1 > s0) { w1++; m1 += s1 - s0; }
    }
    const t0 = playerScore(this.grids[0]), t1 = playerScore(this.grids[1]);
    let winner = null;
    if (w0 > w1) winner = 0;
    else if (w1 > w0) winner = 1;
    else if (m0 > m1) winner = 0;       // 1:1 → bigger winning margin
    else if (m1 > m0) winner = 1;
    return { w0, w1, t0, t1, winner };
  }

  endGame() {
    this.gameOver = true;
    this.disablePlacement();
    this.updateTurnUI();
    this.renderBoards();
    this.colorWonColumns();

    const { w0, w1, t0, t1, winner } = this.lineResult();
    let icon, title, msg;
    if (this.mode === 'local') {
      if (winner === null) { icon = '🤝'; title = '무승부'; }
      else { icon = '🏆'; title = this.names[winner] + ' 승리!'; }
      msg = '라인 ' + w0 + ':' + w1 + ' · 총점 ' + t0 + ':' + t1;
    } else {
      const myP = this.myPlayer;
      const myL = myP === 0 ? w0 : w1, oppL = myP === 0 ? w1 : w0;
      const myT = myP === 0 ? t0 : t1, oppT = myP === 0 ? t1 : t0;
      if (winner === null) { icon = '🤝'; title = '무승부'; }
      else if (winner === myP) { icon = '🏆'; title = '승리!'; }
      else { icon = '😢'; title = '패배'; }
      msg = '라인 ' + myL + ':' + oppL + ' · 총점 ' + myT + ':' + oppT;
      if (this.mode === 'online' && winner !== null) this.reportOnlineResult(winner === myP);
    }
    this.showGameOverBox(icon, title, msg, true);
  }

  reportOnlineResult(won) {
    if (!this.nickname) return;
    const opponent = this.names[1 - this.myPlayer];
    fetch('/api/online-result', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: this.nickname, opponent, won })
    }).catch(() => {});
  }

  showGameOverBox(icon, title, msg, allowRematch) {
    document.getElementById('gameover-icon').textContent = icon;
    document.getElementById('gameover-title').textContent = title;
    document.getElementById('gameover-message').textContent = msg;
    document.getElementById('btn-rematch').style.display = allowRematch ? '' : 'none';
    document.getElementById('btn-rematch').disabled = false;
    document.getElementById('btn-rematch').textContent = '다시 하기';
    setTimeout(() => document.getElementById('overlay-gameover').classList.add('active'), 700);
  }

  // ---------- rematch ----------
  rematch() {
    if (this.mode === 'online') {
      this.net.sendRematch();
      const btn = document.getElementById('btn-rematch');
      btn.disabled = true;
      btn.textContent = '상대 대기 중...';
      this.pendingRematch = true;
      if (this._rematchAccept) this.net.acceptRematch();
    } else {
      this.startGame();
    }
  }

  onRematchRequested() {
    this._rematchAccept = true;
    if (this.pendingRematch) this.net.acceptRematch();
    else document.getElementById('btn-rematch').textContent = '상대가 재대결 요청! 수락';
  }

  startRematch() {
    this._rematchAccept = false;
    this.pendingRematch = false;
    this.startGame();
  }

  exitGame() {
    if (this.mode === 'online') this.net.disconnect();
    this.mode = null;
    this.closeOverlay();
    this.showMenu();
  }

  // ---------- chat ----------
  toggleChat() {
    const panel = document.getElementById('chat-panel');
    const open = panel.classList.toggle('open');
    if (open) {
      this.chatUnread = 0;
      document.getElementById('chat-badge').textContent = '';
      setTimeout(() => document.getElementById('chat-input').focus(), 200);
    }
  }
  sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    this.net.sendChat(text);
    this.addChatMessage(this.nickname || '나', text, true);
    input.value = '';
  }
  receiveChat(d) {
    this.addChatMessage(d.nickname, d.text, false);
    if (!document.getElementById('chat-panel').classList.contains('open')) {
      this.chatUnread++;
      document.getElementById('chat-badge').textContent = this.chatUnread;
    }
  }
  addChatMessage(who, text, isMe) {
    const box = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg' + (isMe ? ' me' : '');
    div.innerHTML = '<span class="who"></span><span class="text"></span>';
    div.querySelector('.who').textContent = who;
    div.querySelector('.text').textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }
}

const app = new App();
