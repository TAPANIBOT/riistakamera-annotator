// Riistakamera Annotator — Nordic Precision Wildlife UI
// =====================================================

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
    filter: 'all',
    isEmptyImage: false,
    selectedSpecies: null,
    focusedPrediction: -1,
    preloadedImage: null,
    autoAdvance: true,
    stats: null
};

const session = {
    startTime: Date.now(),
    annotatedCount: 0,
    timerInterval: null
};

const CLASS_MAP = {
    0: 'kauris', 1: 'peura', 2: 'janis', 3: 'linnut',
    4: 'supikoira', 5: 'kettu', 6: 'ihminen', 7: 'koira', 8: 'muu'
};

const SPECIES_LABELS = {
    kauris: 'Metsäkauris', peura: 'Valkohäntäpeura', janis: 'Jänis',
    linnut: 'Linnut', supikoira: 'Supikoira', kettu: 'Kettu',
    ihminen: 'Ihminen', koira: 'Koira', muu: 'Muu/tuntematon'
};

let canvas, ctx, minimapCanvas, minimapCtx;
const img = new Image();

// ===================== INIT =====================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    canvas = document.getElementById('image-canvas');
    ctx = canvas.getContext('2d');
    minimapCanvas = document.getElementById('minimap-canvas');
    minimapCtx = minimapCanvas.getContext('2d');

    // Canvas events
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleZoom, { passive: false });

    // Buttons
    document.getElementById('save-btn').addEventListener('click', saveCurrentAnnotation);
    document.getElementById('next-btn').addEventListener('click', nextImage);
    document.getElementById('prev-btn').addEventListener('click', prevImage);
    document.getElementById('clear-current').addEventListener('click', clearCurrentBox);
    document.getElementById('empty-btn').addEventListener('click', markAsEmpty);
    document.getElementById('uncertain-btn').addEventListener('click', loadNextUncertain);
    document.getElementById('accept-all-btn').addEventListener('click', acceptAllPredictions);

    // Filter
    document.getElementById('filter-select').addEventListener('change', (e) => {
        state.filter = e.target.value;
        applyFilter();
    });

    // Auto-advance toggle
    const autoToggle = document.getElementById('auto-advance-toggle');
    autoToggle.addEventListener('change', (e) => {
        state.autoAdvance = e.target.checked;
    });

    // Shortcuts overlay
    document.getElementById('shortcuts-btn').addEventListener('click', toggleShortcuts);
    document.getElementById('shortcuts-close').addEventListener('click', toggleShortcuts);
    document.getElementById('shortcuts-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) toggleShortcuts();
    });

    // Species buttons
    document.querySelectorAll('.species-btn').forEach(btn => {
        btn.addEventListener('click', () => selectSpecies(btn.dataset.species));
    });

    // Mobile drawer toggles
    document.getElementById('drawer-toggle-left').addEventListener('click', () => {
        document.querySelector('.panel--left').classList.toggle('open');
        document.querySelector('.panel--right').classList.remove('open');
    });
    document.getElementById('drawer-toggle-right').addEventListener('click', () => {
        document.querySelector('.panel--right').classList.toggle('open');
        document.querySelector('.panel--left').classList.remove('open');
    });

    // Keyboard
    document.addEventListener('keydown', handleKeyboard);

    // Image onload
    img.onload = () => {
        state.imgWidth = img.naturalWidth;
        state.imgHeight = img.naturalHeight;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        resetView();
        drawCanvas();
        canvas.classList.add('canvas-fade');
        setTimeout(() => canvas.classList.remove('canvas-fade'), 200);
    };

    // Session timer
    session.timerInterval = setInterval(updateSessionTimer, 1000);

    await loadImages();
    await loadStats();
}

// ===================== KEYBOARD =====================

function handleKeyboard(e) {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;

    // Shortcuts overlay
    const overlay = document.getElementById('shortcuts-overlay');
    if (overlay.style.display !== 'none') {
        if (e.key === 'Escape' || e.key === '?') {
            toggleShortcuts();
            e.preventDefault();
        }
        return;
    }

    if (e.key === '?') { toggleShortcuts(); return; }

    if (e.key === 'Enter' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        saveCurrentAnnotation();
        return;
    }
    if (e.key === 'n' || e.key === 'N') { nextImage(); return; }
    if (e.key === 'p' || e.key === 'P') { prevImage(); return; }
    if (e.key === 'c' || e.key === 'C') { clearCurrentBox(); return; }
    if (e.key === 'e' || e.key === 'E') { markAsEmpty(); return; }
    if (e.key === 'u' || e.key === 'U') { loadNextUncertain(); return; }

    // Shift+A: accept all
    if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        acceptAllPredictions();
        return;
    }

    // A/R: accept/reject focused or first prediction
    if (e.key === 'a' || e.key === 'A') {
        const idx = state.focusedPrediction >= 0 ? state.focusedPrediction : 0;
        acceptPrediction(idx);
        return;
    }
    if (e.key === 'r' || e.key === 'R') {
        const idx = state.focusedPrediction >= 0 ? state.focusedPrediction : 0;
        rejectPrediction(idx);
        return;
    }

    // Tab: cycle prediction focus
    if (e.key === 'Tab' && state.predictions.length > 0) {
        e.preventDefault();
        state.focusedPrediction = (state.focusedPrediction + 1) % state.predictions.length;
        updatePredictionsFocus();
        return;
    }

    // Number keys 1-9
    const num = parseInt(e.key);
    if (num >= 1 && num <= 9) {
        const species = Object.values(CLASS_MAP)[num - 1];
        if (species) selectSpecies(species);
        return;
    }

    // Ctrl+Z/Y
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
}

// ===================== SPECIES SELECTION =====================

function selectSpecies(species) {
    state.selectedSpecies = species;
    document.querySelectorAll('.species-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.species === species);
    });
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
    state.focusedPrediction = -1;

    const name = state.images[index];

    // Update UI
    document.getElementById('image-counter').textContent = index + 1;
    document.getElementById('image-name').textContent = name;
    updateProgress();

    // Load image (use preloaded if available)
    if (state.preloadedImage && state.preloadedImage.src.includes(encodeURIComponent(name))) {
        img.src = state.preloadedImage.src;
    } else {
        img.src = `/api/image/${encodeURIComponent(name)}`;
    }

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

    // Preload next image
    preloadNext(index + 1);
}

function preloadNext(nextIndex) {
    if (nextIndex >= state.images.length) return;
    const next = new Image();
    next.src = `/api/image/${encodeURIComponent(state.images[nextIndex])}`;
    state.preloadedImage = next;
}

// ===================== STATS =====================

async function loadStats() {
    try {
        const resp = await fetch('/api/stats');
        state.stats = await resp.json();
        updateProgress();
    } catch {
        // Stats not critical
    }
}

function updateProgress() {
    const total = state.images.length;
    const current = state.currentIndex + 1;

    // Progress text
    const textEl = document.getElementById('progress-text');
    textEl.textContent = `${current} / ${total} kuvaa`;

    // Progress bar fill
    const fillEl = document.getElementById('progress-fill');
    const pct = total > 0 ? (current / total * 100) : 0;
    fillEl.style.width = `${pct}%`;

    // If we have stats, show annotated progress
    if (state.stats) {
        const annotated = state.stats.annotated_images + state.stats.empty_images;
        textEl.textContent = `${current} / ${total} kuvaa (${annotated} annotoitu)`;
        const statPct = total > 0 ? (annotated / total * 100) : 0;
        fillEl.style.width = `${statPct}%`;
    }
}

// ===================== SESSION TRACKING =====================

function updateSessionTimer() {
    const elapsed = Date.now() - session.startTime;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    document.getElementById('session-time').textContent =
        `${mins}:${secs.toString().padStart(2, '0')}`;

    // Speed (annotations per hour)
    const hours = elapsed / 3600000;
    const speed = hours > 0 ? Math.round(session.annotatedCount / hours) : 0;
    document.getElementById('speed-badge').textContent = `${speed}/h`;
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
        const w = state.currentBox[2] - state.currentBox[0];
        const h = state.currentBox[3] - state.currentBox[1];
        if (w < 10 || h < 10) state.currentBox = null;
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
    document.getElementById('zoom-indicator').textContent = 'Zoom: 100%';
}

// ===================== CANVAS DRAWING =====================

function drawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    ctx.translate(state.panX, state.panY);
    ctx.scale(state.zoom, state.zoom);

    ctx.drawImage(img, 0, 0);

    if (state.isEmptyImage) drawEmptyOverlay();

    // Confirmed annotations (solid green)
    state.annotations.forEach((ann, idx) => {
        const [x1, y1, x2, y2] = ann.bbox;
        ctx.strokeStyle = '#3fb950';
        ctx.lineWidth = 3 / state.zoom;
        ctx.setLineDash([]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        const label = `${idx + 1}. ${SPECIES_LABELS[ann.species] || ann.species}`;
        const fontSize = Math.max(12, 16 / state.zoom);
        ctx.font = `bold ${fontSize}px 'Space Grotesk', sans-serif`;
        const textWidth = ctx.measureText(label).width + 10;
        const labelHeight = fontSize + 8;

        ctx.fillStyle = 'rgba(63, 185, 80, 0.85)';
        ctx.fillRect(x1, y1 - labelHeight, textWidth, labelHeight);
        ctx.fillStyle = 'white';
        ctx.fillText(label, x1 + 5, y1 - 5);
    });

    // Predictions (dashed orange)
    state.predictions.forEach((pred, idx) => {
        const [x1, y1, x2, y2] = pred.bbox;
        const isFocused = idx === state.focusedPrediction;
        ctx.strokeStyle = isFocused ? '#58a6ff' : '#d29922';
        ctx.lineWidth = (isFocused ? 3 : 2) / state.zoom;
        ctx.setLineDash([6 / state.zoom, 4 / state.zoom]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        const species = pred.species || 'eläin';
        const conf = pred.species_confidence
            ? ` ${Math.round(pred.species_confidence * 100)}%`
            : pred.md_confidence
            ? ` ${Math.round(pred.md_confidence * 100)}%`
            : '';
        const label = `AI: ${species}${conf}`;
        const fontSize = Math.max(11, 14 / state.zoom);
        ctx.font = `${fontSize}px 'Space Grotesk', sans-serif`;
        const textWidth = ctx.measureText(label).width + 10;
        const labelHeight = fontSize + 8;

        ctx.fillStyle = isFocused ? 'rgba(88, 166, 255, 0.85)' : 'rgba(210, 153, 34, 0.85)';
        ctx.fillRect(x1, y1 - labelHeight, textWidth, labelHeight);
        ctx.fillStyle = 'white';
        ctx.setLineDash([]);
        ctx.fillText(label, x1 + 5, y1 - 5);
    });

    // Current drawing box (dashed blue)
    if (state.currentBox) {
        const [x1, y1, x2, y2] = state.currentBox;
        ctx.strokeStyle = '#58a6ff';
        ctx.lineWidth = 2 / state.zoom;
        ctx.setLineDash([5 / state.zoom, 5 / state.zoom]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);
    }

    ctx.restore();

    // Update minimap
    drawMinimap();
}

// ===================== MINIMAP =====================

function drawMinimap() {
    if (!minimapCanvas || !img.naturalWidth) return;

    const mw = minimapCanvas.width;
    const mh = minimapCanvas.height;
    minimapCtx.clearRect(0, 0, mw, mh);

    // Background
    minimapCtx.fillStyle = '#0a0e14';
    minimapCtx.fillRect(0, 0, mw, mh);

    // Draw thumbnail
    const aspect = img.naturalWidth / img.naturalHeight;
    let tw, th;
    if (aspect > mw / mh) {
        tw = mw;
        th = mw / aspect;
    } else {
        th = mh;
        tw = mh * aspect;
    }
    const tx = (mw - tw) / 2;
    const ty = (mh - th) / 2;

    minimapCtx.drawImage(img, tx, ty, tw, th);

    // Draw viewport rectangle (only when zoomed)
    if (state.zoom > 1.05) {
        const canvasRect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / canvasRect.width;
        const scaleY = canvas.height / canvasRect.height;

        // Visible area in image coordinates
        const vx = -state.panX / state.zoom;
        const vy = -state.panY / state.zoom;
        const vw = (canvas.width * scaleX) / state.zoom;
        const vh = (canvas.height * scaleY) / state.zoom;

        // Map to minimap coordinates
        const mx = tx + (vx / img.naturalWidth) * tw;
        const my = ty + (vy / img.naturalHeight) * th;
        const mmw = (vw / img.naturalWidth) * tw;
        const mmh = (vh / img.naturalHeight) * th;

        minimapCtx.strokeStyle = '#58a6ff';
        minimapCtx.lineWidth = 1.5;
        minimapCtx.strokeRect(mx, my, mmw, mmh);

        minimapCtx.fillStyle = 'rgba(88, 166, 255, 0.08)';
        minimapCtx.fillRect(mx, my, mmw, mmh);
    }
}

// ===================== ANNOTATIONS =====================

function saveCurrentAnnotation() {
    if (!state.currentBox) {
        showStatus('Piirrä ensin laatikko!', 'warning');
        return;
    }

    const species = state.selectedSpecies;
    if (!species) {
        showStatus('Valitse eläinlaji!', 'warning');
        return;
    }

    pushHistory();

    const annotation = {
        bbox: state.currentBox.map(Math.round),
        species: species,
        timestamp: new Date().toISOString()
    };

    state.annotations.push(annotation);
    state.currentBox = null;
    state.isEmptyImage = false;

    saveAnnotationsToServer();
    updateAnnotationsList();
    drawCanvas();

    session.annotatedCount++;

    showStatus(`Tallennettu: ${SPECIES_LABELS[species]}`, 'success');

    // Auto-advance
    if (state.autoAdvance) {
        setTimeout(() => nextImage(), 400);
    }

    // Refresh stats
    loadStats();
}

function deleteAnnotation(index) {
    if (index < 0 || index >= state.annotations.length) return;
    pushHistory();
    state.annotations.splice(index, 1);
    saveAnnotationsToServer();
    updateAnnotationsList();
    drawCanvas();
}

function clearCurrentBox() {
    state.currentBox = null;
    drawCanvas();
}

async function saveAnnotationsToServer() {
    const name = state.images[state.currentIndex];
    try {
        await fetch(`/api/annotation/${encodeURIComponent(name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_name: name,
                annotations: state.annotations,
                is_empty: state.isEmptyImage
            })
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
    drawCanvas();
    session.annotatedCount++;
    showStatus('Merkitty tyhjäksi kuvaksi', 'success');

    if (state.autoAdvance) {
        setTimeout(() => nextImage(), 400);
    }
    loadStats();
}

// ===================== PREDICTIONS =====================

function acceptPrediction(index) {
    if (index < 0 || index >= state.predictions.length) return;

    const pred = state.predictions[index];
    pushHistory();

    const species = pred.species || 'muu';
    state.annotations.push({
        bbox: pred.bbox.map(Math.round),
        species: species,
        timestamp: new Date().toISOString(),
        from_prediction: true,
        md_confidence: pred.md_confidence,
        species_confidence: pred.species_confidence
    });

    state.predictions.splice(index, 1);
    if (state.focusedPrediction >= state.predictions.length) {
        state.focusedPrediction = state.predictions.length - 1;
    }

    saveAnnotationsToServer();
    updateAnnotationsList();
    updatePredictionsList();
    drawCanvas();

    session.annotatedCount++;
    showStatus(`Hyväksytty: ${SPECIES_LABELS[species] || species}`, 'success');
}

function rejectPrediction(index) {
    if (index < 0 || index >= state.predictions.length) return;
    state.predictions.splice(index, 1);
    if (state.focusedPrediction >= state.predictions.length) {
        state.focusedPrediction = state.predictions.length - 1;
    }
    updatePredictionsList();
    drawCanvas();
}

function acceptAllPredictions() {
    if (state.predictions.length === 0) return;
    pushHistory();

    state.predictions.forEach(pred => {
        const species = pred.species || 'muu';
        state.annotations.push({
            bbox: pred.bbox.map(Math.round),
            species: species,
            timestamp: new Date().toISOString(),
            from_prediction: true,
            md_confidence: pred.md_confidence,
            species_confidence: pred.species_confidence
        });
    });

    const count = state.predictions.length;
    state.predictions = [];
    state.focusedPrediction = -1;

    saveAnnotationsToServer();
    updateAnnotationsList();
    updatePredictionsList();
    drawCanvas();

    session.annotatedCount += count;
    showStatus(`Hyväksytty ${count} ennustetta`, 'success');

    if (state.autoAdvance) {
        setTimeout(() => nextImage(), 400);
    }
    loadStats();
}

// ===================== UI UPDATES =====================

function updateAnnotationsList() {
    const ul = document.getElementById('annotations-ul');
    ul.innerHTML = '';

    if (state.isEmptyImage) {
        const li = document.createElement('li');
        li.className = 'annotation-card';
        li.style.borderLeftColor = 'var(--text-muted)';
        li.innerHTML = `
            <div class="annotation-card__info">
                <span class="annotation-card__species" style="color: var(--text-muted); font-style: italic;">Tyhjä kuva</span>
            </div>
        `;
        ul.appendChild(li);
        return;
    }

    state.annotations.forEach((ann, idx) => {
        const li = document.createElement('li');
        li.className = 'annotation-card';
        li.style.animationDelay = `${idx * 80}ms`;
        const label = SPECIES_LABELS[ann.species] || ann.species;
        const [x1, y1, x2, y2] = ann.bbox;
        li.innerHTML = `
            <div class="annotation-card__info">
                <span class="annotation-card__species">${idx + 1}. ${label}</span>
                <span class="annotation-card__bbox">[${x1}, ${y1}, ${x2}, ${y2}]</span>
            </div>
            <button class="annotation-card__delete" onclick="deleteAnnotation(${idx})" title="Poista">&times;</button>
        `;
        ul.appendChild(li);
    });
}

function updatePredictionsList() {
    const container = document.getElementById('predictions-list');
    if (!container) return;

    if (state.predictions.length === 0) {
        container.innerHTML = '<p class="no-data">Ei AI-ennusteita</p>';
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

        const confClass = conf !== null
            ? (conf >= 90 ? 'prediction-card__conf--high'
               : conf >= 50 ? 'prediction-card__conf--med'
               : 'prediction-card__conf--low')
            : '';

        const focused = idx === state.focusedPrediction ? ' focused' : '';

        const div = document.createElement('div');
        div.className = `prediction-card${focused}`;
        div.style.animationDelay = `${idx * 80}ms`;
        div.innerHTML = `
            <div class="prediction-card__header">
                <span class="prediction-card__species">${label}</span>
                ${conf !== null ? `<span class="prediction-card__conf ${confClass}">${conf}%</span>` : ''}
            </div>
            <div class="prediction-card__bbox">[${pred.bbox.map(Math.round).join(', ')}]</div>
            <div class="prediction-card__actions">
                <button class="btn-accept" onclick="acceptPrediction(${idx})" title="Hyväksy (A)">Hyväksy</button>
                <button class="btn-reject" onclick="rejectPrediction(${idx})" title="Hylkää (R)">Hylkää</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function updatePredictionsFocus() {
    const cards = document.querySelectorAll('.prediction-card');
    cards.forEach((card, idx) => {
        card.classList.toggle('focused', idx === state.focusedPrediction);
    });
    drawCanvas();
}

function drawEmptyOverlay() {
    ctx.fillStyle = 'rgba(90, 107, 130, 0.4)';
    ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);
    const fontSize = Math.max(40, img.naturalWidth / 15);
    ctx.font = `bold ${fontSize}px 'Space Grotesk', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.7)';
    ctx.fillText('TYHJÄ KUVA', img.naturalWidth / 2, img.naturalHeight / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
}

// ===================== STATUS =====================

function showStatus(message, type) {
    const el = document.getElementById('status-message');
    if (!el) return;
    el.textContent = message;
    el.className = `statusbar__item statusbar__message statusbar__message--${type}`;
    // Clear after 3 seconds
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => {
        el.textContent = '';
        el.className = 'statusbar__item statusbar__message';
    }, 3000);
}

// ===================== SHORTCUTS OVERLAY =====================

function toggleShortcuts() {
    const overlay = document.getElementById('shortcuts-overlay');
    overlay.style.display = overlay.style.display === 'none' ? 'flex' : 'none';
}

// ===================== FILTER =====================

function applyFilter() {
    loadImages();
}

// ===================== UNDO / REDO =====================

function pushHistory() {
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
    drawCanvas();
}

function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    state.annotations = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
    saveAnnotationsToServer();
    updateAnnotationsList();
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
