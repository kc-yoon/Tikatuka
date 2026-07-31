const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

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
    rooms.set(code, {
      players: [socket.id],
      nicknames: { 1: nickname }
    });
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

  // 상대에게 수(주사위 값 + 놓은 열)를 그대로 전달
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
