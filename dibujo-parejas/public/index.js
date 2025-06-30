// main.js (index.js)

let socket;
let painting = false;
let canvas, ctx;
let currentBrushColor = 'black'; // Color inicial del pincel
let currentBrushSize = 6; // Grosor inicial del pincel

// --- Variables para deshacer y rehacer ---
let canvasHistory = [];
let historyPointer = -1;
const MAX_HISTORY_STEPS = 50;
// --- Fin Variables para deshacer y rehacer ---

// --- Variables para manejar la selección visual de los botones ---
let lastSelectedToolButton = null; // Para colores y borrador
let lastSelectedSizeButton = null; // Para grosores
// --- Fin Variables para manejar la selección visual de los botones ---

// --- Variable para rastrear la herramienta activa (pincel o borrador) ---
let activeTool = 'brush'; // Puede ser 'brush' o 'eraser'
// --- Fin Variable para rastrear la herramienta activa ---


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

    // --- Inicialización de color y grosor al cargar ---
    // Inicializa el color (ej. negro) y lo marca como seleccionado
    const defaultBlackButton = document.querySelector('.color-button[onclick*="--brush-black"]');
    if (defaultBlackButton) {
      selectBrushColor(defaultBlackButton, 'var(--brush-black)');
    }
    // Inicializa el grosor (ej. 6) y lo marca como seleccionado
    const defaultSizeButton = document.querySelector('.size-button[data-size="6"]');
    if (defaultSizeButton) {
      selectBrushSize(defaultSizeButton, 6); // Establece el tamaño inicial
    }
    // --- Fin Inicialización ---
  });

  socket.on('draw', ({ x, y, color, lineWidth }) => draw(x, y, color, lineWidth, false));

  socket.on('canvas-cleared', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Redibujar el fondo blanco para simular un lienzo en blanco (importante para el borrador)
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--input-bg');
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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

  // Usa currentBrushColor y currentBrushSize que ya están configuradas por selectBrushColor/selectEraser/selectBrushSize
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
  // Redibujar el fondo blanco para simular un lienzo en blanco
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

// --- Herramientas (Color, Borrador y Grosor) ---

// Función auxiliar para manejar la clase 'selected' en los botones de herramienta (colores y borrador)
function selectToolButton(element) {
  if (lastSelectedToolButton) {
    lastSelectedToolButton.classList.remove('selected');
  }
  element.classList.add('selected');
  lastSelectedToolButton = element;
}

// Función auxiliar para manejar la clase 'selected' en los botones de grosor
function selectSizeButton(element) {
  if (lastSelectedSizeButton) {
    lastSelectedSizeButton.classList.remove('selected');
  }
  element.classList.add('selected');
  lastSelectedSizeButton = element;
}

function selectBrushColor(element, cssVariable) {
  selectToolButton(element); // Marca el botón de color como seleccionado
  activeTool = 'brush'; // Establece la herramienta activa como 'brush'

  currentBrushColor = getComputedStyle(document.documentElement).getPropertyValue(cssVariable.replace('var(', '').replace(')', ''));
  
  // Al cambiar de color, asegúrate de que el grosor actual se aplique.
  // No resetear currentBrushSize aquí para mantener el grosor seleccionado.
  if (ctx) {
    ctx.strokeStyle = currentBrushColor;
    ctx.lineWidth = currentBrushSize;
  }
}

// Función para seleccionar el grosor del pincel o borrador
function selectBrushSize(element, size) {
  selectSizeButton(element); // Marca el botón de grosor como seleccionado
  currentBrushSize = size; // Establece el tamaño de pincel o borrador

  // Si la herramienta activa es el borrador, establece su color.
  // Si no, usa el color actual del pincel.
  if (activeTool === 'eraser') {
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--eraser-color');
  } else {
    ctx.strokeStyle = currentBrushColor;
  }
  ctx.lineWidth = currentBrushSize; // Aplica el nuevo grosor
}


function selectEraser() {
  const eraserButton = document.querySelector('.color-button.eraser-button');
  selectToolButton(eraserButton); // Marca el borrador como seleccionado
  activeTool = 'eraser'; // Establece la herramienta activa como 'eraser'

  currentBrushColor = getComputedStyle(document.documentElement).getPropertyValue('--eraser-color');
  // currentBrushSize ya se actualiza a través de selectBrushSize, 
  // así que al seleccionar el borrador, usa el último grosor elegido o un predeterminado si no se ha elegido.
  
  // Opcional: Re-seleccionar un grosor por defecto para el borrador si no hay uno activo.
  // Por ejemplo, puedes querer que el borrador empiece siempre en un grosor mediano si el usuario no ha seleccionado uno.
  if (!lastSelectedSizeButton) {
      const defaultEraserSizeButton = document.querySelector('.size-button[data-size="16"]'); // Un buen tamaño predeterminado para el borrador
      if (defaultEraserSizeButton) {
          selectBrushSize(defaultEraserSizeButton, 16);
      }
  } else {
      // Si ya hay un grosor seleccionado, simplemente aplica el color del borrador con ese grosor.
      if (ctx) {
          ctx.strokeStyle = currentBrushColor; // El color del borrador
          ctx.lineWidth = currentBrushSize; // El último grosor seleccionado
      }
  }
}

// La inicialización inicial de color y grosor se maneja en initSocket
// document.addEventListener('DOMContentLoaded', () => { ... });