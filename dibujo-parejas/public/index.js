// main.js

let socket;
let painting = false;
let canvas, ctx;
let currentBrushColor = 'black';
let currentBrushSize = 2;

let canvasHistory = [];
let historyPointer = -1;
const MAX_HISTORY_STEPS = 50;

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

    const initialColorButton = document.querySelector('.color-button.selected');
    if (initialColorButton) {
      const cssVar = initialColorButton.getAttribute('onclick').match(/'(var\(--brush-[a-z]+\))'/);
      if (cssVar && cssVar[1]) {
        currentBrushColor = getComputedStyle(document.documentElement).getPropertyValue(cssVar[1].replace('var(', '').replace(')', ''));
      }
      ctx.strokeStyle = currentBrushColor;
      ctx.lineWidth = currentBrushSize;
    } else {
      const defaultBlackButton = document.querySelector('.color-button[onclick*="--brush-black"]');
      if (defaultBlackButton) {
        selectBrushColor(defaultBlackButton, 'var(--brush-black)');
      }
    }
  });

  socket.on('draw', ({ x, y, color, lineWidth }) => draw(x, y, color, lineWidth, false));

  socket.on('canvas-cleared', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvasHistory = [];
    historyPointer = -1;
    saveCanvasState();
    updateUndoRedoButtons();
  });

  socket.on('undo-stroke', (lastState) => {
    if (lastState) {
      restoreCanvasState(lastState);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--input-bg');
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  });

  socket.on('redo-stroke', (nextState) => {
    if (nextState) {
      restoreCanvasState(nextState);
    }
  });

  socket.on('timer-started', ({ duration }) => {
    const timerDisplay = document.getElementById('timerDisplay');
    let timeLeft = duration;
    timerDisplay.style.color = getComputedStyle(document.documentElement).getPropertyValue('--text-dark');

    // Mostrar inmediatamente
    timerDisplay.innerText = `⏳ Tiempo restante: ${timeLeft}s`;

    if (window.currentTimerInterval) {
      clearInterval(window.currentTimerInterval);
    }

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
    disableDrawing();
    const timerDisplay = document.getElementById('timerDisplay');
    timerDisplay.innerText = '⏰ Tiempo terminado';
    timerDisplay.style.color = getComputedStyle(document.documentElement).getPropertyValue('--text-dark');
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

// --- Historial (Deshacer/Rehacer) ---
function saveCanvasState() {
  if (historyPointer < canvasHistory.length - 1) {
    canvasHistory = canvasHistory.slice(0, historyPointer + 1);
  }

  const dataURL = canvas.toDataURL();
  if (canvasHistory.length >= MAX_HISTORY_STEPS) {
    canvasHistory.shift();
  }

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
  const undoButton = document.getElementById('undoButton');
  const redoButton = document.getElementById('redoButton');

  if (undoButton) undoButton.disabled = historyPointer <= 0;
  if (redoButton) redoButton.disabled = historyPointer >= canvasHistory.length - 1;
}

// --- Herramientas (Color y Borrador) ---
let lastSelectedToolButton = null;

function selectToolButton(element) {
  if (lastSelectedToolButton) {
    lastSelectedToolButton.classList.remove('selected');
  }
  element.classList.add('selected');
  lastSelectedToolButton = element;
}

function selectBrushColor(element, cssVariable) {
  selectToolButton(element);
  currentBrushColor = getComputedStyle(document.documentElement).getPropertyValue(cssVariable.replace('var(', '').replace(')', ''));
  currentBrushSize = 2;
  if (ctx) {
    ctx.strokeStyle = currentBrushColor;
    ctx.lineWidth = currentBrushSize;
  }
}

function selectEraser() {
  const eraserButton = document.querySelector('.color-button.eraser-button');
  selectToolButton(eraserButton);
  currentBrushColor = getComputedStyle(document.documentElement).getPropertyValue('--eraser-color');
  currentBrushSize = 20;
  if (ctx) {
    ctx.strokeStyle = currentBrushColor;
    ctx.lineWidth = currentBrushSize;
  }
}

// Seleccionar color negro al cargar la página
document.addEventListener('DOMContentLoaded', () => {
  const blackButton = document.querySelector('.color-button[onclick*="--brush-black"]');
  if (blackButton) {
    selectBrushColor(blackButton, 'var(--brush-black)');
  }
});
