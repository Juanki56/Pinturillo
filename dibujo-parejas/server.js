// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = 3000;
const JWT_SECRET = 'clave_super_secreta_dibujo';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let players = [];
let currentDrawerIndex = 0;
let currentWord = '';
let roundInProgress = false;

const words = JSON.parse(fs.readFileSync(path.join(__dirname, 'words.json'), 'utf-8'));

app.post('/login', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Nombre requerido' });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.username = decoded.username;
    next();
  } catch {
    next(new Error('Token inválido'));
  }
});

io.on('connection', (socket) => {
  console.log(`🟢 ${socket.username} conectado`);

  if (!players.some(p => p.username === socket.username)) {
    players.push({ id: socket.id, username: socket.username, score: 0 });
  }

  io.emit('score-update', players);
  io.emit('toast', { message: `🔔 ${socket.username} se ha unido`, type: 'info' });

  socket.on('start-timer', ({ duration }) => {
    io.emit('timer-started', { duration });

    setTimeout(() => {
      io.emit('timer-ended');
    }, duration * 1000);
  });

  socket.on('start-round', () => {
    if (!roundInProgress && players.length >= 2) {
      startNewRound();
    }
  });

  socket.on('draw', (data) => {
    socket.broadcast.emit('draw', data);
  });

  socket.on('clear-canvas', () => {
    io.emit('canvas-cleared');
  });

  socket.on('undo-stroke', (state) => {
    socket.broadcast.emit('undo-stroke', state);
  });

  socket.on('redo-stroke', (state) => {
    socket.broadcast.emit('redo-stroke', state);
  });

  socket.on('guess', ({ text }) => {
    const player = players.find(p => p.id === socket.id);
    if (!player || !roundInProgress) return;

    io.emit('chat-message', { username: player.username, message: text });

    if (text.toLowerCase() === currentWord.toLowerCase()) {
      player.score += 10;
      io.emit('score-update', players);
      io.emit('round-end', {
        drawer: players[currentDrawerIndex].username,
        word: currentWord,
        winner: player.username
      });
      roundInProgress = false;
      setTimeout(startNewRound, 3000);
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔴 ${socket.username} desconectado`);
    players = players.filter(p => p.id !== socket.id);
    io.emit('score-update', players);
    io.emit('toast', { message: `🚪 ${socket.username} salió`, type: 'error' });

    if (roundInProgress && socket.id === players[currentDrawerIndex]?.id) {
      io.emit('round-end', {
        drawer: players[currentDrawerIndex].username,
        word: currentWord,
        winner: null
      });
      roundInProgress = false;
      setTimeout(startNewRound, 3000);
    }
  });
});

function startNewRound() {
  if (players.length < 2) return;

  roundInProgress = true;
  currentDrawerIndex = (currentDrawerIndex + 1) % players.length;
  currentWord = words[Math.floor(Math.random() * words.length)];
  const drawer = players[currentDrawerIndex];

  io.emit('round-start', { drawer: drawer.username, duration: 60 });
  io.to(drawer.id).emit('your-word', { word: currentWord });

  setTimeout(() => {
    if (roundInProgress) {
      io.emit('round-end', {
        drawer: drawer.username,
        word: currentWord,
        winner: null
      });
      roundInProgress = false;
      setTimeout(startNewRound, 3000);
    }
  }, 60000);
}

server.listen(PORT, () => {
  console.log(`✅ Servidor en http://localhost:${PORT}`);
});
