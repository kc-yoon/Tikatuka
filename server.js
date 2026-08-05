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
const memUsers = new Map(); // nicknameLower -> { nickname, password, wins, losses, ai_streak, title }
const memH2H = new Map();   // `${playerLower}|${oppLower}` -> { wins, losses }

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tikatuka_users (
      id SERIAL PRIMARY KEY,
      nickname VARCHAR(12) NOT NULL,
      nickname_lower VARCHAR(12) UNIQUE NOT NULL,
      password VARCHAR(20) NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      ai_streak INTEGER NOT NULL DEFAULT 0,
      title VARCHAR(20)
    )
  `);
  await pool.query('ALTER TABLE tikatuka_users ADD COLUMN IF NOT EXISTS ai_streak INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE tikatuka_users ADD COLUMN IF NOT EXISTS title VARCHAR(20)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tikatuka_h2h (
      player_lower VARCHAR(12) NOT NULL,
      opponent_lower VARCHAR(12) NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (player_lower, opponent_lower)
    )
  `);
  // one-time reset when TIKATUKA_RESET=1 is set on the environment
  if (process.env.TIKATUKA_RESET === '1') {
    await pool.query('DELETE FROM tikatuka_users');
    await pool.query('DELETE FROM tikatuka_h2h');
    console.log('⚠️ 티카투카 사용자/전적 초기화 완료 (TIKATUKA_RESET)');
  }
  console.log('DB 테이블 준비 완료');
}

if (useDB) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  initDB().catch(err => console.error('DB 초기화 실패:', err));
} else {
  console.log('DATABASE_URL 없음 → 인메모리 저장소 사용 (로컬 개발용)');
}

const store = {
  async getUser(nameLower) {
    if (useDB) {
      const r = await pool.query(
        'SELECT nickname, password, wins, losses, ai_streak, title FROM tikatuka_users WHERE nickname_lower = $1',
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
      memUsers.set(nameLower, { nickname, password, wins: 0, losses: 0, ai_streak: 0, title: null });
    }
  },
  // AI-hard win streak; award 알파고 title at 10
  async addAiResult(nameLower, won) {
    if (useDB) {
      if (won) {
        const r = await pool.query(
          'UPDATE tikatuka_users SET ai_streak = ai_streak + 1 WHERE nickname_lower = $1 RETURNING ai_streak',
          [nameLower]);
        const streak = r.rows[0] ? r.rows[0].ai_streak : 0;
        if (streak >= 10) {
          await pool.query("UPDATE tikatuka_users SET title = '알파고' WHERE nickname_lower = $1", [nameLower]);
          return { streak, title: '알파고' };
        }
        return { streak, title: null };
      }
      await pool.query('UPDATE tikatuka_users SET ai_streak = 0 WHERE nickname_lower = $1', [nameLower]);
      return { streak: 0, title: null };
    }
    const u = memUsers.get(nameLower);
    if (!u) return { streak: 0, title: null };
    if (won) { u.ai_streak = (u.ai_streak || 0) + 1; if (u.ai_streak >= 10) u.title = '알파고'; return { streak: u.ai_streak, title: u.title || null }; }
    u.ai_streak = 0; return { streak: 0, title: u.title || null };
  },
  // records an online (human vs human) result for `player` against `opponent`
  async addOnlineResult(playerLower, opponentLower, won) {
    const col = won ? 'wins' : 'losses';
    if (useDB) {
      await pool.query(`UPDATE tikatuka_users SET ${col} = ${col} + 1 WHERE nickname_lower = $1`, [playerLower]);
      await pool.query(
        `INSERT INTO tikatuka_h2h (player_lower, opponent_lower, wins, losses)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (player_lower, opponent_lower)
         DO UPDATE SET ${col} = tikatuka_h2h.${col} + 1`,
        [playerLower, opponentLower, won ? 1 : 0, won ? 0 : 1]
      );
    } else {
      const u = memUsers.get(playerLower);
      if (u) { if (won) u.wins++; else u.losses++; }
      const key = playerLower + '|' + opponentLower;
      const h = memH2H.get(key) || { wins: 0, losses: 0 };
      if (won) h.wins++; else h.losses++;
      memH2H.set(key, h);
    }
  },
  async getH2H(playerLower, opponentLower) {
    if (useDB) {
      const r = await pool.query(
        'SELECT wins, losses FROM tikatuka_h2h WHERE player_lower = $1 AND opponent_lower = $2',
        [playerLower, opponentLower]
      );
      return r.rows[0] || { wins: 0, losses: 0 };
    }
    return memH2H.get(playerLower + '|' + opponentLower) || { wins: 0, losses: 0 };
  },
  async leaderboard() {
    if (useDB) {
      const r = await pool.query(
        'SELECT nickname, wins, losses, title FROM tikatuka_users ORDER BY wins DESC, losses ASC LIMIT 20'
      );
      return r.rows;
    }
    return [...memUsers.values()]
      .map(u => ({ nickname: u.nickname, wins: u.wins, losses: u.losses, title: u.title || null }))
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
    res.json({ ok: true, nickname: user.nickname, title: user.title || null });
  } catch (err) {
    res.json({ ok: false, reason: '서버 오류가 발생했습니다.' });
  }
});

// AI-hard result → track win streak, award 알파고 title at 10 (does NOT affect ranking)
app.post('/api/ai-result', async (req, res) => {
  const name = (req.body.nickname || '').trim();
  const difficulty = (req.body.difficulty || '').trim();
  const won = !!req.body.won;
  if (!name || difficulty !== 'hard') return res.json({ ok: true, streak: 0, title: null });
  try {
    const r = await store.addAiResult(name.toLowerCase(), won);
    res.json({ ok: true, streak: r.streak, title: r.title || null });
  } catch (err) {
    res.json({ ok: false });
  }
});

// online (human) result only — updates ranking totals + head-to-head
app.post('/api/online-result', async (req, res) => {
  const name = (req.body.nickname || '').trim();
  const opp = (req.body.opponent || '').trim();
  const won = !!req.body.won;
  if (!name || !opp) return res.json({ ok: false });
  try {
    await store.addOnlineResult(name.toLowerCase(), opp.toLowerCase(), won);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.get('/api/h2h', async (req, res) => {
  const player = (req.query.player || '').trim();
  const opponent = (req.query.opponent || '').trim();
  if (!player || !opponent) return res.json({ wins: 0, losses: 0 });
  try {
    res.json(await store.getH2H(player.toLowerCase(), opponent.toLowerCase()));
  } catch (err) {
    res.json({ wins: 0, losses: 0 });
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
    rooms.set(code, { players: [socket.id], nicknames: { 1: nickname }, spectators: [], finished: false });
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
    room.finished = false;
    socket.emit('roomJoined', { code, playerNumber: 2 });
    io.to(code).emit('gameStart', { players: room.players.length, nicknames: room.nicknames });
    console.log(`[방 참가] ${code} by ${nickname}`);
  });

  // a client reports the game finished normally (so a later disconnect isn't scored)
  socket.on('gameFinished', () => {
    const room = rooms.get(socket.roomCode);
    if (room) room.finished = true;
  });

  // spectators join a room as viewers (no player slot)
  socket.on('spectateRoom', (data) => {
    const code = (data.code || '').toUpperCase().trim();
    const nickname = data.nickname || '관전자';
    const room = rooms.get(code);
    if (!room) return socket.emit('roomError', '존재하지 않는 방입니다.');
    if (room.players.length < 2) return socket.emit('roomError', '아직 대전이 시작되지 않았습니다.');
    room.spectators = room.spectators || [];
    room.spectators.push(socket.id);
    socket.join(code);
    socket.roomCode = code;
    socket.isSpectator = true;
    socket.nickname = nickname;
    socket.emit('spectateJoined', { nicknames: room.nicknames });
    // ask the host for the current game state
    if (room.players[0]) io.to(room.players[0]).emit('requestSnapshot', { to: socket.id });
    console.log(`[관전 참가] ${code} by ${nickname}`);
  });

  // host replies with a state snapshot; relay to the requesting spectator
  socket.on('snapshot', (data) => {
    if (data && data.to) io.to(data.to).emit('snapshot', data.state);
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
    const room = rooms.get(socket.roomCode);
    if (room) room.finished = false;
    io.to(socket.roomCode).emit('rematchStart');
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code) {
      const room = rooms.get(code);
      if (room) {
        if (socket.isSpectator) {
          room.spectators = (room.spectators || []).filter(id => id !== socket.id);
        } else {
          // if a full game was in progress and not finished, the leaver loses
          const twoPlayers = room.nicknames[1] && room.nicknames[2];
          if (twoPlayers && !room.finished && room.players.length === 2) {
            const leaverNum = socket.playerNumber;
            const otherNum = leaverNum === 1 ? 2 : 1;
            const leaver = room.nicknames[leaverNum];
            const other = room.nicknames[otherNum];
            if (leaver && other) {
              room.finished = true;
              store.addOnlineResult(leaver.toLowerCase(), other.toLowerCase(), false).catch(() => {});
              store.addOnlineResult(other.toLowerCase(), leaver.toLowerCase(), true).catch(() => {});
            }
          }
          socket.to(code).emit('opponentLeft');   // a player left
          room.players = room.players.filter(id => id !== socket.id);
          if (room.players.length === 0) rooms.delete(code);
        }
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
