const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== STORAGE ====================
// Uses PostgreSQL when DATABASE_URL is set (production), otherwise an
// in-memory store so local development works without a database.

const useDB = !!process.env.DATABASE_URL;
let pool = null;
const memUsers = new Map(); // nicknameLower -> { nickname, password, wins, losses }

if (useDB) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  pool.query(`
    CREATE TABLE IF NOT EXISTS tikatuka_users (
      id SERIAL PRIMARY KEY,
      nickname VARCHAR(12) NOT NULL,
      nickname_lower VARCHAR(12) UNIQUE NOT NULL,
      password VARCHAR(20) NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0
    )
  `).then(() => console.log('DB 테이블 준비 완료'))
    .catch(err => console.error('DB 초기화 실패:', err));
} else {
  console.log('DATABASE_URL 없음 → 인메모리 저장소 사용 (로컬 개발용)');
}

const store = {
  async getUser(nameLower) {
    if (useDB) {
      const r = await pool.query(
        'SELECT nickname, password, wins, losses FROM tikatuka_users WHERE nickname_lower = $1',
        [nameLower]
      );
      return r.rows[0] || null;
    }
    return memUsers.get(nameLower) || null;
  },
  async createUser(nickname, nameLower, password) {
    if (useDB) {
      await pool.query(
        'INSERT INTO tikatuka_users (nickname, nickname_lower, password) VALUES ($1, $2, $3)',
        [nickname, nameLower, password]
      );
    } else {
      memUsers.set(nameLower, { nickname, password, wins: 0, losses: 0 });
    }
  },
  async addResult(nameLower, won) {
    if (useDB) {
      const col = won ? 'wins' : 'losses';
      await pool.query(`UPDATE tikatuka_users SET ${col} = ${col} + 1 WHERE nickname_lower = $1`, [nameLower]);
    } else {
      const u = memUsers.get(nameLower);
      if (u) { if (won) u.wins++; else u.losses++; }
    }
  },
  async leaderboard() {
    if (useDB) {
      const r = await pool.query(
        'SELECT nickname, wins, losses FROM tikatuka_users ORDER BY wins DESC, losses ASC LIMIT 20'
      );
      return r.rows;
    }
    return [...memUsers.values()]
      .map(u => ({ nickname: u.nickname, wins: u.wins, losses: u.losses }))
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
      .slice(0, 20);
  }
};

// ==================== AUTH API ====================

app.post('/api/register', async (req, res) => {
  const name = (req.body.nickname || '').trim();
  const pw = (req.body.password || '').trim();
  if (!name || name.length < 2 || name.length > 12) {
    return res.json({ ok: false, reason: '닉네임은 2~12자로 입력해주세요.' });
  }
  if (!pw || pw.length < 4 || pw.length > 20) {
    return res.json({ ok: false, reason: '비밀번호는 4~20자로 입력해주세요.' });
  }
  try {
    const existing = await store.getUser(name.toLowerCase());
    if (existing) return res.json({ ok: false, reason: '이미 사용 중인 닉네임입니다.' });
    await store.createUser(name, name.toLowerCase(), pw);
    res.json({ ok: true, nickname: name });
  } catch (err) {
    res.json({ ok: false, reason: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/login', async (req, res) => {
  const name = (req.body.nickname || '').trim();
  const pw = (req.body.password || '').trim();
  if (!name || !pw) return res.json({ ok: false, reason: '닉네임과 비밀번호를 입력해주세요.' });
  try {
    const user = await store.getUser(name.toLowerCase());
    if (!user) return res.json({ ok: false, reason: '존재하지 않는 닉네임입니다.' });
    if (user.password !== pw) return res.json({ ok: false, reason: '비밀번호가 틀렸습니다.' });
    res.json({ ok: true, nickname: user.nickname });
  } catch (err) {
    res.json({ ok: false, reason: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/result', async (req, res) => {
  const name = (req.body.nickname || '').trim();
  const won = !!req.body.won;
  if (!name) return res.json({ ok: false });
  try {
    await store.addResult(name.toLowerCase(), won);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    res.json(await store.leaderboard());
  } catch (err) {
    res.json([]);
  }
});

// ==================== ROOMS (socket.io) ====================

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

io.on('connection', (socket) => {
  console.log(`[연결] ${socket.id}`);

  socket.on('createRoom', (data) => {
    const code = generateCode();
    const nickname = (data && data.nickname) || 'Player 1';
    rooms.set(code, { players: [socket.id], nicknames: { 1: nickname } });
    socket.join(code);
    socket.roomCode = code;
    socket.playerNumber = 1;
    socket.nickname = nickname;
    socket.emit('roomCreated', { code, playerNumber: 1 });
    console.log(`[방 생성] ${code} by ${nickname}`);
  });

  socket.on('joinRoom', (data) => {
    const code = (data.code || '').toUpperCase().trim();
    const nickname = data.nickname || 'Player 2';
    const room = rooms.get(code);
    if (!room) return socket.emit('roomError', '존재하지 않는 방입니다.');
    if (room.players.length >= 2) return socket.emit('roomError', '방이 가득 찼습니다.');

    room.players.push(socket.id);
    room.nicknames[2] = nickname;
    socket.join(code);
    socket.roomCode = code;
    socket.playerNumber = 2;
    socket.nickname = nickname;
    socket.emit('roomJoined', { code, playerNumber: 2 });
    io.to(code).emit('gameStart', { players: room.players.length, nicknames: room.nicknames });
    console.log(`[방 참가] ${code} by ${nickname}`);
  });

  socket.on('gameAction', (data) => {
    if (!socket.roomCode) return;
    socket.to(socket.roomCode).emit('gameAction', data);
  });

  socket.on('chatMessage', (msg) => {
    if (!socket.roomCode) return;
    socket.to(socket.roomCode).emit('chatMessage', {
      nickname: socket.nickname || 'Player',
      text: (msg || '').substring(0, 100)
    });
  });

  socket.on('rematch', () => {
    if (!socket.roomCode) return;
    socket.to(socket.roomCode).emit('rematchRequested');
  });

  socket.on('rematchAccept', () => {
    if (!socket.roomCode) return;
    io.to(socket.roomCode).emit('rematchStart');
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code) {
      socket.to(code).emit('opponentLeft');
      const room = rooms.get(code);
      if (room) {
        room.players = room.players.filter(id => id !== socket.id);
        if (room.players.length === 0) rooms.delete(code);
      }
    }
    console.log(`[연결 해제] ${socket.id}`);
  });
});

setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.players.length === 0) rooms.delete(code);
  }
}, 60000);

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`티카투카 서버 실행 중: http://localhost:${PORT}`);
});
