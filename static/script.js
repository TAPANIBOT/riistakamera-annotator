// Riistakamera Annotator - Frontend Logic
// State-objekti: kaikki tila yhdessä paikassa
const state = {
    images: [],
    currentIndex: 0,
    annotations: [],
    predictions: [],
    currentBox: null,
    isDrawing: false,
    drawStart: { x: 0, y: 0 },
    zoom: 1.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStart: { x: 0, y: 0 },
    imgWidth: 0,
    imgHeight: 0,
    history: [],
    historyIndex: -1,
    filter: 'all', // 'all', 'annotated', 'unannotated', 'predicted', 'empty'
    isEmptyImage: false
};

const CLASS_MAP = {
    0: 'kauris',
    1: 'peura',
    2: 'janis',
    3: 'linnut',
    4: 'supikoira',
    5: 'kettu',
    6: 'ihminen',
    7: 'koira',
    8: 'muu'
};

const SPECIES_LABELS = {
    kauris: 'Metsäkauris',
    peura: 'Valkohäntäpeura',
    janis: 'Jänis',
    linnut: 'Linnut',
    supikoira: 'Supikoira',
    kettu: 'Kettu',
    ihminen: 'Ihminen',
    koira: 'Koira',
    muu: 'Muu/tuntematon'
};

let canvas, ctx;
const img = new Image();

// ===================== INIT =====================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    canvas = document.getElementById('image-canvas');
    ctx = canvas.getContext('2d');

    // Drawing
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);

    // Zoom (Shift+scroll)
    canvas.addEventListener('wheel', handleZoom, { passive: false });

    // Buttons
    document.getElementById('save-btn').addEventListener('click', saveCurrentAnnotation);
    document.getElementById('next-btn').addEventListener('click', nextImage);
    document.getElementById('prev-btn').addEventListener('click', prevImage);
    document.getElementById('clear-current').addEventListener('click', clearCurrentBox);

    // Empty image button
    const emptyBtn = document.getElementById('empty-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', markAsEmpty);

    // Uncertain image button
    const uncertainBtn = document.getElementById('uncertain-btn');
    if (uncertainBtn) uncertainBtn.addEventListener('click', loadNextUncertain);

    // Filter
    const filterSelect = document.getElementById('filter-select');
    if (filterSelect) {
        filterSelect.addEventListener('change', (e) => {
            state.filter = e.target.value;
            applyFilter();
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);

    // Image onload
    img.onload = () => {
        state.imgWidth = img.naturalWidth;
        state.imgHeight = img.naturalHeight;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        resetView();
        drawCanvas();
    };

    await loadImages();
}

// ===================== KEYBOARD =====================

function handleKeyboard(e) {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;

    if (e.key === 'Enter') { e.preventDefault(); saveCurrentAnnotation(); }
    if (e.key === 'n' || e.key === 'N') nextImage();
    if (e.key === 'p' || e.key === 'P') prevImage();
    if (e.key === 'c' || e.key === 'C') clearCurrentBox();
    if (e.key === 'a' || e.key === 'A') acceptFirstPrediction();
    if (e.key === 'r' || e.key === 'R') rejectFirstPrediction();
    if (e.key === 'e' || e.key === 'E') markAsEmpty();
    if (e.key === 'u' || e.key === 'U') loadNextUncertain();

    // Number keys 1-9 for species selection
    const num = parseInt(e.key);
    if (num >= 1 && num <= 9) {
        const select = document.getElementById('species-select');
        if (select.options[num]) {
            select.selectedIndex = num;
        }
    }

    // Ctrl+Z undo, Ctrl+Y redo
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
}

// ===================== IMAGE LOADING =====================

async function loadImages() {
    try {
        const resp = await fetch('/api/images');
        const data = await resp.json();
        state.images = data.images || [];

        document.getElementById('loading').style.display = 'none';

        if (state.images.length === 0) {
            document.getElementById('no-images').style.display = 'block';
            return;
        }

        await loadImage(0);
    } catch (err) {
        console.error('Kuvien lataus epäonnistui:', err);
        document.getElementById('loading').textContent = 'Virhe: kuvien lataus epäonnistui';
    }
}

async function loadImage(index) {
    if (index < 0 || index >= state.images.length) return;

    state.currentIndex = index;
    state.currentBox = null;
    state.history = [];
    state.historyIndex = -1;

    const name = state.images[index];

    // Update counter
    document.getElementById('image-counter').textContent =
        `${index + 1} / ${state.images.length}`;
    document.getElementById('image-name').textContent = name;

    // Load image
    img.src = `/api/image/${encodeURIComponent(name)}`;

    // Load annotations
    try {
        const resp = await fetch(`/api/annotation/${encodeURIComponent(name)}`);
        const data = await resp.json();
        state.annotations = data.annotations || [];
        state.isEmptyImage = data.is_empty || false;
    } catch {
        state.annotations = [];
        state.isEmptyImage = false;
    }

    // Load predictions
    try {
        const resp = await fetch(`/api/predictions/${encodeURIComponent(name)}`);
        const data = await resp.json();
        state.predictions = data.predictions || [];
    } catch {
        state.predictions = [];
    }

    updateAnnotationsList();
    updatePredictionsList();
    updateAnnotationCount();
}

// ===================== NAVIGATION =====================

function nextImage() {
    if (state.currentIndex < state.images.length - 1) {
        loadImage(state.currentIndex + 1);
    }
}

function prevImage() {
    if (state.currentIndex > 0) {
        loadImage(state.currentIndex - 1);
    }
}

// ===================== DRAWING =====================

function getImageCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX / state.zoom - state.panX / state.zoom;
    const y = (e.clientY - rect.top) * scaleY / state.zoom - state.panY / state.zoom;
    return { x, y };
}

function handleMouseDown(e) {
    if (e.shiftKey) {
        // Pan mode
        state.isPanning = true;
        state.panStart = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
        return;
    }

    const coords = getImageCoords(e);
    state.isDrawing = true;
    state.drawStart = coords;
    state.currentBox = [coords.x, coords.y, coords.x, coords.y];
}

function handleMouseMove(e) {
    if (state.isPanning) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        state.panX += (e.clientX - state.panStart.x) * scaleX;
        state.panY += (e.clientY - state.panStart.y) * scaleY;
        state.panStart = { x: e.clientX, y: e.clientY };
        drawCanvas();
        return;
    }

    if (!state.isDrawing) return;

    const coords = getImageCoords(e);
    state.currentBox = [state.drawStart.x, state.drawStart.y, coords.x, coords.y];
    drawCanvas();
}

function handleMouseUp(e) {
    if (state.isPanning) {
        state.isPanning = false;
        canvas.style.cursor = 'crosshair';
        return;
    }

    if (!state.isDrawing) return;
    state.isDrawing = false;

    if (state.currentBox) {
        const [x1, y1, x2, y2] = state.currentBox;
        state.currentBox = [
            Math.min(x1, x2), Math.min(y1, y2),
            Math.max(x1, x2), Math.max(y1, y2)
        ];

        // Ignore tiny boxes
        const w = state.currentBox[2] - state.currentBox[0];
        const h = state.currentBox[3] - state.currentBox[1];
        if (w < 10 || h < 10) {
            state.currentBox = null;
        }

        drawCanvas();
    }
}

// ===================== ZOOM & PAN =====================

function handleZoom(e) {
    if (!e.shiftKey) return;
    e.preventDefault();

    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    state.zoom = Math.max(0.5, Math.min(5.0, state.zoom + delta));

    document.getElementById('zoom-indicator').textContent =
        `Zoom: ${Math.round(state.zoom * 100)}%`;

    drawCanvas();
}

function resetView() {
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
    const zi = document.getElementById('zoom-indicator');
    if (zi) zi.textContent = 'Zoom: 100%';
}

// ===================== CANVAS DRAWING =====================

function drawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    ctx.translate(state.panX, state.panY);
    ctx.scale(state.zoom, state.zoom);

    // Draw image
    ctx.drawImage(img, 0, 0);

    // Empty image overlay
    if (state.isEmptyImage) {
        drawEmptyOverlay();
    }

    // Draw confirmed annotations (solid green)
    state.annotations.forEach((ann, idx) => {
        const [x1, y1, x2, y2] = ann.bbox;
        ctx.strokeStyle = '#48bb78';
        ctx.lineWidth = 3 / state.zoom;
        ctx.setLineDash([]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Label background
        const label = `${idx + 1}. ${SPECIES_LABELS[ann.species] || ann.species}`;
        const fontSize = Math.max(12, 16 / state.zoom);
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textWidth = ctx.measureText(label).width + 10;
        const labelHeight = fontSize + 8;

        ctx.fillStyle = 'rgba(72, 187, 120, 0.85)';
        ctx.fillRect(x1, y1 - labelHeight, textWidth, labelHeight);
        ctx.fillStyle = 'white';
        ctx.fillText(label, x1 + 5, y1 - 5);
    });

    // Draw predictions (dashed orange)
    state.predictions.forEach((pred, idx) => {
        const [x1, y1, x2, y2] = pred.bbox;
        ctx.strokeStyle = '#ed8936';
        ctx.lineWidth = 2 / state.zoom;
        ctx.setLineDash([6 / state.zoom, 4 / state.zoom]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Label
        const species = pred.species || 'eläin';
        const conf = pred.species_confidence
            ? ` ${Math.round(pred.species_confidence * 100)}%`
            : pred.md_confidence
            ? ` ${Math.round(pred.md_confidence * 100)}%`
            : '';
        const label = `AI: ${species}${conf}`;
        const fontSize = Math.max(11, 14 / state.zoom);
        ctx.font = `${fontSize}px sans-serif`;
        const textWidth = ctx.measureText(label).width + 10;
        const labelHeight = fontSize + 8;

        ctx.fillStyle = 'rgba(237, 137, 54, 0.85)';
        ctx.fillRect(x1, y1 - labelHeight, textWidth, labelHeight);
        ctx.fillStyle = 'white';
        ctx.setLineDash([]);
        ctx.fillText(label, x1 + 5, y1 - 5);
    });

    // Draw current drawing box (dashed blue)
    if (state.currentBox) {
        const [x1, y1, x2, y2] = state.currentBox;
        ctx.strokeStyle = '#4299e1';
        ctx.lineWidth = 2 / state.zoom;
        ctx.setLineDash([5 / state.zoom, 5 / state.zoom]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);
    }

    ctx.restore();
}

// ===================== ANNOTATIONS =====================

function saveCurrentAnnotation() {
    if (!state.currentBox) {
        showStatus('Piirrä ensin laatikko!', 'warning');
        return;
    }

    const select = document.getElementById('species-select');
    const species = select.value;
    if (!species) {
        showStatus('Valitse eläinlaji!', 'warning');
        return;
    }

    // Save history state before modification
    pushHistory();

    const annotation = {
        bbox: state.currentBox.map(Math.round),
        species: species,
        timestamp: new Date().toISOString()
    };

    state.annotations.push(annotation);
    state.currentBox = null;
    state.isEmptyImage = false;

    // Save to backend
    saveAnnotationsToServer();

    updateAnnotationsList();
    updateAnnotationCount();
    drawCanvas();

    // Reset species selection
    select.selectedIndex = 0;

    showStatus(`Tallennettu: ${SPECIES_LABELS[species]}`, 'success');
}

function deleteAnnotation(index) {
    if (index < 0 || index >= state.annotations.length) return;
    pushHistory();
    state.annotations.splice(index, 1);
    saveAnnotationsToServer();
    updateAnnotationsList();
    updateAnnotationCount();
    drawCanvas();
}

function clearCurrentBox() {
    state.currentBox = null;
    drawCanvas();
}

async function saveAnnotationsToServer() {
    const name = state.images[state.currentIndex];
    try {
        const payload = {
            image_name: name,
            annotations: state.annotations,
            is_empty: state.isEmptyImage
        };
        await fetch(`/api/annotation/${encodeURIComponent(name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error('Tallennus epäonnistui:', err);
        showStatus('Tallennusvirhe!', 'error');
    }
}

function markAsEmpty() {
    pushHistory();
    state.annotations = [];
    state.isEmptyImage = true;
    state.currentBox = null;
    saveAnnotationsToServer();
    updateAnnotationsList();
    updateAnnotationCount();
    drawCanvas();
    showStatus('Merkitty tyhjäksi kuvaksi', 'success');
}

// ===================== PREDICTIONS =====================

function acceptPrediction(index) {
    if (index < 0 || index >= state.predictions.length) return;

    const pred = state.predictions[index];
    pushHistory();

    // Convert prediction to annotation
    const species = pred.species || 'muu';
    state.annotations.push({
        bbox: pred.bbox.map(Math.round),
        species: species,
        timestamp: new Date().toISOString(),
        from_prediction: true,
        md_confidence: pred.md_confidence,
        species_confidence: pred.species_confidence
    });

    // Remove from predictions
    state.predictions.splice(index, 1);

    saveAnnotationsToServer();
    updateAnnotationsList();
    updatePredictionsList();
    updateAnnotationCount();
    drawCanvas();

    showStatus(`Hyväksytty: ${SPECIES_LABELS[species] || species}`, 'success');
}

function rejectPrediction(index) {
    if (index < 0 || index >= state.predictions.length) return;
    state.predictions.splice(index, 1);
    updatePredictionsList();
    drawCanvas();
}

function acceptFirstPrediction() {
    if (state.predictions.length > 0) acceptPrediction(0);
}

function rejectFirstPrediction() {
    if (state.predictions.length > 0) rejectPrediction(0);
}

// ===================== UI UPDATES =====================

function updateAnnotationsList() {
    const ul = document.getElementById('annotations-ul');
    ul.innerHTML = '';

    state.annotations.forEach((ann, idx) => {
        const li = document.createElement('li');
        const label = SPECIES_LABELS[ann.species] || ann.species;
        const [x1, y1, x2, y2] = ann.bbox;
        li.innerHTML = `
            <span><strong>${idx + 1}.</strong> ${label}
                <small class="bbox-info">[${x1}, ${y1}, ${x2}, ${y2}]</small>
            </span>
            <button class="delete-btn" onclick="deleteAnnotation(${idx})">Poista</button>
        `;
        ul.appendChild(li);
    });
}

function updatePredictionsList() {
    const container = document.getElementById('predictions-list');
    if (!container) return;

    if (state.predictions.length === 0) {
        container.innerHTML = '<p class="no-predictions">Ei AI-ennusteita</p>';
        return;
    }

    container.innerHTML = '';
    state.predictions.forEach((pred, idx) => {
        const species = pred.species || 'eläin';
        const label = SPECIES_LABELS[species] || species;
        const conf = pred.species_confidence
            ? Math.round(pred.species_confidence * 100)
            : pred.md_confidence
            ? Math.round(pred.md_confidence * 100)
            : null;

        const div = document.createElement('div');
        div.className = 'prediction-item';
        div.innerHTML = `
            <span class="pred-label">${label}</span>
            ${conf !== null ? `<span class="confidence-badge">${conf}%</span>` : ''}
            <div class="pred-actions">
                <button class="btn-accept" onclick="acceptPrediction(${idx})" title="Hyväksy (A)">Hyväksy</button>
                <button class="btn-reject" onclick="rejectPrediction(${idx})" title="Hylkää (R)">Hylkää</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function updateAnnotationCount() {
    const el = document.getElementById('annotation-count');
    if (el) {
        if (state.isEmptyImage) {
            el.textContent = 'Tyhjä kuva';
        } else {
            el.textContent = `${state.annotations.length} annotaatiota`;
        }
    }
}

function drawEmptyOverlay() {
    ctx.fillStyle = 'rgba(160, 174, 192, 0.4)';
    ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);
    const fontSize = Math.max(40, img.naturalWidth / 15);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText('TYHJÄ KUVA', img.naturalWidth / 2, img.naturalHeight / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
}

function showStatus(message, type) {
    const el = document.getElementById('status-message');
    if (!el) return;
    el.textContent = message;
    el.className = `status-message status-${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 2000);
}

// ===================== FILTER =====================

function applyFilter() {
    // Re-filter images list based on state.filter
    // This requires annotation status info from the server
    // For now, just reload — the server can provide filtered lists later
    loadImages();
}

// ===================== UNDO / REDO =====================

function pushHistory() {
    // Truncate future states
    if (state.historyIndex < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyIndex + 1);
    }
    state.history.push(JSON.parse(JSON.stringify(state.annotations)));
    if (state.history.length > 50) state.history.shift();
    state.historyIndex = state.history.length - 1;
}

function undo() {
    if (state.historyIndex < 0) return;
    state.annotations = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
    state.historyIndex--;
    saveAnnotationsToServer();
    updateAnnotationsList();
    updateAnnotationCount();
    drawCanvas();
}

function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    state.annotations = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
    saveAnnotationsToServer();
    updateAnnotationsList();
    updateAnnotationCount();
    drawCanvas();
}

// ===================== ACTIVE LEARNING =====================

async function loadNextUncertain() {
    try {
        const resp = await fetch('/api/active-learning/ranking?limit=1');
        const data = await resp.json();
        if (!data.ranking || data.ranking.length === 0) {
            showStatus('Ei epävarmoja kuvia jäljellä!', 'warning');
            return;
        }
        const imageName = data.ranking[0].image;
        const idx = state.images.indexOf(imageName);
        if (idx >= 0) {
            await loadImage(idx);
            showStatus(`Epävarmin: ${imageName} (${Math.round(data.ranking[0].max_confidence * 100)}%)`, 'success');
        } else {
            showStatus('Kuvaa ei löydy listasta', 'warning');
        }
    } catch (err) {
        console.error('Active learning -virhe:', err);
        showStatus('Epävarmuusjärjestyksen haku epäonnistui', 'error');
    }
}
