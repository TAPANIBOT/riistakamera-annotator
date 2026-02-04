// Riistakamera Annotator - Frontend Logic with Zoom and Pan

// Global state
let images = [];
let currentIndex = 0;
let annotations = [];
let currentBox = null;
let isDrawing = false;
let startX, startY;
let canvas, ctx;
let img = new Image();

// Zoom and Pan variables
let zoomLevel = 1.0;
let offsetX = 0;
let offsetY = 0;
let isDragging = false;
let lastMouseX, lastMouseY;

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
    canvas = document.getElementById('image-canvas');
    ctx = canvas.getContext('2d');
    
    // Event listeners for drawing
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    
    // Zoom and Pan event listeners
    canvas.addEventListener('wheel', handleZoom);
    canvas.addEventListener('mousedown', startPan);
    canvas.addEventListener('mousemove', doPan);
    canvas.addEventListener('mouseup', stopPan);
    canvas.addEventListener('mouseleave', stopPan);
    
    document.getElementById('save-btn').addEventListener('click', saveCurrentAnnotation);
    document.getElementById('next-btn').addEventListener('click', nextImage);
    document.getElementById('clear-current').addEventListener('click', clearCurrentBox);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveCurrentAnnotation();
        if (e.key === 'n' || e.key === 'N') nextImage();
        if (e.key === 'c' || e.key === 'C') clearCurrentBox();
    });
    
    // Load images
    await loadImages();
}

// Zoom functionality
function handleZoom(e) {
    if (!e.shiftKey) return;
    
    e.preventDefault();
    
    // Get mouse position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate zoom
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    zoomLevel = Math.max(0.5, Math.min(3.0, zoomLevel + delta));
    
    // Update zoom indicator
    document.getElementById('zoom-indicator').textContent = `Zoom: ${Math.round(zoomLevel * 100)}%`;
    
    // Calculate new offsets to keep mouse point steady
    const newWidth = canvas.width * zoomLevel;
    const newHeight = canvas.height * zoomLevel;
    
    offsetX = mouseX - (mouseX - offsetX) * (newWidth / (canvas.width * (zoomLevel - delta)));
    offsetY = mouseY - (mouseY - offsetY) * (newHeight / (canvas.height * (zoomLevel - delta)));
    
    // Redraw
    drawCanvas();
}

// Pan functionality
function startPan(e) {
    if (!e.shiftKey) return;
    
    const rect = canvas.getBoundingClientRect();
    lastMouseX = e.clientX - rect.left;
    lastMouseY = e.clientY - rect.top;
    isDragging = true;
    canvas.style.cursor = 'grabbing';
}

function doPan(e) {
    if (!isDragging) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const deltaX = mouseX - lastMouseX;
    const deltaY = mouseY - lastMouseY;
    
    offsetX += deltaX;
    offsetY += deltaY;
    
    lastMouseX = mouseX;
    lastMouseY = mouseY;
    
    drawCanvas();
}

function stopPan() {
    isDragging = false;
    canvas.style.cursor = 'default';
}

// Convert mouse coordinates accounting for zoom and pan
function getCanvasCoordinates(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    
    // Apply zoom and pan adjustments
    const scaleX = canvas.width / rect.width / zoomLevel;
    const scaleY = canvas.height / rect.height / zoomLevel;
    
    const x = (clientX - rect.left - offsetX) * scaleX;
    const y = (clientY - rect.top - offsetY) * scaleY;
    
    return [x, y];
}

function drawCanvas() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Save context state
    ctx.save();
    
    // Apply zoom and pan transformations
    ctx.translate(offsetX, offsetY);
    ctx.scale(zoomLevel, zoomLevel);
    
    // Draw image
    ctx.drawImage(img, 0, 0);
    
    // Draw existing annotations
    ctx.strokeStyle = '#48bb78';
    ctx.lineWidth = 3;
    annotations.forEach((ann, idx) => {
        const [x1, y1, x2, y2] = ann.bbox;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        
        // Draw label
        ctx.fillStyle = '#48bb78';
        ctx.fillRect(x1, y1 - 25, 120, 25);
        ctx.fillStyle = 'white';
        ctx.font = '16px sans-serif';
        ctx.fillText(`${idx + 1}. ${ann.species}`, x1 + 5, y1 - 7);
    });
    
    // Draw current box
    if (currentBox) {
        ctx.strokeStyle = '#ed8936';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        const [x1, y1, x2, y2] = currentBox;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);
    }
    
    // Restore context state
    ctx.restore();
}

function handleMouseDown(e) {
    // Prevent drawing if shift is pressed (for panning)
    if (e.shiftKey) return;
    
    const [startX, startY] = getCanvasCoordinates(e.clientX, e.clientY);
    
    isDrawing = true;
    currentBox = [startX, startY, startX, startY];
}

function handleMouseMove(e) {
    // Prevent drawing if shift is pressed (for panning)
    if (e.shiftKey) return;
    
    if (!isDrawing) return;
    
    const [currentX, currentY] = getCanvasCoordinates(e.clientX, e.clientY);
    
    currentBox = [startX, startY, currentX, currentY];
    drawCanvas();
}

function handleMouseUp(e) {
    // Prevent drawing if shift is pressed (for panning)
    if (e.shiftKey) return;
    
    if (!isDrawing) return;
    isDrawing = false;
    
    // Normalize box (ensure x1 < x2, y1 < y2)
    if (currentBox) {
        const [x1, y1, x2, y2] = currentBox;
        currentBox = [
            Math.min(x1, x2),
            Math.min(y1, y2),
            Math.max(x1, x2),
            Math.max(y1, y2)
        ];
        
        // Ignore tiny boxes (accidental clicks)
        const width = currentBox[2] - currentBox[0];
        const height = currentBox[3] - currentBox[1];
        if (width < 10 || height < 10) {
            currentBox = null;
        }
        
        drawCanvas();
    }
}

// Rest of the existing code remains the same
// ... (loadImages, saveCurrentAnnotation, etc.)



// Undo/Redo functionality
let history = [];
let historyIndex = -1;

function saveState() {
    // Deep copy of boxes to prevent reference issues
    const currentState = JSON.parse(JSON.stringify(boxes));
    
    // If we're not at the end of history, truncate future states
    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }
    
    // Add new state
    history.push(currentState);
    
    // Limit history to 50 states
    if (history.length > 50) {
        history.shift();
    }
    
    // Move history index to the latest state
    historyIndex = history.length - 1;
}

// Undo functionality (Ctrl+Z)
function undoAction(event) {
    if (event.ctrlKey && event.key === 'z') {
        event.preventDefault();
        if (historyIndex > 0) {
            historyIndex--;
            boxes = JSON.parse(JSON.stringify(history[historyIndex]));
            redrawBoxes();
        }
    }
}

// Redo functionality (Ctrl+Y)
function redoAction(event) {
    if (event.ctrlKey && event.key === 'y') {
        event.preventDefault();
        if (historyIndex < history.length - 1) {
            historyIndex++;
            boxes = JSON.parse(JSON.stringify(history[historyIndex]));
            redrawBoxes();
        }
    }

// Clear history when new image is loaded
function clearHistory() {
    history = [];
    historyIndex = -1;
}

// Modify existing event listeners to save state
const originalDrawBox = drawBox;
drawBox = function(...args) {
    originalDrawBox(...args);
    saveState();
}

const originalDeleteBox = deleteBox;
deleteBox = function(...args) {
    originalDeleteBox(...args);
    saveState();
}

// Add keyboard event listeners
document.addEventListener('keydown', undoAction);
document.addEventListener('keydown', redoAction);
document.addEventListener('imageLoaded', clearHistory);
