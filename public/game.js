// ==================== DICE HELPERS ====================

const PIP_MAP = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
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
// A die is { v: 1..6, s: shield(immune to removal), b: blocker(scores 0) }.

function columnScore(col) {
  const counts = {};
  for (const d of col) { if (d.b) continue; counts[d.v] = (counts[d.v] || 0) + 1; }
  let s = 0;
  for (const v in counts) { const k = counts[v]; s += Number(v) * k * k; }
  return s;
}

function playerScore(grid) {
  return grid.reduce((sum, col) => sum + columnScore(col), 0);
}

function cloneGrids(grids) {
  return grids.map(g => g.map(col => col.map(d => ({ v: d.v, s: d.s, b: d.b }))));
}

function boardFull(grid) {
  return grid.every(col => col.length >= 3);
}

function validColumns(grid) {
  const cols = [];
  for (let c = 0; c < 3; c++) if (grid[c].length < 3) cols.push(c);
  return cols;
}

// simulate a NORMAL die placement (with 알까기 removal of opponent normals)
function simNormal(grids, placer, col, value) {
  const g = cloneGrids(grids);
  g[placer][col].push({ v: value, s: false, b: false });
  const opp = 1 - placer;
  g[opp][col] = g[opp][col].filter(d => d.s || d.v !== value);
  return g;
}

function linesWon(grids, p) {
  let w = 0;
  for (let c = 0; c < 3; c++) if (columnScore(grids[p][c]) > columnScore(grids[1 - p][c])) w++;
  return w;
}

// heuristic value of a board from p's perspective (line wins dominate, then total)
function evalDiff(grids, p) {
  const o = 1 - p;
  return (linesWon(grids, p) - linesWon(grids, o)) * 50 +
         (playerScore(grids[p]) - playerScore(grids[o]));
}

// ==================== AI ====================

function aiChoose(grids, ai, value, difficulty) {
  const cols = validColumns(grids[ai]);
  if (cols.length === 0) return 0;

  if (difficulty === 'easy') {
    return cols[Math.floor(Math.random() * cols.length)];
  }

  if (difficulty === 'medium') {
    let best = cols[0], bestVal = -Infinity;
    for (const c of cols) {
      const val = evalDiff(simNormal(grids, ai, c, value), ai);
      if (val > bestVal) { bestVal = val; best = c; }
    }
    return best;
  }

  // hard: my move, then opponent's expected best reply (averaged over dice)
  let best = cols[0], bestVal = -Infinity;
  for (const c of cols) {
    const g1 = simNormal(grids, ai, c, value);
    let evalSum = 0;
    if (boardFull(g1[ai]) || boardFull(g1[1 - ai])) {
      evalSum = evalDiff(g1, ai) * 6;
    } else {
      const opp = 1 - ai;
      for (let e = 1; e <= 6; e++) {
        const oppCols = validColumns(g1[opp]);
        let oppBest = -Infinity;
        for (const oc of oppCols) {
          const g2 = simNormal(g1, opp, oc, e);
          oppBest = Math.max(oppBest, evalDiff(g2, opp));
        }
        if (oppBest === -Infinity) oppBest = evalDiff(g1, opp);
        evalSum += -oppBest; // from my perspective
      }
    }
    const val = evalSum / 6;
    if (val > bestVal) { bestVal = val; best = c; }
  }
  return best;
}

// occasionally block a very strong opponent column with a shield, else null
function aiShieldTarget(grids, ai) {
  const opp = 1 - ai;
  let best = null, bestScore = 9; // only block columns worth 10+ (rare)
  for (let c = 0; c < 3; c++) {
    if (grids[opp][c].length >= 3) continue;
    const s = columnScore(grids[opp][c]);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best === null ? null : { target: opp, col: best };
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
    this.mode = null;          // 'ai' | 'online' | 'local'
    this.grids = null;         // [ [col,col,col], [col,col,col] ] of die objects
    this.turn = 0;             // whose turn (player index)
    this.currentDie = 0;       // rolled value awaiting placement (0 = none)
    this.gameOver = false;
    this.rolling = false;
    this.awaitingRoll = false;

    this.shields = [0, 0];     // shield tokens per player
    this.rerollUsed = [false, false];
    this.placeMode = 'normal'; // 'normal' | 'shield'

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

  leaveRoom() {
    this.net.disconnect();
    this.showMenu();
  }

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
    this.lastPlaced = null;
    this.pendingRematch = false;
    this.shields = [0, 0];
    this.rerollUsed = [false, false];
    this.placeMode = 'normal';
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
    return true; // local
  }

  // ---------- turn flow ----------
  startTurn() {
    if (this.gameOver) return;
    this.currentDie = 0;
    this.awaitingRoll = false;
    this.placeMode = 'normal';
    this.renderDie(0, false);
    this.updateTurnUI();
    this.disablePlacement();

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
    if (this.gameOver || this.rolling || !this.currentDie) return;
    if (!this.humanControlsActive()) return;
    const p = this.turn;
    if (this.rerollUsed[p]) return;
    this.rerollUsed[p] = true;
    this.placeMode = 'normal';
    this.disablePlacement();
    this.rollDie((v) => {
      if (this.mode === 'online') this.net.sendAction({ type: 'roll', player: p, die: v });
      this.enablePlacement();
    });
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

  renderDie(value, opp) {
    setDie(document.getElementById('current-die'), value, opp);
  }

  // ---------- AI ----------
  scheduleAIMove() { setTimeout(() => this.aiAct(), 700); }

  aiAct() {
    if (this.gameOver) return;
    const ai = this.aiPlayer;
    if (this.difficulty === 'hard' && this.currentDie <= 2 && !this.rerollUsed[ai]) {
      this.rerollUsed[ai] = true;
      this.rollDie(() => setTimeout(() => this.aiPlace(), 450));
      return;
    }
    this.aiPlace();
  }

  aiPlace() {
    if (this.gameOver) return;
    const ai = this.aiPlayer;
    const value = this.currentDie;
    if (this.difficulty !== 'easy' && this.shields[ai] > 0) {
      const dec = aiShieldTarget(this.grids, ai);
      if (dec) {
        this.applyPlacement(ai, dec.target, dec.col, { v: value, s: true, b: dec.target !== ai });
        return;
      }
    }
    const col = aiChoose(this.grids, ai, value, this.difficulty);
    this.applyPlacement(ai, ai, col, { v: value, s: false, b: false });
  }

  // ---------- placement ----------
  place(owner, col) {
    if (this.gameOver || this.rolling || !this.currentDie) return;
    if (!this.humanControlsActive()) return;
    const p = this.turn;
    const shield = this.placeMode === 'shield';
    if (shield && this.shields[p] <= 0) return;
    if (!shield && owner !== p) return;
    if (this.grids[owner][col].length >= 3) return;
    const die = { v: this.currentDie, s: shield, b: shield && owner !== p };
    if (this.mode === 'online') {
      this.net.sendAction({ type: 'place', player: p, target: owner, col, v: this.currentDie, s: shield });
    }
    this.applyPlacement(p, owner, col, die);
  }

  applyPlacement(placer, owner, col, die) {
    if (this.gameOver) return;
    this.grids[owner][col].push(die);
    if (die.s) this.shields[placer] = Math.max(0, this.shields[placer] - 1);
    if (!die.s) {
      // 알까기: remove opponent's matching NORMAL dice in this column (shields survive)
      const opp = 1 - placer;
      const before = this.grids[opp][col].length;
      this.grids[opp][col] = this.grids[opp][col].filter(d => d.s || d.v !== die.v);
      if (before - this.grids[opp][col].length > 0) this.shields[placer]++; // reward
    }
    this.lastPlaced = { player: owner, col };
    this.currentDie = 0;
    this.placeMode = 'normal';
    this.disablePlacement();
    this.renderBoards();
    this.renderDie(0, false);

    if (boardFull(this.grids[0]) || boardFull(this.grids[1])) { this.endGame(); return; }
    this.turn = 1 - placer;
    setTimeout(() => this.startTurn(), 350);
  }

  toggleShieldMode() {
    if (!this.humanControlsActive()) return;
    if (this.shields[this.turn] <= 0) { this.placeMode = 'normal'; }
    else this.placeMode = this.placeMode === 'shield' ? 'normal' : 'shield';
    this.enablePlacement();
  }

  // ---------- network actions ----------
  onNetAction(d) {
    if (this.mode !== 'online') return;
    if (d.type === 'roll') {
      this.turn = d.player;
      this.currentDie = d.die;
      this.updateTurnUI();
      this.renderDie(d.die, !this.isBottom(d.player));
    } else if (d.type === 'place') {
      const die = { v: d.v, s: !!d.s, b: !!d.s && d.target !== d.player };
      this.applyPlacement(d.player, d.target, d.col, die);
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

  shieldLabel(p) {
    const n = this.shields ? this.shields[p] : 0;
    return n > 0 ? '🛡️' + n : '';
  }

  renderBoards() {
    this.renderBoard(document.getElementById('board-bottom'), this.bottomPlayer(), true);
    this.renderBoard(document.getElementById('board-top'), this.topPlayer(), false);
    document.getElementById('total-bottom').textContent = playerScore(this.grids[this.bottomPlayer()]);
    document.getElementById('total-top').textContent = playerScore(this.grids[this.topPlayer()]);
    document.getElementById('shields-bottom').textContent = this.shieldLabel(this.bottomPlayer());
    document.getElementById('shields-top').textContent = this.shieldLabel(this.topPlayer());
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
          let cls = 'die-face' + (opp ? ' opp' : '') + (d.s ? ' shield' : '') +
                    (d.b ? ' blocker' : '') + (isNew ? ' pop' : '');
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

  enablePlacement() {
    this.updateTurnUI();
    this.clearColumnHandlers();
    const rerollBtn = document.getElementById('btn-reroll');
    const shieldBtn = document.getElementById('btn-shield');

    if (!this.humanControlsActive()) {
      rerollBtn.style.display = 'none';
      shieldBtn.style.display = 'none';
      return;
    }
    const p = this.turn;

    rerollBtn.style.display = this.rerollUsed[p] ? 'none' : '';
    if (this.shields[p] > 0) {
      shieldBtn.style.display = '';
      shieldBtn.textContent = '🛡️ 실드 ' + this.shields[p];
      shieldBtn.classList.toggle('active', this.placeMode === 'shield');
    } else {
      shieldBtn.style.display = 'none';
      this.placeMode = 'normal';
    }

    if (this.placeMode === 'shield') {
      document.getElementById('turn-label').textContent = '🛡️ 실드 놓을 칸 선택 (양쪽 가능)';
    }

    const boards = [
      { id: 'board-bottom', owner: this.bottomPlayer() },
      { id: 'board-top', owner: this.topPlayer() }
    ];
    for (const b of boards) {
      const canHere = this.placeMode === 'shield' ? true : (b.owner === p);
      if (!canHere) continue;
      const el = document.getElementById(b.id);
      el.classList.add('can-place');
      const grid = this.grids[b.owner];
      el.querySelectorAll('.board-col').forEach((cE) => {
        const c = Number(cE.dataset.col);
        if (grid[c].length < 3) {
          cE.classList.add('placeable');
          cE.onclick = () => this.place(b.owner, c);
        }
      });
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
    const sb = document.getElementById('btn-shield');
    sb.style.display = 'none';
    sb.classList.remove('active');
  }

  // ---------- game over ----------
  lineResult() {
    let w0 = 0, w1 = 0;
    for (let c = 0; c < 3; c++) {
      const s0 = columnScore(this.grids[0][c]), s1 = columnScore(this.grids[1][c]);
      if (s0 > s1) w0++; else if (s1 > s0) w1++;
    }
    const t0 = playerScore(this.grids[0]), t1 = playerScore(this.grids[1]);
    let winner = null;
    if (w0 > w1) winner = 0;
    else if (w1 > w0) winner = 1;
    else if (t0 > t1) winner = 0;
    else if (t1 > t0) winner = 1;
    return { w0, w1, t0, t1, winner };
  }

  endGame() {
    this.gameOver = true;
    this.disablePlacement();
    this.updateTurnUI();
    this.renderBoards();

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
      if (winner === null) icon = '🤝', title = '무승부';
      else if (winner === myP) icon = '🏆', title = '승리!';
      else icon = '😢', title = '패배';
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
    setTimeout(() => document.getElementById('overlay-gameover').classList.add('active'), 500);
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
