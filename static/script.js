// Riistakamera Annotator — Cinematic HUD
// ========================================

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

let canvas, ctx;
const img = new Image();

// ===================== INIT =====================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    canvas = document.getElementById('image-canvas');
    ctx = canvas.getContext('2d');

    // Canvas events
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleZoom, { passive: false });

    // Buttons
    document.getElementById('save-btn').addEventListener('click', saveCurrentAnnotation);
    document.getElementById('next-btn').addEventListener('click', nextImage);
    document.getElementById('prev-btn').addEventListener('click', prevImage);
    document.getElementById('empty-btn').addEventListener('click', markAsEmpty);

    // Filter
    document.getElementById('filter-select').addEventListener('change', (e) => {
        state.filter = e.target.value;
        applyFilter();
    });

    // Shortcuts overlay
    document.getElementById('shortcuts-btn').addEventListener('click', toggleShortcuts);
    document.getElementById('shortcuts-close').addEventListener('click', toggleShortcuts);
    document.getElementById('shortcuts-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) toggleShortcuts();
    });

    // Species pills
    document.querySelectorAll('.sp-pill[data-species]').forEach(btn => {
        btn.addEventListener('click', () => selectSpecies(btn.dataset.species));
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

    // Default to 'predicted' filter when there are unannotated predictions
    try {
        const statsResp = await fetch('/api/stats');
        const stats = await statsResp.json();
        state.stats = stats;
        if (stats.predicted_images > 0 && stats.unannotated_images > 0) {
            state.filter = 'predicted';
            document.getElementById('filter-select').value = 'predicted';
        }
    } catch {}

    await loadImages();
    updateProgress();
}

// ===================== KEYBOARD =====================

function handleKeyboard(e) {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;

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
    if (e.key === 'n' || e.key === 'N' || e.key === 'ArrowRight') { nextImage(); return; }
    if (e.key === 'p' || e.key === 'P' || e.key === 'ArrowLeft') { prevImage(); return; }
    if (e.key === 'c' || e.key === 'C') { clearCurrentBox(); return; }
    if (e.key === 'e' || e.key === 'E') { markAsEmpty(); return; }

    // Shift+A: accept all
    if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        acceptAllPredictions();
        return;
    }

    // A: accept first/focused prediction
    if (e.key === 'a' || e.key === 'A') {
        const idx = state.focusedPrediction >= 0 ? state.focusedPrediction : 0;
        acceptPrediction(idx);
        return;
    }
    // R: reject first/focused prediction
    if (e.key === 'r' || e.key === 'R') {
        const idx = state.focusedPrediction >= 0 ? state.focusedPrediction : 0;
        rejectPrediction(idx);
        return;
    }

    // Tab: cycle prediction focus
    if (e.key === 'Tab' && state.predictions.length > 0) {
        e.preventDefault();
        state.focusedPrediction = (state.focusedPrediction + 1) % state.predictions.length;
        updatePredictionBadge();
        drawCanvas();
        return;
    }

    // Number keys 1-9: select species (auto-accepts predictions if any)
    const num = parseInt(e.key);
    if (num >= 1 && num <= 9) {
        const species = Object.values(CLASS_MAP)[num - 1];
        if (!species) return;
        selectSpecies(species);
        return;
    }

    // Ctrl+Z/Y
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
}

// ===================== SPECIES SELECTION =====================

function selectSpecies(species) {
    state.selectedSpecies = species;
    document.querySelectorAll('.sp-pill[data-species]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.species === species);
    });

    // If user drew a box, save it with this species
    if (state.currentBox) {
        saveCurrentAnnotation();
        return;
    }

    // If predictions exist, override species and accept all immediately
    if (state.predictions.length > 0) {
        const overrideEl = document.getElementById('pred-override');
        if (overrideEl) overrideEl.value = species;
        acceptAllPredictions();
    }
}

// ===================== IMAGE LOADING =====================

async function loadImages() {
    try {
        const filterParam = state.filter !== 'all' ? `?filter=${state.filter}` : '';
        const resp = await fetch(`/api/images${filterParam}`);
        const data = await resp.json();
        state.images = data.images || [];

        document.getElementById('loading').style.display = 'none';
        document.getElementById('no-images').style.display = 'none';

        if (state.images.length === 0) {
            document.getElementById('no-images').textContent =
                state.filter !== 'all'
                    ? 'Kaikki kuvat annotoitu!'
                    : 'Ei kuvia kansiossa.';
            document.getElementById('no-images').style.display = 'flex';
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
    state.selectedSpecies = null;

    // Clear species pill selections
    document.querySelectorAll('.sp-pill').forEach(btn => btn.classList.remove('active'));

    const name = state.images[index];

    // Update UI
    document.getElementById('image-counter').textContent = index + 1;
    document.getElementById('image-name').textContent = name;
    updateProgress();

    // Load image
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

    updatePredictionBadge();
    updateConfirmButton();
    drawCanvas();
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
    } catch {}
}

function updateProgress() {
    const total = state.images.length;
    const current = state.currentIndex + 1;
    const textEl = document.getElementById('progress-text');
    const fillEl = document.getElementById('progress-fill');

    if (state.stats) {
        const annotated = state.stats.annotated_images + state.stats.empty_images;
        const totalAll = state.stats.total_images;
        const remaining = totalAll - annotated;
        textEl.textContent = `${annotated} / ${totalAll} annotoitu · ${remaining} jäljellä`;
        const pct = totalAll > 0 ? (annotated / totalAll * 100) : 0;
        fillEl.style.width = `${pct}%`;
    } else {
        textEl.textContent = `${total} kuvaa`;
        fillEl.style.width = '0%';
    }
}

// ===================== SESSION TRACKING =====================

function updateSessionTimer() {
    const elapsed = Date.now() - session.startTime;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    document.getElementById('session-time').textContent =
        `${mins}:${secs.toString().padStart(2, '0')}`;

    const hours = elapsed / 3600000;
    const speed = hours > 0 ? Math.round(session.annotatedCount / hours) : 0;
    document.getElementById('speed-badge').textContent = `${speed}/h`;
}

// ===================== NAVIGATION =====================

async function advanceAfterSave() {
    if (!state.autoAdvance) return;

    if (state.filter !== 'all') {
        const filterParam = `?filter=${state.filter}`;
        try {
            const resp = await fetch(`/api/images${filterParam}`);
            const data = await resp.json();
            state.images = data.images || [];

            if (state.images.length === 0) {
                document.getElementById('no-images').textContent = 'Kaikki kuvat annotoitu!';
                document.getElementById('no-images').style.display = 'flex';
                updateProgress();
                return;
            }

            const newIndex = Math.min(state.currentIndex, state.images.length - 1);
            setTimeout(() => loadImage(newIndex), 300);
        } catch {
            setTimeout(() => nextImage(), 400);
        }
    } else {
        setTimeout(() => nextImage(), 400);
    }
}

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

    const zi = document.getElementById('zoom-indicator');
    if (zi) zi.textContent = `Zoom: ${Math.round(state.zoom * 100)}%`;

    drawCanvas();
}

function resetView() {
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
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
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 3 / state.zoom;
        ctx.setLineDash([]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        const label = `${SPECIES_LABELS[ann.species] || ann.species}`;
        const fontSize = Math.max(12, 16 / state.zoom);
        ctx.font = `600 ${fontSize}px 'DM Sans', sans-serif`;
        const textWidth = ctx.measureText(label).width + 10;
        const labelHeight = fontSize + 8;

        ctx.fillStyle = 'rgba(52, 211, 153, 0.85)';
        ctx.fillRect(x1, y1 - labelHeight, textWidth, labelHeight);
        ctx.fillStyle = 'white';
        ctx.fillText(label, x1 + 5, y1 - 5);
    });

    // Predictions (amber border)
    state.predictions.forEach((pred, idx) => {
        const [x1, y1, x2, y2] = pred.bbox;
        const w = x2 - x1;
        const h = y2 - y1;
        const isFocused = idx === state.focusedPrediction;
        const color = isFocused ? '#60a5fa' : '#f5b731';

        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, 4 / state.zoom);
        ctx.setLineDash([]);
        ctx.strokeRect(x1, y1, w, h);

        // Corner markers
        const corner = Math.min(12 / state.zoom, w / 3, h / 3);
        ctx.lineWidth = Math.max(4, 5 / state.zoom);
        ctx.beginPath();
        ctx.moveTo(x1, y1 + corner); ctx.lineTo(x1, y1); ctx.lineTo(x1 + corner, y1);
        ctx.moveTo(x2 - corner, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + corner);
        ctx.moveTo(x2, y2 - corner); ctx.lineTo(x2, y2); ctx.lineTo(x2 - corner, y2);
        ctx.moveTo(x1 + corner, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y2 - corner);
        ctx.stroke();

        // Species label
        const species = pred.species;
        const speciesLabel = species ? (SPECIES_LABELS[species] || species) : 'Eläin';
        const conf = pred.species_confidence
            ? Math.round(pred.species_confidence * 100)
            : pred.md_confidence
            ? Math.round(pred.md_confidence * 100)
            : null;
        const label = conf !== null ? `${speciesLabel}  ${conf}%` : speciesLabel;
        const fontSize = Math.max(13, 16 / state.zoom);
        ctx.font = `600 ${fontSize}px 'DM Sans', sans-serif`;
        const textWidth = ctx.measureText(label).width + 14;
        const labelHeight = fontSize + 10;

        const labelY = y1 - labelHeight - 3;
        ctx.fillStyle = isFocused ? 'rgba(20, 30, 50, 0.92)' : 'rgba(12, 14, 20, 0.92)';
        ctx.fillRect(x1, labelY, textWidth, labelHeight);
        ctx.fillStyle = color;
        ctx.fillRect(x1, labelY, textWidth, 2);
        ctx.fillStyle = color;
        ctx.fillText(label, x1 + 7, y1 - 8);
    });

    // Current drawing box (dashed blue)
    if (state.currentBox) {
        const [x1, y1, x2, y2] = state.currentBox;
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2 / state.zoom;
        ctx.setLineDash([5 / state.zoom, 5 / state.zoom]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);
    }

    ctx.restore();
}

// ===================== PREDICTION BADGE =====================

function updatePredictionBadge() {
    const badge = document.getElementById('prediction-badge');
    const speciesEl = document.getElementById('pred-species');
    const confEl = document.getElementById('pred-conf');
    const overrideEl = document.getElementById('pred-override');

    if (state.predictions.length === 0) {
        badge.style.display = 'none';
        return;
    }

    badge.style.display = 'block';

    // Show the focused or first prediction
    const idx = state.focusedPrediction >= 0 ? state.focusedPrediction : 0;
    const pred = state.predictions[idx];

    const species = pred.species || 'muu';
    speciesEl.textContent = SPECIES_LABELS[species] || species;

    const conf = pred.species_confidence
        ? Math.round(pred.species_confidence * 100)
        : pred.md_confidence
        ? Math.round(pred.md_confidence * 100)
        : null;

    if (conf !== null) {
        confEl.textContent = `${conf}%`;
        confEl.className = 'hud-prediction__conf ' + (
            conf >= 90 ? 'hud-prediction__conf--high'
            : conf >= 50 ? 'hud-prediction__conf--med'
            : 'hud-prediction__conf--low'
        );
    } else {
        confEl.textContent = '';
    }

    // Build override dropdown
    overrideEl.innerHTML = Object.entries(SPECIES_LABELS).map(([key, label]) => {
        const sel = key === species ? ' selected' : '';
        return `<option value="${key}"${sel}>${label}</option>`;
    }).join('');

    // Multi-prediction count
    let countEl = badge.querySelector('.hud-prediction__count');
    if (state.predictions.length > 1) {
        if (!countEl) {
            countEl = document.createElement('div');
            countEl.className = 'hud-prediction__count';
            badge.appendChild(countEl);
        }
        countEl.textContent = `${idx + 1} / ${state.predictions.length} ennustetta · Tab vaihtaa`;
    } else if (countEl) {
        countEl.remove();
    }
}

function updatePredictionBadgeSpecies(species) {
    const speciesEl = document.getElementById('pred-species');
    if (speciesEl) {
        speciesEl.textContent = SPECIES_LABELS[species] || species;
    }
}

function updateConfirmButton() {
    const btn = document.getElementById('save-btn');
    if (!btn) return;
    btn.classList.toggle('confirm-ready', state.predictions.length > 0);
}

// ===================== ANNOTATIONS =====================

function saveCurrentAnnotation() {
    // CASE 1: User drew a box
    if (state.currentBox) {
        const species = state.selectedSpecies;
        if (!species) {
            showStatus('Valitse eläinlaji!', 'warning');
            return;
        }

        pushHistory();

        state.annotations.push({
            bbox: state.currentBox.map(Math.round),
            species: species,
            timestamp: new Date().toISOString()
        });

        state.currentBox = null;
        state.isEmptyImage = false;

        saveAnnotationsToServer();
        drawCanvas();

        session.annotatedCount++;
        showStatus(`Tallennettu: ${SPECIES_LABELS[species]}`, 'success');

        advanceAfterSave();
        loadStats();
        return;
    }

    // CASE 2: AI predictions exist — accept all
    if (state.predictions.length > 0) {
        acceptAllPredictions();
        return;
    }

    // CASE 3: No box, no predictions — mark as empty and advance
    markAsEmpty();
}

function deleteAnnotation(index) {
    if (index < 0 || index >= state.annotations.length) return;
    pushHistory();
    state.annotations.splice(index, 1);
    saveAnnotationsToServer();
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
    drawCanvas();
    session.annotatedCount++;
    showStatus('Tyhjä kuva', 'success');

    advanceAfterSave();
    loadStats();
}

// ===================== PREDICTIONS =====================

function acceptPrediction(index) {
    if (index < 0 || index >= state.predictions.length) return;

    const pred = state.predictions[index];
    pushHistory();

    // Use override dropdown value if visible, otherwise pred species
    const overrideEl = document.getElementById('pred-override');
    const species = overrideEl ? overrideEl.value : (pred.species || 'muu');
    const originalSpecies = pred.species || 'muu';

    state.annotations.push({
        bbox: pred.bbox.map(Math.round),
        species: species,
        timestamp: new Date().toISOString(),
        from_prediction: true,
        original_species: originalSpecies,
        md_confidence: pred.md_confidence,
        species_confidence: pred.species_confidence
    });

    state.predictions.splice(index, 1);
    if (state.focusedPrediction >= state.predictions.length) {
        state.focusedPrediction = state.predictions.length - 1;
    }

    saveAnnotationsToServer();
    updatePredictionBadge();
    updateConfirmButton();
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
    updatePredictionBadge();
    updateConfirmButton();
    drawCanvas();
}

function acceptAllPredictions() {
    if (state.predictions.length === 0) return;
    pushHistory();

    const overrideEl = document.getElementById('pred-override');
    const overrideSpecies = overrideEl ? overrideEl.value : null;

    state.predictions.forEach((pred) => {
        const species = overrideSpecies || pred.species || 'muu';
        const originalSpecies = pred.species || 'muu';
        state.annotations.push({
            bbox: pred.bbox.map(Math.round),
            species: species,
            timestamp: new Date().toISOString(),
            from_prediction: true,
            original_species: originalSpecies,
            md_confidence: pred.md_confidence,
            species_confidence: pred.species_confidence
        });
    });

    const count = state.predictions.length;
    state.predictions = [];
    state.focusedPrediction = -1;

    saveAnnotationsToServer();
    updatePredictionBadge();
    updateConfirmButton();
    drawCanvas();

    session.annotatedCount += count;
    showStatus(`Hyväksytty ${count} ennustetta`, 'success');

    advanceAfterSave();
    loadStats();
}

// ===================== STATUS TOAST =====================

function showStatus(message, type) {
    const el = document.getElementById('status-message');
    if (!el) return;
    el.textContent = message;
    el.className = `hud-toast visible hud-toast--${type}`;
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => {
        el.classList.remove('visible');
    }, 2500);
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
    drawCanvas();
}

function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    state.annotations = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
    saveAnnotationsToServer();
    drawCanvas();
}

// ===================== EMPTY OVERLAY =====================

function drawEmptyOverlay() {
    ctx.fillStyle = 'rgba(74, 85, 104, 0.4)';
    ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);
    const fontSize = Math.max(40, img.naturalWidth / 15);
    ctx.font = `700 ${fontSize}px 'DM Sans', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232, 236, 244, 0.6)';
    ctx.fillText('TYHJÄ KUVA', img.naturalWidth / 2, img.naturalHeight / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
}

// ===================== ACTIVE LEARNING =====================

async function loadNextUncertain() {
    try {
        const resp = await fetch('/api/active-learning/ranking?limit=1');
        const data = await resp.json();
        if (!data.ranking || data.ranking.length === 0) {
            showStatus('Ei epävarmoja kuvia', 'warning');
            return;
        }
        const imageName = data.ranking[0].image;
        const idx = state.images.indexOf(imageName);
        if (idx >= 0) {
            await loadImage(idx);
            showStatus(`Epävarmin: ${Math.round(data.ranking[0].max_confidence * 100)}%`, 'success');
        } else {
            showStatus('Kuvaa ei löydy', 'warning');
        }
    } catch (err) {
        console.error('Active learning error:', err);
        showStatus('Epävarmuusjärjestyksen haku epäonnistui', 'error');
    }
}
