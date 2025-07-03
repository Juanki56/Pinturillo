let socket;
let painting = false;
let canvas, ctx;
let currentBrushColor = 'black';
let currentBrushSize = 6;
let canvasHistory = [];
let historyPointer = -1;
const MAX_HISTORY_STEPS = 50;
let lastSelectedToolButton = null;
let lastSelectedSizeButton = null;
let activeTool = 'brush';
let isMyTurnToDraw = false;
const correctSound = new Audio('/sounds/correct.mp3');
const winnerSound = new Audio('/sounds/winner.mp3');

function login() {
  const username = document.getElementById('username').value;
  fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  })
    .then(res => res.json())
    .then(data => {
      if (data.token) initSocket(data.token);
      else alert('Error al iniciar sesión');
    });
}

function initSocket(token) {
  socket = io({ auth: { token } });

  socket.on('connect', () => {
    document.getElementById('login').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    setupCanvas();
    saveCanvasState();
    updateUndoRedoButtons();
    setupChat();
  });

  socket.on('draw', ({ x, y, color, lineWidth }) => {
    draw(x, y, color, lineWidth, false);
  });

  socket.on('canvas-cleared', clearCanvasLocal);

  socket.on('undo-stroke', restoreCanvasState);
  socket.on('redo-stroke', restoreCanvasState);

  socket.on('timer-started', handleTimer);
  socket.on('timer-ended', () => showToast('⏰ Tiempo terminado', 'info'));

  socket.on('round-start', ({ drawer, duration, wordLength }) => {
  isMyTurnToDraw = false;
  showToast(`🎮 Nuevo turno: ${drawer} dibuja`, 'info');
  startTimer(duration);
  clearCanvasLocal();

  // Mostrar los espacios de la palabra (solo si no eres el dibujante)
  const display = document.getElementById('wordDisplay');
  display.textContent = wordLength;
  display.style.display = 'block';
});

 socket.on('your-word', ({ word }) => {
  isMyTurnToDraw = true;
  showToast(`✏️ Tu palabra es: "${word}"`, 'success');
  
  // Mostrar la palabra constantemente en pantalla
  const wordContainer = document.getElementById('drawerWordContainer');
  const wordSpan = document.getElementById('drawerWord');
  wordSpan.textContent = word;
  wordContainer.style.display = 'block';
});

socket.on('round-end', ({ drawer, word, winner }) => {
  document.getElementById('drawerWordContainer').style.display = 'none';
  document.getElementById('wordDisplay').style.display = 'none';

  if (winner) {
    correctSound.play(); // ✅ Sonido al acertar
    showToast(`🏆 ${winner} adivinó la palabra "${word}"`, 'success');
  } else {
    showToast(`😅 Nadie adivinó la palabra "${word}"`, 'warning');
  }
});

  socket.on('score-update', updateScoreBoard);

  socket.on('chat-message', ({ username, message }) => {
    const chat = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.textContent = `${username}: ${message}`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  });

  socket.on('toast', ({ message, type }) => showToast(message, type));

socket.on('game-over', ({ winner, ranking }) => {
  // 1. Mostrar ganador
  const container = document.createElement('div');
  container.className = 'final-winner-notification';
  container.innerHTML = `
    🏆 <strong>${winner}</strong> ha ganado la partida 🏆<br><small>¡Felicitaciones!</small>
  `;
  document.body.appendChild(container);

  winnerSound.play();
  setTimeout(() => container.remove(), 4000);

  // 2. Mostrar el ranking
  setTimeout(() => {
    const rankingBox = document.createElement('div');
    rankingBox.className = 'ranking-container';
    rankingBox.innerHTML = `<h3>🏅 Ranking Final</h3>`;

    const ul = document.createElement('ul');
    ranking.forEach((player, i) => {
      const li = document.createElement('li');
      li.textContent = `${i + 1}. ${player.username} - ${player.score} pts`;
      ul.appendChild(li);
    });

    rankingBox.appendChild(ul);
    document.body.appendChild(rankingBox);

    setTimeout(() => rankingBox.remove(), 8000);
  }, 4500);
});

socket.on('hint', ({ index, letter }) => {
  const display = document.getElementById('wordDisplay');
  const current = display.textContent.split(' ');
  current[index] = letter.toUpperCase();
  display.textContent = current.join(' ');
});




}



function setupCanvas() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--input-bg');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', stopDrawing);
  canvas.addEventListener('mousemove', drawOnCanvas);

  const black = document.querySelector('.color-button[onclick*="--brush-black"]');
  if (black) selectBrushColor(black, 'var(--brush-black)');
  const size = document.querySelector('.size-button[data-size="6"]');
  if (size) selectBrushSize(size, 6);
}

function startDrawing(e) {
  if (!isMyTurnToDraw) return;
  painting = true;
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);
}

function stopDrawing() {
  if (!painting) return;
  painting = false;
  ctx.beginPath();
  saveCanvasState();
  updateUndoRedoButtons();
}

function drawOnCanvas(e) {
  if (!painting || !isMyTurnToDraw) return;
  const x = e.offsetX;
  const y = e.offsetY;
  draw(x, y, currentBrushColor, currentBrushSize, true);
  socket.emit('draw', { x, y, color: currentBrushColor, lineWidth: currentBrushSize });
}

function draw(x, y, color, size, local) {
  ctx.lineWidth = local ? currentBrushSize : size;
  ctx.strokeStyle = local ? currentBrushColor : color;
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function clearCanvas() {
  clearCanvasLocal();
  socket.emit('clear-canvas');
}

function clearCanvasLocal() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--input-bg');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  canvasHistory = [];
  historyPointer = -1;
  saveCanvasState();
  updateUndoRedoButtons();
}

function startTimer(seconds) {
  const timerDisplay = document.getElementById('timerDisplay');
  let timeLeft = seconds;
  timerDisplay.textContent = `⏳ ${timeLeft}s`;

  clearInterval(window.timerInterval);
  window.timerInterval = setInterval(() => {
    timeLeft--;
    timerDisplay.textContent = `⏳ ${timeLeft}s`;
    if (timeLeft <= 0) {
      clearInterval(window.timerInterval);
    }
  }, 1000);
}

function handleTimer({ duration }) {
  startTimer(duration);
}

function saveCanvasState() {
  if (historyPointer < canvasHistory.length - 1) {
    canvasHistory = canvasHistory.slice(0, historyPointer + 1);
  }
  const dataURL = canvas.toDataURL();
  if (canvasHistory.length >= MAX_HISTORY_STEPS) canvasHistory.shift();
  canvasHistory.push(dataURL);
  historyPointer = canvasHistory.length - 1;
}

function restoreCanvasState(dataURL) {
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = dataURL;
}

function undoLastStroke() {
  if (historyPointer > 0) {
    historyPointer--;
    restoreCanvasState(canvasHistory[historyPointer]);
    socket.emit('undo-stroke', canvasHistory[historyPointer]);
  }
  updateUndoRedoButtons();
}

function redoLastStroke() {
  if (historyPointer < canvasHistory.length - 1) {
    historyPointer++;
    restoreCanvasState(canvasHistory[historyPointer]);
    socket.emit('redo-stroke', canvasHistory[historyPointer]);
  }
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  document.getElementById('undoButton').disabled = historyPointer <= 0;
  document.getElementById('redoButton').disabled = historyPointer >= canvasHistory.length - 1;
}

function selectToolButton(el) {
  if (lastSelectedToolButton) lastSelectedToolButton.classList.remove('selected');
  el.classList.add('selected');
  lastSelectedToolButton = el;
}

function selectBrushColor(el, variable) {
  selectToolButton(el);
  activeTool = 'brush';
  currentBrushColor = getComputedStyle(document.documentElement).getPropertyValue(variable.replace('var(', '').replace(')', ''));
  ctx.strokeStyle = currentBrushColor;
  ctx.lineWidth = currentBrushSize;
}

function selectBrushSize(el, size) {
  if (lastSelectedSizeButton) lastSelectedSizeButton.classList.remove('selected');
  el.classList.add('selected');
  lastSelectedSizeButton = el;
  currentBrushSize = size;
  ctx.lineWidth = size;
}

function selectEraser() {
  const eraser = document.querySelector('.color-button.eraser-button');
  selectToolButton(eraser);
  activeTool = 'eraser';
  currentBrushColor = getComputedStyle(document.documentElement).getPropertyValue('--eraser-color');
  ctx.strokeStyle = currentBrushColor;

  if (!lastSelectedSizeButton) {
    const defaultSize = document.querySelector('.size-button[data-size="16"]');
    if (defaultSize) selectBrushSize(defaultSize, 16);
  }
}

function setupChat() {
  const input = document.getElementById('chatInput');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      socket.emit('guess', { text: input.value.trim() });
      input.value = '';
    }
  });
}

function updateScoreBoard(players) {
  const board = document.getElementById('scoreboard');
  board.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.textContent = `${p.username}: ${p.score} pts`;
    board.appendChild(div);
  });
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.getElementById('toastContainer').appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
