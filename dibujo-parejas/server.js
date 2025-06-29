// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});


// pastel y pollo con manzana y jugo verde

const PORT = 3000;
const JWT_SECRET = 'clave_super_secreta_dibujo';

app.use(cors());
app.use(express.json());

// Servir archivo HTML
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));

// Login simple con JWT
app.post('/login', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Nombre requerido' });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// Validación de sockets con JWT
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

// Eventos de sockets
io.on('connection', (socket) => {
  console.log(`🔗 ${socket.username} conectado`);

  socket.on('draw', (data) => {
    socket.broadcast.emit('draw', data);
  });

  socket.on('start-timer', ({ duration }) => {
    io.emit('timer-started', { duration });

    setTimeout(() => {
      io.emit('timer-ended');
    }, duration * 1000);
  });

  socket.on('clear-canvas', () => {
    io.emit('canvas-cleared');
  });

  socket.on('disconnect', () => {
    console.log(`❌ ${socket.username} se desconectó`);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
