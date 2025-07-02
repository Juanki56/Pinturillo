// index.js

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

function login() {
  const username = document.getElementById('username').value;
  fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  })
  .then(res => res.json())
  .then(data => {
    if (data.token) {
      initSocket(data.token);
    } else {
      alert('Error al iniciar sesión');
    }
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

    const defaultBlackButton = document.querySelector('.color-button[onclick*="--brush-black"]');
    if (defaultBlackButton) selectBrushColor(defaultBlackButton, 'var(--brush-black)');
    const defaultSizeButton = document.querySelector('.size-button[data-size="6"]');
    if (defaultSizeButton) selectBrushSize(defaultSizeButton, 6);
  });

  socket.on('draw', ({ x, y, color, lineWidth }) => draw(x, y, color, lineWidth, false));

  socket.on('canvas-cleared', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--input-bg');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    canvasHistory = [];
    historyPointer = -1;
    saveCanvasState();
    updateUndoRedoButtons();
    showToast(`🧼 El lienzo ha sido limpiado`, 'info');
  });

  socket.on('undo-stroke', (lastState) => {
    if (lastState) restoreCanvasState(lastState);
    else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--input-bg');
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  });

  socket.on('redo-stroke', (nextState) => {
    if (nextState) restoreCanvasState(nextState);
  });

  socket.on('timer-started', ({ duration }) => {
    showToast(`⏳ Temporizador iniciado: ${duration}s`, 'info');
    const timerDisplay = document.getElementById('timerDisplay');
    let timeLeft = duration;
    timerDisplay.style.color = getComputedStyle(document.documentElement).getPropertyValue('--text-dark');
    timerDisplay.innerText = `⏳ Tiempo restante: ${timeLeft}s`;

    if (window.currentTimerInterval) clearInterval(window.currentTimerInterval);

    window.currentTimerInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft >= 0) {
        timerDisplay.innerText = `⏳ Tiempo restante: ${timeLeft}s`;
        if (timeLeft <= 10) {
          timerDisplay.style.color = getComputedStyle(document.documentElement).getPropertyValue('--error-color');
        }
      } else {
        clearInterval(window.currentTimerInterval);
        timerDisplay.innerText = '⏰ Tiempo terminado';
        timerDisplay.style.color = getComputedStyle(document.documentElement).getPropertyValue('--text-dark');
        disableDrawing();
      }
    }, 1000);
  });

  socket.on('timer-ended', () => {
    showToast(`⏰ Tiempo terminado`, 'error');
    disableDrawing();
    const timerDisplay = document.getElementById('timerDisplay');
    timerDisplay.innerText = '⏰ Tiempo terminado';
    timerDisplay.style.color = getComputedStyle(document.documentElement).getPropertyValue('--text-dark');
  });

  socket.on('user-connected', ({ username }) => {
    showToast(`✅ ${username} se ha conectado`, 'success');
  });

  socket.on('user-disconnected', ({ username }) => {
    showToast(`👋 ${username} se ha desconectado`, 'info');
  });
}

function setupCanvas() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  ctx.lineWidth = currentBrushSize;
  ctx.lineCap = 'round';
  ctx.strokeStyle = currentBrushColor;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--input-bg');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', stopDrawing);
  canvas.addEventListener('mousemove', drawOnCanvas);
}

function startDrawing(e) {
  painting = true;
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);
}

function stopDrawing() {
  painting = false;
  ctx.beginPath();
  saveCanvasState();
  updateUndoRedoButtons();
}

function drawOnCanvas(e) {
  if (!painting) return;
  const x = e.offsetX;
  const y = e.offsetY;
  draw(x, y, currentBrushColor, currentBrushSize, true);
  socket.emit('draw', { x, y, color: currentBrushColor, lineWidth: currentBrushSize });
}

function draw(x, y, incomingColor, incomingLineWidth, local) {
  ctx.lineWidth = local ? currentBrushSize : (incomingLineWidth || 2);
  ctx.lineCap = 'round';
  ctx.strokeStyle = local ? currentBrushColor : (incomingColor || 'black');
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function startTimer(duration) {
  socket.emit('start-timer', { duration });
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--input-bg');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  socket.emit('clear-canvas');
  canvasHistory = [];
  historyPointer = -1;
  saveCanvasState();
  updateUndoRedoButtons();
}

function disableDrawing() {
  canvas.removeEventListener('mousedown', startDrawing);
  canvas.removeEventListener('mouseup', stopDrawing);
  canvas.removeEventListener('mouseout', stopDrawing);
  canvas.removeEventListener('mousemove', drawOnCanvas);
}

// --- Deshacer / Rehacer ---
function saveCanvasState() {
  if (historyPointer < canvasHistory.length - 1) {
    canvasHistory = canvasHistory.slice(0, historyPointer + 1);
  }
  const dataURL = canvas.toDataURL();
  if (canvasHistory.length >= MAX_HISTORY_STEPS) canvasHistory.shift();
  canvasHistory.push(dataURL);
  historyPointer = canvasHistory.length - 1;
}

function undoLastStroke() {
  if (historyPointer > 0) {
    historyPointer--;
    const lastState = canvasHistory[historyPointer];
    restoreCanvasState(lastState);
    socket.emit('undo-stroke', lastState);
  } else if (historyPointer === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--input-bg');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    historyPointer = -1;
    socket.emit('undo-stroke', null);
  }
  updateUndoRedoButtons();
}

function redoLastStroke() {
  if (historyPointer < canvasHistory.length - 1) {
    historyPointer++;
    const nextState = canvasHistory[historyPointer];
    restoreCanvasState(nextState);
    socket.emit('redo-stroke', nextState);
  }
  updateUndoRedoButtons();
}

function restoreCanvasState(dataURL) {
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = dataURL;
}

function updateUndoRedoButtons() {
  document.getElementById('undoButton').disabled = historyPointer <= 0;
  document.getElementById('redoButton').disabled = historyPointer >= canvasHistory.length - 1;
}

// --- Herramientas (color, grosor, borrador) ---
function selectToolButton(element) {
  if (lastSelectedToolButton) lastSelectedToolButton.classList.remove('selected');
  element.classList.add('selected');
  lastSelectedToolButton = element;
}

function selectSizeButton(element) {
  if (lastSelectedSizeButton) lastSelectedSizeButton.classList.remove('selected');
  element.classList.add('selected');
  lastSelectedSizeButton = element;
}

function selectBrushColor(element, cssVariable) {
  selectToolButton(element);
  activeTool = 'brush';
  currentBrushColor = getComputedStyle(document.documentElement).getPropertyValue(cssVariable.replace('var(', '').replace(')', ''));
  if (ctx) {
    ctx.strokeStyle = currentBrushColor;
    ctx.lineWidth = currentBrushSize;
  }
}

function selectBrushSize(element, size) {
  selectSizeButton(element);
  currentBrushSize = size;
  if (ctx) {
    ctx.strokeStyle = activeTool === 'eraser'
      ? getComputedStyle(document.documentElement).getPropertyValue('--eraser-color')
      : currentBrushColor;
    ctx.lineWidth = currentBrushSize;
  }
}

function selectEraser() {
  const eraserButton = document.querySelector('.color-button.eraser-button');
  selectToolButton(eraserButton);
  activeTool = 'eraser';
  currentBrushColor = getComputedStyle(document.documentElement).getPropertyValue('--eraser-color');
  if (!lastSelectedSizeButton) {
    const defaultEraserSizeButton = document.querySelector('.size-button[data-size="16"]');
    if (defaultEraserSizeButton) selectBrushSize(defaultEraserSizeButton, 16);
  } else {
    if (ctx) {
      ctx.strokeStyle = currentBrushColor;
      ctx.lineWidth = currentBrushSize;
    }
  }
}

// --- Toast Notifications ---
function showToast(message, type = 'info') {
  const toastContainer = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
