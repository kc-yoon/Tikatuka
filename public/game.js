// ==================== SOUND MANAGER ====================
class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('tikatuka_muted') === 'true';
  }
  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  setMuted(m) { this.muted = m; localStorage.setItem('tikatuka_muted', m ? 'true' : 'false'); }
  play(name) {
    if (this.muted || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    try { this['_' + name](); } catch (e) {}
  }
  _osc(type, freq, dur, vol, delay) {
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  _noise(dur, vol, delay) {
    const t = this.ctx.currentTime + (delay || 0);
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 500;
    src.connect(f); f.connect(g); g.connect(this.ctx.destination);
    src.start(t); src.stop(t + dur + 0.02);
  }
  // filtered noise burst — simulates a hard object hitting a wooden surface
  _knock(dur, vol, freq, delay) {
    const t = this.ctx.currentTime + (delay || 0);
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.5;
    src.connect(bp); bp.connect(g); g.connect(this.ctx.destination);
    src.start(t); src.stop(t + dur + 0.02);
  }
  // wood‑thud helper — lowpass‑filtered noise burst (deeper than _knock)
  _thud(dur, vol, freq, delay) {
    const t = this.ctx.currentTime + (delay || 0);
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = freq; lp.Q.value = 0.7;
    src.connect(lp); lp.connect(g); g.connect(this.ctx.destination);
    src.start(t); src.stop(t + dur + 0.02);
  }
  // realistic dice roll — NO oscillators, purely noise‑based
  _diceRoll() {
    // 1) initial drop: heavy thud on table surface
    this._thud(0.06, 0.30, 400, 0);
    this._knock(0.03, 0.12, 600, 0.005);
    // 2) tumbling rattle: die rolling/scraping across surface (8 rapid micro‑taps)
    for (let i = 0; i < 8; i++) {
      const t = 0.05 + i * 0.022 + Math.random() * 0.008;
      const vol = 0.04 + Math.random() * 0.05;
      this._knock(0.012 + Math.random() * 0.008, vol, 500 + Math.random() * 400, t);
    }
    // 3) bounces: die hops on hard surface, each softer/shorter
    const bounces = [
      { t: 0.24, vol: 0.22, freq: 350, dur: 0.04 },
      { t: 0.30, vol: 0.16, freq: 380, dur: 0.035 },
      { t: 0.35, vol: 0.10, freq: 420, dur: 0.025 },
      { t: 0.38, vol: 0.06, freq: 450, dur: 0.018 },
      { t: 0.40, vol: 0.03, freq: 480, dur: 0.012 },
    ];
    for (const b of bounces) {
      this._thud(b.dur, b.vol, b.freq, b.t);
      this._knock(b.dur * 0.6, b.vol * 0.3, b.freq + 200, b.t + 0.003);
    }
    // 4) final settle: die tips flat with a soft clack
    this._thud(0.04, 0.08, 300, 0.43);
    this._knock(0.015, 0.05, 500, 0.435);
  }
  // satisfying clack when die settles — noise only, no tones
  _diceSettle() {
    this._thud(0.05, 0.20, 350, 0);
    this._knock(0.025, 0.12, 550, 0.008);
  }
  // solid thud on normal placement
  _place() {
    this._osc('sine', 160, 0.12, 0.2);
    this._osc('sine', 90, 0.08, 0.12);
    this._noise(0.04, 0.06);
  }
  // dramatic 알까기 impact
  _kill() {
    this._noise(0.25, 0.25);
    this._osc('sawtooth', 110, 0.25, 0.22);
    this._osc('sine', 65, 0.35, 0.2);
    this._osc('square', 1100, 0.04, 0.18, 0.02);
    this._osc('square', 750, 0.06, 0.12, 0.05);
  }
  // ascending sparkle for immune die
  _immune() {
    [523, 659, 784, 1047].forEach((freq, i) => {
      this._osc('sine', freq, 0.14, 0.1, i * 0.07);
      this._osc('triangle', freq * 2, 0.08, 0.04, i * 0.07);
    });
  }
  // victory fanfare
  _win() {
    [523, 659, 784, 1047, 784, 1047].forEach((freq, i) => {
      this._osc('sine', freq, 0.22, 0.13, i * 0.11);
      this._osc('triangle', freq, 0.18, 0.06, i * 0.11 + 0.015);
    });
  }
  // sad descending tones
  _lose() {
    [392, 349, 311, 261].forEach((freq, i) => this._osc('sine', freq, 0.28, 0.1, i * 0.18));
  }
  // subtle UI click
  _click() { this._osc('sine', 800, 0.04, 0.08); }
  // swoosh for reroll
  _reroll() {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(1200, t + 0.12);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + 0.22);
  }
}
const sfx = new SoundManager();

// ==================== VFX HELPERS ====================
function spawnParticles(x, y, count, color, sz) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'vfx-particle';
    const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8;
    const dist = 30 + Math.random() * 60;
    Object.assign(el.style, {
      left: x + 'px', top: y + 'px', width: sz + 'px', height: sz + 'px',
      background: color, '--pdx': Math.cos(a) * dist + 'px', '--pdy': Math.sin(a) * dist + 'px'
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }
}

function screenShake() {
  const el = document.querySelector('#screen-game .game-layout');
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
  if (navigator.vibrate) navigator.vibrate([30, 20, 50]);
}

function spawnConfetti() {
  const colors = ['#e8a838', '#38a8e8', '#48b868', '#d94848', '#b47cff', '#ffd54f'];
  for (let i = 0; i < 50; i++) {
    const el = document.createElement('div');
    el.className = 'vfx-confetti';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDelay = (Math.random() * 0.8) + 's';
    el.style.animationDuration = (1.2 + Math.random() * 1.5) + 's';
    el.style.width = (4 + Math.random() * 8) + 'px';
    el.style.height = (4 + Math.random() * 8) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
}

function spawnImpactFlash(x, y) {
  const el = document.createElement('div');
  el.className = 'vfx-impact-flash';
  el.style.left = x + 'px'; el.style.top = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 400);
}

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// render a title as a styled badge chip (titles are from a fixed safe set)
function titleBadge(title) {
  const cls = title === '커피당첨' ? 'tb-katago' : 'tb-alphago';
  return '<span class="title-badge ' + cls + '">' + title + '</span>';
}

function nameWithTitle(name, title) {
  return (title ? titleBadge(title) : '') + escapeHtml(name);
}

// ==================== AI WORKER ====================
// The hard AI's search (ai.js) runs in a Web Worker so the page keeps animating
// while the AI thinks. If the worker can't start, the search runs inline instead.

class AIWorkerClient {
  constructor() {
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();   // id -> { kind, args, done }
    try {
      this.worker = new Worker('ai-worker.js');
      this.worker.onmessage = (e) => {
        const job = this.pending.get(e.data.id);
        if (!job) return;
        this.pending.delete(e.data.id);
        job.done(e.data.result);
      };
      this.worker.onerror = () => this.fallBackToInline();
    } catch (e) {
      this.worker = null;
    }
  }

  run(kind, args, done) {
    if (!this.worker) { setTimeout(() => done(runAIJob(kind, args)), 0); return; }
    const id = this.nextId++;
    this.pending.set(id, { kind, args, done });
    this.worker.postMessage({ id, kind, args });
  }

  fallBackToInline() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    const jobs = [...this.pending.values()];
    this.pending.clear();
    for (const job of jobs) this.run(job.kind, job.args, job.done);
  }
}

const aiWorker = new AIWorkerClient();

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
    this.onRequestSnapshot = null;
    this.onSnapshot = null;
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
      this.socket.on('requestSnapshot', (d) => { if (this.onRequestSnapshot) this.onRequestSnapshot(d); });
      this.socket.on('snapshot', (d) => { if (this.onSnapshot) this.onSnapshot(d); });
    });
  }

  spectateRoom(code, nickname) {
    return new Promise((resolve, reject) => {
      this.socket.emit('spectateRoom', { code, nickname });
      this.socket.once('spectateJoined', (d) => resolve(d));
      this.socket.once('roomError', (msg) => reject(msg));
    });
  }

  sendSnapshot(to, state) { if (this.socket) this.socket.emit('snapshot', { to, state }); }

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
  sendGameFinished() { if (this.socket) this.socket.emit('gameFinished'); }
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
    this.aiGen = 0;               // bumped per game; drops stale worker answers

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
    this.isSpectator = false;

    this.nickname = localStorage.getItem('tikatuka_nickname') || '';
    this.title = localStorage.getItem('tikatuka_title') || null;
    this.aiStreak = 0;
    this.bindNet();
    // initialize audio context on first user interaction
    document.addEventListener('pointerdown', () => sfx.init(), { once: true });
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
    // die rolling is now automatic — no manual press needed
    const onResize = () => this.sizeBoards();
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    if (this.nickname) this.showMenuButtons();
    const muteBtn = document.getElementById('btn-mute');
    if (muteBtn) muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
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
      this.title = data.title || null;
      this.aiStreak = data.aiStreak || 0;
      localStorage.setItem('tikatuka_nickname', data.nickname);
      localStorage.setItem('tikatuka_title', this.title || '');
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
      this.title = null;
      localStorage.setItem('tikatuka_nickname', data.nickname);
      localStorage.setItem('tikatuka_title', '');
      msg.textContent = '';
      this.showMenuButtons();
    } catch {
      msg.textContent = '서버 연결 실패. 다시 시도해주세요.'; msg.className = 'nickname-msg error';
    }
  }

  showMenuButtons() {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('menu-buttons').style.display = '';
    document.getElementById('welcome-msg').innerHTML =
      (this.title ? titleBadge(this.title) : '') + escapeHtml(this.nickname) + '님 환영합니다!';
  }

  logout() {
    this.nickname = '';
    this.title = null;
    localStorage.removeItem('tikatuka_nickname');
    localStorage.removeItem('tikatuka_title');
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
      const medals = ['🥇', '🥈', '🥉'];
      let html = '<div class="lb-row lb-head"><span class="lb-rank">#</span><span class="lb-name">닉네임</span><span class="lb-w">승</span><span class="lb-l">패</span><span class="lb-rate">승률</span><span class="lb-ai">AI연승</span></div>';
      rows.forEach((r, i) => {
        const me = r.nickname === this.nickname ? ' me' : '';
        const total = r.wins + r.losses;
        const rate = total > 0 ? Math.round(r.wins / total * 100) + '%' : '-';
        const rank = i < 3 ? '<span class="lb-rank-medal">' + medals[i] + '</span>' : (i + 1);
        const streak = r.ai_streak || 0;
        const maxStreak = r.ai_max_streak || 0;
        const aiText = maxStreak > 0 ? (streak > 0 ? '🔥' + streak : '-') + '/' + maxStreak : '-';
        html += '<div class="lb-row' + me + '"><span class="lb-rank">' + rank + '</span>' +
                '<span class="lb-name"></span><span class="lb-w">' + r.wins + '</span>' +
                '<span class="lb-l">' + r.losses + '</span><span class="lb-rate">' + rate + '</span>' +
                '<span class="lb-ai">' + aiText + '</span></div>';
      });
      list.innerHTML = html;
      const nameCells = list.querySelectorAll('.lb-row:not(.lb-head) .lb-name');
      rows.forEach((r, i) => {
        if (nameCells[i]) nameCells[i].innerHTML = nameWithTitle(r.nickname, r.title);
      });
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
    this.net.onRequestSnapshot = (d) => this.onRequestSnapshot(d);
    this.net.onSnapshot = (d) => this.onSnapshot(d);
  }

  // ---------- screens ----------
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }
  showMenu() {
    if (this.mode === 'online') this.net.disconnect();
    this.aiGen++;
    this.mode = null;
    this.isSpectator = false;
    this.myPlayer = 0;
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

  // ---------- spectate ----------
  async spectate() {
    const code = document.getElementById('room-code-input').value.toUpperCase().trim();
    const msg = document.getElementById('lobby-message');
    if (code.length !== 4) { msg.textContent = '4자리 코드를 입력하세요.'; return; }
    try {
      await this.net.connect();
      // mark spectator BEFORE joining so an early snapshot isn't dropped
      this.isSpectator = true;
      this.mode = 'online';
      this.myPlayer = null;
      const d = await this.net.spectateRoom(code, this.nickname || '관전자');
      this.onSpectateJoined(d);
    } catch (err) {
      this.isSpectator = false;
      this.mode = null;
      msg.textContent = err || '관전 실패';
    }
  }

  onSpectateJoined(data) {
    this.mode = 'online';
    this.isSpectator = true;
    this.myPlayer = null;
    const nn = data.nicknames || {};
    this.names = [nn[1] || 'Player 1', nn[2] || 'Player 2'];
    this.grids = [[[], [], []], [[], [], []]];
    this.gameOver = false; this.placeAnywhere = false; this.currentDie = 0;
    this.held = [false, false]; this.rerollUsed = [false, false]; this.immuneFirstUsed = false;
    document.getElementById('btn-chat-toggle').style.display = '';
    document.getElementById('h2h-record').style.display = 'none';
    this.setupBoardLabels();
    this.renderBoards();
    this.showScreen('screen-game');
    this.sizeBoards();
    document.getElementById('turn-label').textContent = '👁 관전 준비 중...';
  }

  // host builds a snapshot for a newly-joined spectator
  onRequestSnapshot(d) {
    if (this.isSpectator || !this.grids || !d || !d.to) return;
    this.net.sendSnapshot(d.to, {
      grids: this.grids, turn: this.turn, currentDie: this.currentDie,
      held: this.held, rerollUsed: this.rerollUsed, immuneFirstUsed: this.immuneFirstUsed,
      placeAnywhere: this.placeAnywhere, gameOver: this.gameOver, names: this.names
    });
  }

  // spectator loads the snapshot and starts following live actions
  onSnapshot(state) {
    if (!this.isSpectator || !state) return;
    this.grids = state.grids;
    this.turn = state.turn || 0;
    this.currentDie = state.currentDie || 0;
    this.held = state.held || [false, false];
    this.rerollUsed = state.rerollUsed || [false, false];
    this.immuneFirstUsed = !!state.immuneFirstUsed;
    this.placeAnywhere = !!state.placeAnywhere;
    this.gameOver = !!state.gameOver;
    this.names = state.names || this.names;
    this.setupBoardLabels();
    this.renderBoards();
    this.renderDie(this.currentDie, this.currentDie ? !this.isBottom(this.turn) : false);
    this.updateTurnUI();
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


  startGame() {
    this.aiGen++;
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
    if (this.mode === 'ai') this.loadAiStreak();
    this.startTurn();
  }

  // show current AI-어려움 win streak in the top panel
  async loadAiStreak() {
    // wait for any pending AI result POST to finish first (prevents race condition on mobile)
    if (this._aiResultPending) {
      await this._aiResultPending.catch(() => {});
      this._aiResultPending = null;
    }
    if (!this.nickname) { this.showAiStreak(this.aiStreak); return; }
    try {
      const res = await fetch('/api/ai-streak?nickname=' + encodeURIComponent(this.nickname));
      const d = await res.json();
      this.aiStreak = d.streak || 0;
    } catch {}
    this.showAiStreak(this.aiStreak);
  }

  showAiStreak(n) {
    const el = document.getElementById('h2h-record');
    if (n >= 2) {
      el.textContent = '🔥 ' + n + '연승 중';
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
    this.sizeBoards();
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
  bottomPlayer() {
    if (this.isSpectator) return 0;                    // spectators: P1 bottom, P2 top
    return this.mode === 'online' ? this.myPlayer : 0;
  }
  topPlayer() { return 1 - this.bottomPlayer(); }
  isBottom(player) { return player === this.bottomPlayer(); }

  humanControlsActive() {
    if (this.gameOver || !this.currentDie || this.isSpectator) return false;
    if (this.mode === 'ai') return this.turn === this.myPlayer;
    if (this.mode === 'online') return this.turn === this.myPlayer;
    return true;
  }

  // do I generate randomness (rolls) for the current turn?
  generatesRandomness() {
    if (this.isSpectator) return false;
    return this.mode !== 'online' || this.turn === this.myPlayer;
  }

  // is it my controllable turn (regardless of whether a die was rolled)?
  myTurnNow() {
    if (this.gameOver || this.isSpectator) return false;
    if (this.mode === 'ai' || this.mode === 'online') return this.turn === this.myPlayer;
    return true;
  }

  // a player can no longer move once held or their field is full
  isDone(p) { return this.held[p] || fieldFull(this.grids[p]); }

  // ---------- turn flow ----------
  startTurn() {
    if (this.gameOver) return;
    this.currentDie = 0;
    this.awaitingRoll = false;
    this.placeAnywhere = false;
    this.renderDie(0, false);
    this.updateTurnUI();
    this.disablePlacement();

    // Skip a player who can't move (held or full). Game ends when both are done.
    if (this.isDone(this.turn)) {
      if (this.isDone(1 - this.turn)) { this.endGame(); return; }
      this.turn = 1 - this.turn;
      setTimeout(() => this.startTurn(), 150);
      return;
    }

    if (this.mode === 'ai') {
      if (this.turn === this.aiPlayer) this.rollDie(() => this.scheduleAIMove());
      else this.promptRoll();
    } else {
      if (this.turn === this.myPlayer) this.promptRoll();
    }
  }

  promptRoll() {
    document.getElementById('btn-hold').style.display = '';   // hold usable before rolling
    const label = document.getElementById('turn-label');
    label.classList.add('my-turn');
    label.textContent = '내 차례';
    // auto-roll after a short delay
    setTimeout(() => {
      if (this.gameOver || this.rolling) return;
      this.rollDie((v) => {
        if (this.mode === 'online' && this.turn === this.myPlayer) {
          this.net.sendAction({ type: 'roll', player: this.myPlayer, die: v });
        }
        this.enablePlacement();
      });
    }, 400);
  }

  doReroll() {
    if (this.gameOver || this.rolling || !this.currentDie || this.placeAnywhere) return;
    if (!this.humanControlsActive()) return;
    const p = this.turn;
    if (this.rerollUsed[p]) return;
    this.rerollUsed[p] = true;
    sfx.play('reroll');
    // roll a new die; player then chooses between the old and new value
    this._rerollOld = this.currentDie;
    this._rerollNew = 1 + Math.floor(Math.random() * 6);
    this.disablePlacement();
    const opp = !this.isBottom(this.turn);
    setDie(document.getElementById('rc-old'), this._rerollOld, opp);
    setDie(document.getElementById('rc-new'), this._rerollNew, opp);
    document.getElementById('reroll-choice').style.display = '';
  }

  chooseReroll(which) {
    sfx.play('click');
    document.getElementById('reroll-choice').style.display = 'none';
    this.currentDie = which === 'new' ? this._rerollNew : this._rerollOld;
    this.renderDie(this.currentDie, !this.isBottom(this.turn));
    if (this.mode === 'online') this.net.sendAction({ type: 'roll', player: this.turn, die: this.currentDie });
    this.enablePlacement();
  }

  // generic confirm popup — returns a Promise<boolean>
  _confirm(title, message) {
    return new Promise(resolve => {
      const ov = document.getElementById('overlay-confirm');
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      ov.classList.add('active');
      const yes = document.getElementById('confirm-yes');
      const no  = document.getElementById('confirm-no');
      const cleanup = (result) => {
        ov.classList.remove('active');
        yes.replaceWith(yes.cloneNode(true));   // remove listeners
        no.replaceWith(no.cloneNode(true));
        resolve(result);
      };
      yes.addEventListener('click', () => cleanup(true),  { once: true });
      no.addEventListener('click',  () => cleanup(false), { once: true });
    });
  }

  async doHold() {
    if (this.gameOver || this.placeAnywhere || this.rolling) return;
    if (!this.myTurnNow()) return;
    const ok = await this._confirm('홀드', '정말 홀드하시겠습니까?\n내 턴을 건너뛰고 상대만 마저 굴립니다.');
    if (!ok) return;
    sfx.play('click');
    const p = this.turn;
    this.held[p] = true;
    if (this.mode === 'online') this.net.sendAction({ type: 'hold', player: p });
    this.currentDie = 0;
    this.awaitingRoll = false;
    this.disablePlacement();
    this.renderDie(0, false);
    if (this.isDone(0) && this.isDone(1)) { this.endGame(); return; }
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
    sfx.play('diceRoll');
    let ticks = 0;
    const iv = setInterval(() => {
      setDie(el, 1 + Math.floor(Math.random() * 6), opp);
      if (++ticks >= 5) {
        clearInterval(iv);
        this.currentDie = v;
        this.renderDie(v, opp);
        el.classList.remove('rolling');
        sfx.play('diceSettle');
        this.rolling = false;
        if (cb) cb(v);
      }
    }, 55);
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
    die.by = placer;
    this.grids[placer][col].push(die);
    if (placer === 0 && die.im) this.immuneFirstUsed = true;

    const opp = 1 - placer;
    const willKill = !die.im && this.grids[opp][col].some(d => !d.im && d.v === die.v);

    if (willKill) {
      // show my die landing, then head-butt the opponent's matching dice out
      this.currentDie = 0;
      this.lastPlaced = { player: placer, col };
      this.disablePlacement();
      this.renderBoards();
      this.animateHeadbutt(placer, opp, col, die.v);
      setTimeout(() => {
        // 알까기 resolves: my die is removed too, opponent's matching normals cleared
        this.grids[placer][col].pop();
        this.grids[opp][col] = this.grids[opp][col].filter(d => d.im || d.v !== die.v);
        this.lastPlaced = null;
        this.renderBoards();
        setTimeout(() => this.afterKillReroll(), 80);
      }, 550);
    } else {
      sfx.play('place');
      this.lastPlaced = { player: placer, col };
      this.finishPlacement();
    }
  }

  // my die flies over, collides with the opponent's matching dice, and they fall together
  animateHeadbutt(placer, opp, col, v) {
    const myId = this.isBottom(placer) ? 'board-bottom' : 'board-top';
    const oppId = this.isBottom(opp) ? 'board-bottom' : 'board-top';
    const myColEl = document.querySelector('#' + myId + ' .board-col[data-col="' + col + '"]');
    const oppColEl = document.querySelector('#' + oppId + ' .board-col[data-col="' + col + '"]');

    const impact = () => {
      if (oppColEl) oppColEl.querySelectorAll('.die-face[data-pips="' + v + '"]').forEach(d => {
        if (!d.classList.contains('immune')) d.classList.add('drop');
      });
    };

    const dice = myColEl ? myColEl.querySelectorAll('.slot .die-face') : [];
    const src = dice.length ? dice[dice.length - 1] : null;
    if (!src || !oppColEl) { impact(); return; }
    const s = src.getBoundingClientRect();
    const t = oppColEl.getBoundingClientRect();
    if (!s.width || !t.width) { impact(); return; }

    const proj = src.cloneNode(true);
    proj.classList.remove('pop', 'drop');
    Object.assign(proj.style, {
      position: 'fixed', left: s.left + 'px', top: s.top + 'px',
      width: s.width + 'px', height: s.height + 'px', margin: '0', zIndex: '200', pointerEvents: 'none'
    });
    document.body.appendChild(proj);
    src.style.visibility = 'hidden';
    const dx = (t.left + t.width / 2) - (s.left + s.width / 2);
    const dy = (t.top + t.height / 2) - (s.top + s.height / 2);
    proj.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1.3)', opacity: 1, offset: 0.45 },
      { transform: 'translate(' + (dx + 8) + 'px,' + (dy + 92) + 'px) rotate(25deg) scale(0.4)', opacity: 0, offset: 1 }
    ], { duration: 450, easing: 'ease-in' });
    setTimeout(() => {
      impact();
      if (oppColEl) { oppColEl.classList.remove('killed'); void oppColEl.offsetWidth; oppColEl.classList.add('killed'); }
      sfx.play('kill');
      screenShake();
      const cx = t.left + t.width / 2, cy = t.top + t.height / 2;
      spawnImpactFlash(cx, cy);
      spawnParticles(cx, cy, 14, '#d94848', 7);
      spawnParticles(cx, cy, 10, '#e8a838', 5);
    }, 200);
    setTimeout(() => proj.remove(), 470);
  }

  afterKillReroll() {
    if (this.gameOver) return;
    if (!this.generatesRandomness()) return; // opponent will send reroll2 + place2
    this.rollDie((Y) => {
      this.placeAnywhere = true;
      if (this.mode === 'online') this.net.sendAction({ type: 'reroll2', player: this.turn, die: Y });
      if (this.mode === 'ai' && this.turn === this.aiPlayer) setTimeout(() => this.aiPlaceY(), 250);
      else this.enablePlacement();
    });
  }

  // phase 2: place the immune reroll die into any column
  applyPhase2(owner, col, v) {
    if (this.gameOver) return;
    sfx.play('immune');
    this.grids[owner][col].push({ v, im: true, by: this.turn });
    this.lastPlaced = { player: owner, col };
    this.finishPlacement();
  }

  finishPlacement() {
    this.currentDie = 0;
    this.placeAnywhere = false;
    this.disablePlacement();
    this.renderBoards();
    this.renderDie(0, false);
    // game ends only when both players can no longer move
    if (this.isDone(0) && this.isDone(1)) { this.endGame(); return; }
    this.turn = 1 - this.turn;
    setTimeout(() => this.startTurn(), 200);
  }

  // ---------- AI ----------
  scheduleAIMove() { setTimeout(() => this.aiAct(), 350); }

  aiAct() {
    if (this.gameOver) return;
    const ai = this.aiPlayer, X = this.currentDie;

    if (this.difficulty === 'hard') {
      if (validColumns(this.grids[ai]).length === 0) return;
      this.showAIThinking();
      this.aiThink('act', { grids: this.grids, ai, die: X, canReroll: !this.rerollUsed[ai] }, (d) => {
        if (!d) return;
        if (d.action === 'hold') { this.aiDoHold(); return; }
        if (d.action === 'reroll') {
          this.rerollUsed[ai] = true;
          this.rollDie(() => setTimeout(() => this.aiPlace1(), 200));
          return;
        }
        this.applyPhase1(ai, d.col, { v: X, im: false });
      });
      return;
    }
    this.aiPlace1();
  }

  // Run a hard-AI search in the worker; `apply` runs only if the same game is
  // still waiting on this AI move when the answer arrives.
  aiThink(kind, args, apply) {
    const gen = this.aiGen;
    aiWorker.run(kind, args, (result) => {
      if (gen !== this.aiGen || this.gameOver || this.mode !== 'ai') return;
      apply(result);
    });
  }

  showAIThinking() {
    const label = document.getElementById('turn-label');
    label.textContent = this.names[this.aiPlayer] + ' 생각 중...';
  }

  // AI holds (skips remaining turns) — bypasses myTurnNow() guard
  aiDoHold() {
    const ai = this.aiPlayer;
    this.held[ai] = true;
    this.currentDie = 0;
    this.awaitingRoll = false;
    this.disablePlacement();
    this.renderDie(0, false);
    if (this.isDone(0) && this.isDone(1)) { this.endGame(); return; }
    this.turn = 1 - ai;
    setTimeout(() => this.startTurn(), 250);
  }

  aiPlace1() {
    if (this.gameOver) return;
    const ai = this.aiPlayer, opp = 1 - ai, X = this.currentDie;
    const cols = validColumns(this.grids[ai]);
    if (cols.length === 0) return;
    if (this.difficulty === 'easy') {
      this.applyPhase1(ai, cols[Math.floor(Math.random() * cols.length)], { v: X, im: false });
      return;
    }
    // medium: greedy depth-1 (hard uses aiAct() directly)
    let bestC = cols[0], bestV = -Infinity;
    for (const c of cols) {
      const { g, killed } = simMove(this.grids, ai, c, X);
      const val = evalBoard(g, ai) + (killed ? 9 : 0);
      if (val > bestV) { bestV = val; bestC = c; }
    }
    this.applyPhase1(ai, bestC, { v: X, im: false });
  }

  aiPlaceY() {
    if (this.gameOver) return;
    const ai = this.aiPlayer, opp = 1 - ai, Y = this.currentDie;
    if (this.difficulty === 'hard') {
      this.showAIThinking();
      this.aiThink('placeImmune', { grids: this.grids, ai, die: Y }, (best) => {
        if (best) this.applyPhase2(best.owner, best.col, Y);
      });
      return;
    }
    const options = [];
    for (const c of validColumns(this.grids[ai])) options.push({ owner: ai, col: c });
    for (const c of validColumns(this.grids[opp])) options.push({ owner: opp, col: c });
    if (!options.length) return;
    let best = options[0], bestV = -Infinity;
    for (const o of options) {
      const val = evalBoard(simImmune(this.grids, o.owner, o.col, Y), ai);
      if (val > bestV) { bestV = val; best = o; }
    }
    this.applyPhase2(best.owner, best.col, Y);
  }

  // ---------- network actions ----------
  onNetAction(d) {
    if (this.mode !== 'online') return;
    if (d.type === 'roll') {
      this.turn = d.player;
      this.currentDie = d.die;
      sfx.play('diceSettle');
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
    if (this.isSpectator) {
      this.showGameOverBox('👋', '관전 종료', '플레이어가 나가서 게임이 끝났습니다.', false);
    } else {
      this.showGameOverBox('👋', '상대가 나갔어요', '상대방과의 연결이 끊어졌습니다.', false);
    }
  }

  // ---------- render ----------
  setupBoardLabels() {
    const showMine = (this.mode === 'ai' || (this.mode === 'online' && !this.isSpectator));
    document.getElementById('name-bottom').innerHTML =
      nameWithTitle(this.names[this.bottomPlayer()], (showMine ? this.title : null));
    document.getElementById('name-top').textContent = this.names[this.topPlayer()];
  }

  renderBoards() {
    this.renderBoard(document.getElementById('board-bottom'), this.bottomPlayer(), true);
    this.renderBoard(document.getElementById('board-top'), this.topPlayer(), false);
    document.getElementById('total-bottom').textContent = playerScore(this.grids[this.bottomPlayer()]);
    document.getElementById('total-top').textContent = playerScore(this.grids[this.topPlayer()]);
    this.colorDecidedColumns();
  }

  // colour a column once it can no longer change (both sides full)
  colorDecidedColumns() {
    for (let c = 0; c < 3; c++) {
      const decided = this.grids[0][c].length >= 3 && this.grids[1][c].length >= 3;
      const s0 = columnScore(this.grids[0][c]), s1 = columnScore(this.grids[1][c]);
      const winner = s0 > s1 ? 0 : s1 > s0 ? 1 : null;
      [['board-bottom', this.bottomPlayer()], ['board-top', this.topPlayer()]].forEach(([id, owner]) => {
        const cE = document.querySelector('#' + id + ' .board-col[data-col="' + c + '"]');
        if (!cE) return;
        cE.classList.remove('col-won', 'col-lost');
        if (!decided || winner === null) return;
        cE.classList.add(winner === owner ? 'col-won' : 'col-lost');
      });
    }
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
          // colour by who PLACED it, not which board it sits on
          const mine = (d.by === undefined) ? !opp : (d.by === this.bottomPlayer());
          const cls = 'die-face' + (mine ? '' : ' opp') + (d.im ? ' immune' : '') + (isNew ? ' pop' : '');
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
    if (this.turn === this.myPlayer) {
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
      // hint the OPPONENT's column that my rolled value can 알까기 (their zone, white)
      const opp = 1 - p;
      const oppId = this.isBottom(opp) ? 'board-bottom' : 'board-top';
      document.querySelectorAll('#' + oppId + ' .board-col').forEach((cE) => {
        const c = Number(cE.dataset.col);
        if (this.grids[p][c].length < 3 && hasKill(this.grids[opp], c, this.currentDie)) {
          cE.classList.add('kill-hint');
        }
      });
    }
  }

  clearColumnHandlers() {
    ['board-bottom', 'board-top'].forEach(id => {
      const el = document.getElementById(id);
      el.classList.remove('can-place');
      el.querySelectorAll('.board-col').forEach(cE => {
        cE.classList.remove('placeable', 'kill-hint');
        cE.onclick = null;
      });
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

    const { w0, w1, t0, t1, winner } = this.lineResult();
    let icon, title, msg;
    {
      const myP = this.myPlayer;
      const myL = myP === 0 ? w0 : w1, oppL = myP === 0 ? w1 : w0;
      const myT = myP === 0 ? t0 : t1, oppT = myP === 0 ? t1 : t0;
      if (winner === null) { icon = '🤝'; title = '무승부'; }
      else if (winner === myP) { icon = '🏆'; title = '승리!'; }
      else { icon = '😢'; title = '패배'; }
      msg = '라인 ' + myL + ':' + oppL + ' · 총점 ' + myT + ':' + oppT;
      if (this.mode === 'online' && !this.isSpectator) {
        if (winner !== null) this.reportOnlineResult(winner === myP);
        this.net.sendGameFinished();   // mark finished so a later disconnect isn't scored
      }
      if (this.mode === 'ai' && this.difficulty === 'hard') {
        this._aiResultPending = this.reportAiResult(winner === myP);
      }
    }
    if (this.isSpectator) {
      // neutral view for spectators
      const { w0, w1 } = this.lineResult();
      const wn = w0 > w1 ? 0 : w1 > w0 ? 1 : (t0 > t1 ? 0 : t1 > t0 ? 1 : null);
      icon = wn === null ? '🤝' : '🏆';
      title = wn === null ? '무승부' : this.names[wn] + ' 승리!';
      msg = '라인 ' + w0 + ':' + w1 + ' · 총점 ' + t0 + ':' + t1;
    }
    if (!this.isSpectator) {
      if (winner === this.myPlayer) { sfx.play('win'); spawnConfetti(); }
      else if (winner !== null) sfx.play('lose');
    }
    this.showGameOverBox(icon, title, msg, !this.isSpectator);
  }

  reportOnlineResult(won) {
    if (!this.nickname) return;
    const opponent = this.names[1 - this.myPlayer];
    fetch('/api/online-result', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: this.nickname, opponent, won })
    }).catch(() => {});
  }

  async reportAiResult(won) {
    if (!this.nickname) return;
    try {
      const res = await fetch('/api/ai-result', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: this.nickname, difficulty: this.difficulty, won })
      });
      const d = await res.json();
      if (d && typeof d.streak === 'number') this.aiStreak = d.streak;
      if (d && d.title) { this.title = d.title; localStorage.setItem('tikatuka_title', d.title); }
      const el = document.getElementById('gameover-message');
      if (el) {
        if (this.aiStreak >= 2) el.textContent += '   🔥 ' + this.aiStreak + '연승!';
        else if (won === false) el.textContent += '   💔 연승 종료';
        if (d && d.newlyAwarded) el.textContent += '   🎉 칭호 획득: ' + d.title + '!';
      }
    } catch (err) { console.warn('reportAiResult failed:', err); }
  }

  showGameOverBox(icon, title, msg, allowRematch) {
    document.getElementById('gameover-icon').textContent = icon;
    document.getElementById('gameover-title').textContent = title;
    document.getElementById('gameover-message').textContent = msg;
    document.getElementById('btn-rematch').style.display = allowRematch ? '' : 'none';
    document.getElementById('btn-rematch').disabled = false;
    document.getElementById('btn-rematch').textContent = '다시 하기';
    setTimeout(() => document.getElementById('overlay-gameover').classList.add('active'), 450);
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
    if (this.isSpectator) {
      // reset the spectator view and keep following the new game
      this.grids = [[[], [], []], [[], [], []]];
      this.turn = 0; this.currentDie = 0; this.gameOver = false; this.placeAnywhere = false;
      this.held = [false, false]; this.rerollUsed = [false, false]; this.immuneFirstUsed = false;
      this.lastPlaced = null;
      this.closeOverlay();
      this.renderBoards(); this.renderDie(0, false); this.updateTurnUI();
      return;
    }
    this.startGame();
  }

  async exitGame() {
    // skip confirm if game is already over (gameover overlay visible)
    if (!this.gameOver) {
      const ok = await this._confirm('나가기', '정말 나가시겠습니까?\n진행 중인 게임이 종료됩니다.');
      if (!ok) return;
    }
    if (this.mode === 'online') this.net.disconnect();
    this.mode = null;
    this.isSpectator = false;
    this.myPlayer = 0;
    this.closeOverlay();
    this.showMenu();
  }

  toggleMute() {
    sfx.init();
    sfx.setMuted(!sfx.muted);
    document.getElementById('btn-mute').textContent = sfx.muted ? '🔇' : '🔊';
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
