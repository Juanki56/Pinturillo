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
    origin: '*' // Permite conexiones desde cualquier origen. Esto es útil para desarrollo.
  }
});

const PORT = 3000;
const JWT_SECRET = 'clave_super_secreta_dibujo'; // ¡Recuerda usar una clave secreta fuerte y segura en producción!

app.use(cors()); // Habilita CORS para todas las rutas
app.use(express.json()); // Permite a Express parsear JSON en el cuerpo de las solicitudes

// Define __dirname para módulos ES
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Sirve archivos estáticos (como tu archivo HTML del cliente) desde la carpeta 'public'
// Asegúrate de que tu archivo HTML esté dentro de una carpeta llamada 'public' en la misma ubicación que server.js
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint de login simple con JWT
app.post('/login', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Nombre de usuario requerido' });
  }

  // Firma un token JWT con el nombre de usuario, con expiración de 1 hora
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// Middleware de autenticación de Socket.IO con JWT
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.username = decoded.username; // Adjunta el nombre de usuario al objeto socket
    next(); // Procede con la conexión si el token es válido
  } catch (err) {
    // Si el token es inválido, rechaza la conexión con un error
    next(new Error('Token inválido'));
  }
});

// Manejo de eventos de Socket.IO
io.on('connection', (socket) => {
  console.log(`🔗 ${socket.username} conectado`);

  // --- LÓGICA DE DIBUJO COMPARTIDA ---
  // Ahora el evento 'draw' recibe un objeto 'data' que incluye x, y, color y lineWidth
  socket.on('draw', (data) => {
    // Reenvía los datos de dibujo (coordenadas, color, ancho) a todos los demás clientes conectados
    socket.broadcast.emit('draw', data); 
  });
  // --- FIN LÓGICA DE DIBUJO COMPARTIDA ---

  // Manejo del inicio del temporizador
  socket.on('start-timer', ({ duration }) => {
    // Emite a todos los clientes que el temporizador ha iniciado con una duración específica
    io.emit('timer-started', { duration });

    // Configura un temporizador para emitir el evento 'timer-ended' después de la duración
    setTimeout(() => {
      io.emit('timer-ended');
    }, duration * 1000); // La duración se da en segundos, se convierte a milisegundos
  });

  // Manejo del borrado del lienzo
  socket.on('clear-canvas', () => {
    // Emite a todos los clientes la señal para limpiar su lienzo
    io.emit('canvas-cleared');
  });

  // Manejo de la desconexión del cliente
  socket.on('disconnect', () => {
    console.log(`❌ ${socket.username} se desconectó`);
  });
});

// El servidor empieza a escuchar en el puerto definido
server.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});