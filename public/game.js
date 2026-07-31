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

function columnScore(col) {
  const counts = {};
  for (const v of col) counts[v] = (counts[v] || 0) + 1;
  let s = 0;
  for (const v in counts) {
    const k = counts[v];
    s += Number(v) * k * k;
  }
  return s;
}

function playerScore(grid) {
  return grid.reduce((sum, col) => sum + columnScore(col), 0);
}

function cloneGrids(grids) {
  return grids.map(g => g.map(col => col.slice()));
}

// player places `die` in column `col`; opponent's matching dice in that column are removed
function applyMove(grids, player, col, die) {
  grids[player][col].push(die);
  const opp = 1 - player;
  grids[opp][col] = grids[opp][col].filter(v => v !== die);
  return grids;
}

function boardFull(grid) {
  return grid.every(col => col.length >= 3);
}

// ==================== AI ====================

function validColumns(grid) {
  const cols = [];
  for (let c = 0; c < 3; c++) if (grid[c].length < 3) cols.push(c);
  return cols;
}

function aiChoose(grids, aiP, die, difficulty) {
  const cols = validColumns(grids[aiP]);
  if (cols.length === 0) return 0;
  const oppP = 1 - aiP;

  if (difficulty === 'easy') {
    return cols[Math.floor(Math.random() * cols.length)];
  }

  if (difficulty === 'medium') {
    let best = cols[0], bestVal = -Infinity;
    for (const c of cols) {
      const before = columnScore(grids[aiP][c]);
      const afterCol = grids[aiP][c].concat(die);
      const gain = columnScore(afterCol) - before;
      const oppBefore = columnScore(grids[oppP][c]);
      const oppAfter = columnScore(grids[oppP][c].filter(v => v !== die));
      const removal = oppBefore - oppAfter;
      const val = gain + removal;
      if (val > bestVal) { bestVal = val; best = c; }
    }
    return best;
  }

  // hard: 2-ply expectiminimax (my move, then opponent's expected best reply)
  let best = cols[0], bestVal = -Infinity;
  for (const c of cols) {
    const g1 = applyMove(cloneGrids(grids), aiP, c, die);
    let evalSum = 0;
    if (boardFull(g1[aiP])) {
      evalSum = (playerScore(g1[aiP]) - playerScore(g1[oppP])) * 6;
    } else {
      for (let e = 1; e <= 6; e++) {
        const oppCols = validColumns(g1[oppP]);
        let oppBest = -Infinity;
        for (const oc of oppCols) {
          const g2 = applyMove(cloneGrids(g1), oppP, oc, e);
          const diff = playerScore(g2[oppP]) - playerScore(g2[aiP]);
          if (diff > oppBest) oppBest = diff;
        }
        if (oppBest === -Infinity) oppBest = playerScore(g1[oppP]) - playerScore(g1[aiP]);
        evalSum += -oppBest; // from my perspective
      }
    }
    const val = evalSum / 6;
    if (val > bestVal) { bestVal = val; best = c; }
  }
  return best;
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
    this.grids = null;         // [ [col,col,col], [col,col,col] ]
    this.turn = 0;             // whose turn (player index)
    this.currentDie = 0;       // rolled value awaiting placement (0 = none)
    this.gameOver = false;
    this.rolling = false;

    this.myPlayer = 0;         // which index "I" control (bottom board)
    this.aiPlayer = 1;
    this.difficulty = 'medium';
    this.names = ['Player 1', 'Player 2'];
    this.lastPlaced = null;    // {player, col} for pop animation
    this.pendingRematch = false;
    this.chatUnread = 0;

    this.nickname = localStorage.getItem('tikatuka_nickname') || '';
    this.bindNet();
    this.initUI();
  }

  // ---------- init ----------
  initUI() {
    // fill logo dice
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
    // tap the die to roll
    document.getElementById('die-stage').addEventListener('click', () => this.doRoll());
    // keep the board fitted to the screen
    const onResize = () => this.sizeBoards();
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    if (this.nickname) this.showMenuButtons();
  }

  // size board cells so both boards + chrome always fit the viewport height
  sizeBoards() {
    const layout = document.querySelector('#screen-game .game-layout');
    if (!layout || !document.getElementById('screen-game').classList.contains('active')) return;
    const vw = Math.min(window.innerWidth, 460);
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const root = document.documentElement;
    // start from a width-based estimate, then shrink until it fits vertically
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
        // set name via textContent to avoid injection
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

  // fetch and show head-to-head record vs the current online opponent
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
  bottomPlayer() {
    if (this.mode === 'online') return this.myPlayer;
    return 0;
  }
  topPlayer() { return 1 - this.bottomPlayer(); }

  isBottom(player) { return player === this.bottomPlayer(); }

  // can the local human place right now for the active turn?
  humanControlsActive() {
    if (this.gameOver || !this.currentDie) return false;
    if (this.mode === 'ai') return this.turn === this.myPlayer;
    if (this.mode === 'online') return this.turn === this.myPlayer;
    return true; // local: human always places
  }

  // ---------- turn flow ----------
  startTurn() {
    if (this.gameOver) return;
    this.currentDie = 0;
    this.awaitingRoll = false;
    this.renderDie(0, false);
    this.updateTurnUI();
    this.disablePlacement();

    if (this.mode === 'ai') {
      if (this.turn === this.aiPlayer) {
        this.rollDie((v) => this.scheduleAIMove());   // AI rolls automatically
      } else {
        this.promptRoll();                            // human taps to roll
      }
    } else if (this.mode === 'local') {
      this.promptRoll();
    } else { // online
      if (this.turn === this.myPlayer) this.promptRoll();
      // else: wait for opponent's 'roll' action
    }
  }

  // show the die as a tappable "roll" button for the active human
  promptRoll() {
    this.awaitingRoll = true;
    this.renderDie(0, !this.isBottom(this.turn));
    document.getElementById('die-stage').classList.add('rollable');
    const label = document.getElementById('turn-label');
    label.classList.add('my-turn');
    const who = this.mode === 'local' ? this.names[this.turn] + ' · ' : '';
    label.textContent = who + '주사위를 탭하세요';
  }

  // triggered when the human taps the die
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
    const el = document.getElementById('current-die');
    setDie(el, value, opp);
  }

  scheduleAIMove() {
    setTimeout(() => {
      if (this.gameOver) return;
      const col = aiChoose(this.grids, this.aiPlayer, this.currentDie, this.difficulty);
      this.applyPlacement(this.aiPlayer, col, this.currentDie);
    }, 750);
  }

  placeCurrent(col) {
    if (!this.humanControlsActive()) return;
    const p = this.turn;
    if (this.grids[p][col].length >= 3) return;
    const die = this.currentDie;
    if (this.mode === 'online') {
      this.net.sendAction({ type: 'place', player: p, col, die });
    }
    this.applyPlacement(p, col, die);
  }

  applyPlacement(player, col, die) {
    if (this.gameOver) return;
    applyMove(this.grids, player, col, die);
    this.lastPlaced = { player, col };
    this.currentDie = 0;
    this.disablePlacement();
    this.renderBoards();
    this.renderDie(0, false);

    if (boardFull(this.grids[player])) {
      this.endGame();
      return;
    }
    this.turn = 1 - player;
    setTimeout(() => this.startTurn(), 350);
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
      this.applyPlacement(d.player, d.col, d.die);
    }
  }

  onOpponentLeft() {
    if (this.mode !== 'online') return;
    this.gameOver = true;
    this.showGameOverBox('👋', '상대가 나갔어요', '상대방과의 연결이 끊어졌습니다.', false);
  }

  // ---------- render ----------
  setupBoardLabels() {
    const bp = this.bottomPlayer(), tp = this.topPlayer();
    document.getElementById('name-bottom').textContent = this.names[bp];
    document.getElementById('name-top').textContent = this.names[tp];
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
      // build 3 slots; bottom board stacks from bottom, top board from top
      for (let row = 0; row < 3; row++) {
        let value = 0;
        if (isBottom) {
          // filled rows are the lower ones: row 2 = col[0], row1 = col[1], row0 = col[2]
          const idx = col.length - (3 - row);
          if (idx >= 0) value = col[idx];
        } else {
          // filled rows are the upper ones: row0 = col[0], row1 = col[1]...
          if (row < col.length) value = col[row];
        }
        if (value > 0) {
          const isNew = this.lastPlaced && this.lastPlaced.player === player &&
                        this.lastPlaced.col === c && this.isTopOfStack(col, isBottom, row);
          slots += '<div class="slot"><div class="die-face' + (opp ? ' opp' : '') +
                   (isNew ? ' pop' : '') + '" data-pips="' + value + '">' + dieInner(value) + '</div></div>';
        } else {
          slots += '<div class="slot"></div>';
        }
      }
      const inner = isBottom ? (slots + scoreLabel) : (scoreLabel + slots);
      html += '<div class="board-col" data-col="' + c + '">' + inner + '</div>';
    }
    el.innerHTML = html;
    this.lastPlacedRendered = true;
  }

  isTopOfStack(col, isBottom, row) {
    // the newly placed die is the last element of the column
    if (isBottom) {
      const idx = col.length - (3 - row);
      return idx === col.length - 1;
    } else {
      return row === col.length - 1;
    }
  }

  updateTurnUI() {
    const bottomEl = document.getElementById('panel-bottom');
    const topEl = document.getElementById('panel-top');
    bottomEl.classList.remove('active-turn', 'opp-turn');
    topEl.classList.remove('active-turn', 'opp-turn');
    if (this.gameOver) return;

    const activeBottom = this.isBottom(this.turn);
    if (activeBottom) bottomEl.classList.add('active-turn');
    else { topEl.classList.add('active-turn', 'opp-turn'); }

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
    if (!this.humanControlsActive()) return;
    // active player's board
    const activeBottom = this.isBottom(this.turn);
    const boardEl = document.getElementById(activeBottom ? 'board-bottom' : 'board-top');
    boardEl.classList.add('can-place');
    const grid = this.grids[this.turn];
    boardEl.querySelectorAll('.board-col').forEach((colEl) => {
      const c = Number(colEl.dataset.col);
      if (grid[c].length < 3) {
        colEl.classList.add('placeable');
        colEl.onclick = () => this.placeCurrent(c);
      } else {
        colEl.classList.remove('placeable');
        colEl.onclick = null;
      }
    });
  }

  disablePlacement() {
    ['board-bottom', 'board-top'].forEach(id => {
      const el = document.getElementById(id);
      el.classList.remove('can-place');
      el.querySelectorAll('.board-col').forEach(colEl => {
        colEl.classList.remove('placeable');
        colEl.onclick = null;
      });
    });
  }

  // ---------- game over ----------
  endGame() {
    this.gameOver = true;
    this.disablePlacement();
    this.updateTurnUI();
    this.renderBoards();

    const myP = (this.mode === 'local') ? 0 : this.myPlayer;
    const sMine = playerScore(this.grids[myP]);
    const sOther = playerScore(this.grids[1 - myP]);

    let icon, title, msg;
    if (this.mode === 'local') {
      const s0 = playerScore(this.grids[0]), s1 = playerScore(this.grids[1]);
      if (s0 === s1) { icon = '🤝'; title = '무승부'; msg = this.names[0] + ' ' + s0 + ' : ' + s1 + ' ' + this.names[1]; }
      else {
        const w = s0 > s1 ? 0 : 1;
        icon = '🏆'; title = this.names[w] + ' 승리!';
        msg = this.names[0] + ' ' + s0 + ' : ' + s1 + ' ' + this.names[1];
      }
    } else {
      if (sMine === sOther) { icon = '🤝'; title = '무승부'; msg = '나 ' + sMine + ' : ' + sOther + ' 상대'; }
      else if (sMine > sOther) { icon = '🏆'; title = '승리!'; msg = '나 ' + sMine + ' : ' + sOther + ' 상대'; }
      else { icon = '😢'; title = '패배'; msg = '나 ' + sMine + ' : ' + sOther + ' 상대'; }
      // record win/loss only for online (human) games, skip AI and draws
      if (this.mode === 'online' && sMine !== sOther) this.reportOnlineResult(sMine > sOther);
    }
    this.showGameOverBox(icon, title, msg, this.mode !== 'online' || true);
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
      if (this._rematchAccept) { this.net.acceptRematch(); }
    } else {
      this.startGame();
    }
  }

  onRematchRequested() {
    this._rematchAccept = true;
    if (this.pendingRematch) {
      this.net.acceptRematch();
    } else {
      const btn = document.getElementById('btn-rematch');
      btn.textContent = '상대가 재대결 요청! 수락';
    }
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
