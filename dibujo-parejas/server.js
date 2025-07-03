import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';


const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = 3000;
const JWT_SECRET = 'clave_super_secreta_dibujo';
const ROUND_DURATION = 90;
const MAX_ROUNDS = 5;
const BONUS_SPEED = 5;   // +5 pts si adivina en < 20 seg
const BONUS_STREAK = 5;  // +5 pts si lleva racha

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/login', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Nombre de usuario requerido' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.username = decoded.username;
    next();
  } catch (err) {
    next(new Error('Token inválido'));
  }
});

let players = [];
let currentDrawer = null;
let currentWord = '';
let roundTimer = null;
let roundStartTime = null;
let roundCount = 0;
const words = JSON.parse(fs.readFileSync('./words.json', 'utf8'));


io.on('connection', (socket) => {
  console.log(`🔗 ${socket.username} conectado`);
  players.push({ id: socket.id, username: socket.username, score: 0, streak: 0 });

  io.emit('toast', { message: `✅ ${socket.username} se ha unido`, type: 'success' });
  updateScoreBoard();

  if (players.length >= 2 && !currentDrawer) {
    startNewRound();
  }

  socket.on('draw', data => socket.broadcast.emit('draw', data));
  socket.on('clear-canvas', () => io.emit('canvas-cleared'));
  socket.on('undo-stroke', state => io.emit('undo-stroke', state));
  socket.on('redo-stroke', state => io.emit('redo-stroke', state));
  
socket.on('guess', ({ text }) => {
  const guess = text.trim().toLowerCase();
  if (!currentWord || !currentDrawer) return;

  const sender = players.find(p => p.id === socket.id);
  if (!sender) return;

  // Solo mostrar en el chat si la palabra es incorrecta
  if (guess !== currentWord.toLowerCase() || socket.id === currentDrawer.id) {
    io.emit('chat-message', { username: sender.username, message: guess });
  }

    if (guess === currentWord.toLowerCase() && socket.id !== currentDrawer.id) {
      const now = Date.now();
      const timeTaken = (now - roundStartTime) / 1000;
      let points = 10;

      if (timeTaken < 20) points += BONUS_SPEED;
      if (sender.streak >= 2) points += BONUS_STREAK;

      sender.score += points;
      sender.streak += 1;

      players.forEach(p => {
        if (p.id !== sender.id) p.streak = 0;
      });

      io.emit('chat-message', { username: 'Sistema', message: `🎉 ${sender.username} adivinó la palabra` });

      io.emit('round-end', {
        drawer: currentDrawer.username,
        word: currentWord,
        winner: sender.username
      });

      updateScoreBoard();
      clearTimeout(roundTimer);
      currentDrawer = null;

      if (++roundCount >= MAX_ROUNDS) {
        const ganador = getWinner();
        io.emit('game-over', { winner: ganador });
        setTimeout(resetGame, 5000);
      } else {
        setTimeout(startNewRound, 3000);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ ${socket.username} desconectado`);
    players = players.filter(p => p.id !== socket.id);

    if (currentDrawer && currentDrawer.id === socket.id) {
      clearTimeout(roundTimer);
      currentDrawer = null;
      io.emit('toast', { message: `⚠️ ${socket.username} (dibujante) se fue`, type: 'warning' });
      setTimeout(startNewRound, 2000);
    } else {
      io.emit('toast', { message: `👋 ${socket.username} salió`, type: 'info' });
    }
    updateScoreBoard();
  });
});

function startNewRound() {
  if (players.length < 2) return;

  const candidates = players.filter(p => !currentDrawer || p.id !== currentDrawer.id);
  const nextDrawer = candidates[Math.floor(Math.random() * candidates.length)];
  currentDrawer = nextDrawer;
  currentWord = words[Math.floor(Math.random() * words.length)];

  // Generar palabra oculta con guiones bajos
  const hidden = currentWord.split('').map(() => '_').join(' ');

  io.emit('round-start', {
    drawer: currentDrawer.username,
    duration: ROUND_DURATION,
    wordLength: hidden
  });

  io.to(currentDrawer.id).emit('your-word', { word: currentWord });

  roundStartTime = Date.now();

  // PISTA: Revelar una letra a mitad del tiempo
  setTimeout(() => {
    if (currentWord && currentDrawer) {
      const index = Math.floor(Math.random() * currentWord.length);
      const letter = currentWord[index];
      io.emit('hint', { index, letter });
    }
  }, (ROUND_DURATION / 2) * 1000);

  roundTimer = setTimeout(() => {
    io.emit('round-end', {
      drawer: currentDrawer.username,
      word: currentWord,
      winner: null
    });
    currentDrawer = null;

    if (++roundCount >= MAX_ROUNDS) {
      const ganador = getWinner();
      io.emit('game-over', { winner: ganador, ranking: [...players].sort((a, b) => b.score - a.score) });
      setTimeout(resetGame, 5000);
    } else {
      setTimeout(startNewRound, 3000);
    }
  }, ROUND_DURATION * 1000);
}


function resetGame() {
  roundCount = 0;
  players.forEach(p => {
    p.score = 0;
    p.streak = 0;
  });
  updateScoreBoard();
  startNewRound();
}

function updateScoreBoard() {
  io.emit('score-update', players);
}

function getWinner() {
  if (players.length === 0) return 'Nadie';
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted[0].username;
}

server.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
