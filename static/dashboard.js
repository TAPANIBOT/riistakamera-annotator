/* ============================================
   Riistakamera Annotator — Dashboard Charts
   Chart.js 4 + date-fns adapter
   v2: loading/error, debounce, pikavalinta, tabs,
       table, day view, gallery, lightbox
   ============================================ */

const SPECIES_COLORS = {
    kauris:   '#f5b731',
    peura:    '#34d399',
    janis:    '#60a5fa',
    linnut:   '#c084fc',
    supikoira:'#f87171',
    kettu:    '#fb923c',
    ihminen:  '#94a3b8',
    koira:    '#38bdf8',
    muu:      '#6b7280',
};

const SPECIES_ORDER = ['kauris','peura','janis','linnut','supikoira','kettu','ihminen','koira','muu'];

// Chart.js global defaults (dark theme)
Chart.defaults.color = '#8899b0';
Chart.defaults.font.family = "'DM Sans', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(12, 14, 20, 0.95)';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.1)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.legend.labels.padding = 14;
Chart.defaults.scale.grid = { color: 'rgba(255,255,255,0.04)' };
Chart.defaults.scale.border = { color: 'rgba(255,255,255,0.06)' };

// Store chart instances for destroy/recreate
const charts = {};
let activeSpecies = new Set();
let speciesLabels = {};

// ---- LOADING / ERROR ----
function showLoading() {
    document.getElementById('dash-loading').classList.add('visible');
    document.getElementById('dash-error').classList.remove('visible');
}

function hideLoading() {
    document.getElementById('dash-loading').classList.remove('visible');
}

function showError() {
    document.getElementById('dash-error').classList.add('visible');
}

function hideError() {
    document.getElementById('dash-error').classList.remove('visible');
}

// ---- EMPTY CHART HELPER ----
function showChartEmpty(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    const parent = canvas.parentElement;
    let emptyEl = parent.querySelector('.dash-chart-empty');
    if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'dash-chart-empty';
        parent.appendChild(emptyEl);
    }
    emptyEl.textContent = message || 'Ei havaintoja valituilla suodattimilla';
    emptyEl.style.display = 'flex';
    canvas.style.display = 'none';
}

function hideChartEmpty(canvasId) {
    const canvas = document.getElementById(canvasId);
    const parent = canvas.parentElement;
    const emptyEl = parent.querySelector('.dash-chart-empty');
    if (emptyEl) emptyEl.style.display = 'none';
    canvas.style.display = '';
}

// ---- DEBOUNCE ----
function debounce(fn, ms) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

// ---- FILTER COUNT ----
function updateResetButton() {
    let count = 0;
    if (document.getElementById('filter-from').value) count++;
    if (document.getElementById('filter-to').value) count++;
    count += activeSpecies.size;
    const btn = document.getElementById('btn-reset');
    btn.textContent = count > 0 ? `Nollaa (${count})` : 'Nollaa';
}

// ---- VIEW / TAB ROUTING ----
let currentView = 'overview';

function switchView(view) {
    currentView = view;
    document.querySelectorAll('.dash-view').forEach(v => v.style.display = 'none');

    // Hide tabs indicator for day view (not a tab)
    const isDay = view === 'day';
    document.querySelectorAll('.dash-tab').forEach(t => {
        t.classList.remove('active');
        if (!isDay && t.dataset.view === view) t.classList.add('active');
    });

    const el = document.getElementById('view-' + view);
    if (el) el.style.display = '';

    // Load data for the view if needed
    if (view === 'table') loadTable();
    else if (view === 'gallery') loadGallery();
}

function handleHash() {
    const hash = window.location.hash.replace('#', '') || 'overview';
    if (hash.startsWith('day/')) {
        const date = hash.slice(4);
        switchView('day');
        loadDayView(date);
    } else if (['overview', 'table', 'gallery'].includes(hash)) {
        switchView(hash);
    } else {
        switchView('overview');
    }
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
    const debouncedLoad = debounce(() => loadDashboard(), 300);

    // Date inputs — auto-update with debounce
    document.getElementById('filter-from').addEventListener('input', debouncedLoad);
    document.getElementById('filter-to').addEventListener('input', debouncedLoad);

    // Quick date buttons
    document.querySelectorAll('.dash-btn--quick').forEach(btn => {
        btn.addEventListener('click', () => {
            const range = btn.dataset.range;
            const today = new Date();
            const toStr = today.toISOString().slice(0, 10);
            document.getElementById('filter-to').value = toStr;
            if (range === 'today') {
                document.getElementById('filter-from').value = toStr;
            } else {
                const d = new Date(today);
                d.setDate(d.getDate() - parseInt(range) + 1);
                document.getElementById('filter-from').value = d.toISOString().slice(0, 10);
            }
            // Highlight active quick button
            document.querySelectorAll('.dash-btn--quick').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadDashboard();
        });
    });

    // Reset
    document.getElementById('btn-reset').addEventListener('click', () => {
        document.getElementById('filter-from').value = '';
        document.getElementById('filter-to').value = '';
        activeSpecies.clear();
        document.querySelectorAll('.dash-chip').forEach(c => {
            c.classList.remove('active');
            c.style.borderColor = '';
        });
        document.querySelectorAll('.dash-btn--quick').forEach(b => b.classList.remove('active'));
        updateResetButton();
        loadDashboard();
    });

    // Error retry
    document.getElementById('btn-error-retry').addEventListener('click', loadDashboard);

    // Tab navigation
    document.querySelectorAll('.dash-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            window.location.hash = '#' + tab.dataset.view;
        });
    });

    // Day view back button
    document.getElementById('day-back').addEventListener('click', () => {
        window.location.hash = '#overview';
    });

    // Hash routing
    window.addEventListener('hashchange', handleHash);

    // Initial load
    loadDashboard();
    handleHash();
});

function buildQueryParams() {
    const params = new URLSearchParams();
    const from = document.getElementById('filter-from').value;
    const to = document.getElementById('filter-to').value;
    if (from) params.set('from_date', from);
    if (to) params.set('to_date', to);
    if (activeSpecies.size > 0) params.set('species', [...activeSpecies].join(','));
    return params.toString();
}

async function loadDashboard() {
    showLoading();
    hideError();
    updateResetButton();

    // Reset sub-view pagination when filters change
    tablePage = 1;
    galleryPage = 1;

    const qs = buildQueryParams();
    const url = '/api/dashboard' + (qs ? '?' + qs : '');
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        speciesLabels = data.species_labels || {};

        // Update time badge
        document.getElementById('update-time').textContent =
            new Date().toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });

        buildSpeciesChips(data);
        renderKPIs(data);
        renderSpeciesChart(data);
        renderHourlyChart(data);
        renderCalendarChart(data);
        renderAIAccuracyChart(data);
        renderConfidenceChart(data);
        renderRecentFeed(data);

        hideLoading();
    } catch (err) {
        console.error('Dashboard load failed:', err);
        hideLoading();
        showError();
    }
}

function label(sp) {
    return speciesLabels[sp] || sp;
}

// ---- SPECIES CHIPS ----
function buildSpeciesChips(data) {
    const container = document.getElementById('species-chips');
    // Only rebuild if chips don't exist yet
    if (container.children.length > 0) return;

    SPECIES_ORDER.forEach(sp => {
        const chip = document.createElement('button');
        chip.className = 'dash-chip';
        chip.textContent = label(sp);
        chip.style.borderColor = activeSpecies.has(sp)
            ? SPECIES_COLORS[sp] : '';
        if (activeSpecies.has(sp)) chip.classList.add('active');

        chip.addEventListener('click', () => {
            if (activeSpecies.has(sp)) {
                activeSpecies.delete(sp);
                chip.classList.remove('active');
                chip.style.borderColor = '';
            } else {
                activeSpecies.add(sp);
                chip.classList.add('active');
                chip.style.borderColor = SPECIES_COLORS[sp];
            }
            updateResetButton();
            loadDashboard();
        });
        container.appendChild(chip);
    });
}

// ---- KPI CARDS ----
function renderKPIs(data) {
    document.getElementById('kpi-total').textContent = data.total_images;
    const annPct = data.total_images > 0
        ? Math.round(data.annotated_count / data.total_images * 100) : 0;
    document.getElementById('kpi-annotated').textContent =
        data.annotated_count + ' (' + annPct + '%)';
    document.getElementById('kpi-empty').textContent = data.empty_count;
    document.getElementById('kpi-species').textContent = data.unique_species;
    document.getElementById('kpi-annotations').textContent = data.total_annotations;

    // AI accuracy aggregate
    let correct = 0, total = 0;
    Object.values(data.ai_accuracy).forEach(v => {
        correct += v.correct;
        total += v.total;
    });
    const accPct = total > 0 ? Math.round(correct / total * 100) : 0;
    document.getElementById('kpi-accuracy').textContent =
        total > 0 ? accPct + '%' : '\u2014';
}

// ---- CHART HELPERS ----
function destroyChart(key) {
    if (charts[key]) {
        charts[key].destroy();
        charts[key] = null;
    }
}

function speciesInData(data) {
    return SPECIES_ORDER.filter(sp => (data.species_counts[sp] || 0) > 0);
}

// ---- 1. SPECIES DOUGHNUT ----
function renderSpeciesChart(data) {
    destroyChart('species');
    const species = speciesInData(data);
    if (species.length === 0) {
        showChartEmpty('chart-species');
        return;
    }
    hideChartEmpty('chart-species');
    const ctx = document.getElementById('chart-species').getContext('2d');
    const values = species.map(sp => data.species_counts[sp] || 0);
    const totalAnns = values.reduce((a, b) => a + b, 0);

    charts.species = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: species.map(label),
            datasets: [{
                data: values,
                backgroundColor: species.map(sp => SPECIES_COLORS[sp]),
                borderColor: 'rgba(12,14,20,0.8)',
                borderWidth: 2,
                hoverBorderColor: '#fff',
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const pct = totalAnns > 0
                                ? Math.round(ctx.raw / totalAnns * 100) : 0;
                            return ctx.label + ': ' + ctx.raw + ' (' + pct + '%)';
                        }
                    }
                }
            },
        },
    });
}

// ---- 2. HOURLY STACKED BAR ----
function renderHourlyChart(data) {
    destroyChart('hourly');
    const species = speciesInData(data);
    if (species.length === 0) {
        showChartEmpty('chart-hourly');
        return;
    }
    hideChartEmpty('chart-hourly');
    const ctx = document.getElementById('chart-hourly').getContext('2d');
    const hours = Array.from({ length: 24 }, (_, i) => String(i));

    const datasets = species.map(sp => ({
        label: label(sp),
        data: hours.map(h => (data.hourly_activity[h] || {})[sp] || 0),
        backgroundColor: SPECIES_COLORS[sp],
        borderRadius: 2,
    }));

    charts.hourly = new Chart(ctx, {
        type: 'bar',
        data: { labels: hours.map(h => h + ':00'), datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    title: { display: true, text: 'Kellonaika', color: '#4a5568' },
                    ticks: { maxRotation: 0 },
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: 'Havaintoja', color: '#4a5568' },
                    ticks: { precision: 0 },
                },
            },
            plugins: {
                legend: { position: 'top' },
            },
        },
    });
}

// ---- 3. DAILY STACKED AREA (calendar) ----
function renderCalendarChart(data) {
    destroyChart('calendar');
    const dates = Object.keys(data.daily_activity).sort();
    if (dates.length === 0) {
        showChartEmpty('chart-calendar');
        charts.calendar = null;
        return;
    }
    hideChartEmpty('chart-calendar');
    const ctx = document.getElementById('chart-calendar').getContext('2d');

    const species = speciesInData(data);
    const datasets = species.map(sp => ({
        label: label(sp),
        data: dates.map(d => ({ x: d, y: (data.daily_activity[d] || {})[sp] || 0 })),
        backgroundColor: SPECIES_COLORS[sp] + '40',
        borderColor: SPECIES_COLORS[sp],
        borderWidth: 1.5,
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 5,
    }));

    charts.calendar = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (evt, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const date = dates[idx];
                    if (date) window.location.hash = '#day/' + date;
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'day', tooltipFormat: 'dd.MM.yyyy' },
                    title: { display: true, text: 'Päivämäärä', color: '#4a5568' },
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: 'Havaintoja / päivä', color: '#4a5568' },
                    ticks: { precision: 0 },
                },
            },
            plugins: {
                legend: { position: 'top' },
            },
        },
    });
}

// ---- 4. AI ACCURACY HORIZONTAL BAR ----
function renderAIAccuracyChart(data) {
    destroyChart('ai');
    const species = SPECIES_ORDER.filter(sp => data.ai_accuracy[sp]);
    if (species.length === 0) {
        showChartEmpty('chart-ai');
        charts.ai = null;
        return;
    }
    hideChartEmpty('chart-ai');
    const ctx = document.getElementById('chart-ai').getContext('2d');

    charts.ai = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: species.map(label),
            datasets: [
                {
                    label: 'AI oikein',
                    data: species.map(sp => data.ai_accuracy[sp].correct),
                    backgroundColor: '#34d399',
                    borderRadius: 3,
                },
                {
                    label: 'Ihminen korjasi',
                    data: species.map(sp => data.ai_accuracy[sp].overridden),
                    backgroundColor: '#f87171',
                    borderRadius: 3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
                x: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: { precision: 0 },
                },
                y: { stacked: true },
            },
            plugins: {
                legend: { position: 'top' },
            },
        },
    });
}

// ---- 5. CONFIDENCE HISTOGRAM ----
function renderConfidenceChart(data) {
    destroyChart('confidence');
    const bins = data.confidence_bins;
    const hasData = bins.some(b => b > 0);
    if (!hasData) {
        showChartEmpty('chart-confidence');
        return;
    }
    hideChartEmpty('chart-confidence');
    const ctx = document.getElementById('chart-confidence').getContext('2d');
    const labels = ['0-10%','10-20%','20-30%','30-40%','40-50%','50-60%','60-70%','70-80%','80-90%','90-100%'];

    // Color gradient: red -> amber -> green
    const colors = [
        '#f87171','#fb923c','#fbbf24','#facc15','#a3e635',
        '#4ade80','#34d399','#2dd4bf','#22d3ee','#34d399',
    ];

    charts.confidence = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: bins,
                backgroundColor: colors,
                borderRadius: 3,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Luottamus', color: '#4a5568' } },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Havaintoja', color: '#4a5568' },
                    ticks: { precision: 0 },
                },
            },
            plugins: {
                legend: { display: false },
            },
        },
    });
}

// ---- RECENT FEED ----
function renderRecentFeed(data) {
    const container = document.getElementById('recent-feed');
    if (!data.recent || data.recent.length === 0) {
        container.innerHTML = '<div class="dash-empty">Ei havaintoja vielä.</div>';
        return;
    }

    container.innerHTML = data.recent.map((item, itemIdx) => {
        const conf = item.confidence;
        let confClass = 'dash-feed-conf--low';
        if (conf >= 0.8) confClass = 'dash-feed-conf--high';
        else if (conf >= 0.5) confClass = 'dash-feed-conf--med';

        const confText = conf != null ? (conf * 100).toFixed(0) + '%' : '\u2014';
        const dateText = item.camera_date || '\u2014';
        const hourText = item.camera_hour != null ? item.camera_hour + ':00' : '';
        const colorDot = SPECIES_COLORS[item.species] || '#6b7280';

        return `<div class="dash-feed-item" data-idx="${itemIdx}" style="cursor:pointer">
            <img class="dash-feed-thumb" src="/api/thumbnail/${encodeURIComponent(item.image)}" alt="" loading="lazy">
            <div class="dash-feed-info">
                <span class="dash-feed-species" style="color:${colorDot}">${label(item.species)}</span>
                <span class="dash-feed-meta">${dateText} ${hourText}</span>
                <span class="dash-feed-conf ${confClass}">${confText}</span>
            </div>
        </div>`;
    }).join('');

    // Click feed item to open lightbox (use index)
    container.querySelectorAll('.dash-feed-item').forEach(el => {
        el.addEventListener('click', () => {
            const items = data.recent.map(r => ({
                image: r.image,
                species: r.species,
                camera_date: r.camera_date,
                camera_hour: r.camera_hour,
                confidence: r.confidence,
                from_prediction: r.from_prediction,
            }));
            openLightbox(items, parseInt(el.dataset.idx));
        });
    });
}

// ============================================================
//  TABLE VIEW
// ============================================================
let tableSort = 'date_desc';
let tablePage = 1;

async function loadTable() {
    const qs = buildQueryParams();
    const params = new URLSearchParams(qs);
    params.set('sort', tableSort);
    params.set('page', tablePage);
    params.set('per_page', 50);

    try {
        const resp = await fetch('/api/dashboard/table?' + params.toString());
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        renderTable(data);
    } catch (err) {
        console.error('Table load failed:', err);
    }
}

function renderTable(data) {
    const tbody = document.getElementById('table-body');
    document.getElementById('table-count').textContent = `${data.total} havaintoa`;

    if (data.rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="dash-empty">Ei havaintoja.</td></tr>';
        document.getElementById('table-pagination').innerHTML = '';
        return;
    }

    tbody.innerHTML = data.rows.map((row, rowIdx) => {
        const conf = row.confidence;
        const confPct = conf != null ? (conf * 100).toFixed(0) : '\u2014';
        const confColor = conf == null ? '#4a5568' : conf >= 0.8 ? '#34d399' : conf >= 0.5 ? '#f5b731' : '#f87171';
        const confWidth = conf != null ? (conf * 100).toFixed(0) : 0;
        const dateStr = row.camera_date ? formatDateFi(row.camera_date) : '\u2014';
        const hourStr = row.camera_hour != null ? row.camera_hour + ':00' : '\u2014';
        const color = SPECIES_COLORS[row.species] || '#6b7280';
        const source = row.from_prediction ? 'AI' : 'Ihminen';
        const sourceClass = row.from_prediction ? 'dash-source--ai' : 'dash-source--human';

        return `<tr>
            <td><img class="dash-table-thumb" src="/api/thumbnail/${encodeURIComponent(row.image)}" alt="" loading="lazy" data-row-idx="${rowIdx}"></td>
            <td><span class="dash-species-badge" style="border-color:${color};color:${color}">${row.species_label}</span></td>
            <td class="mono">${dateStr}</td>
            <td class="mono">${hourStr}</td>
            <td><div class="dash-conf-bar"><div class="dash-conf-bar__fill" style="width:${confWidth}%;background:${confColor}"></div><span>${confPct}${conf != null ? '%' : ''}</span></div></td>
            <td><span class="${sourceClass}">${source}</span></td>
        </tr>`;
    }).join('');

    // Thumbnail click -> lightbox (use row index, not image name)
    tbody.querySelectorAll('.dash-table-thumb').forEach(img => {
        img.addEventListener('click', () => {
            const items = data.rows.map(r => ({
                image: r.image,
                species: r.species,
                camera_date: r.camera_date,
                camera_hour: r.camera_hour,
                confidence: r.confidence,
                from_prediction: r.from_prediction,
            }));
            const idx = parseInt(img.dataset.rowIdx);
            openLightbox(items, idx);
        });
    });

    // Pagination
    renderPagination('table-pagination', data.page, data.total_pages, (p) => {
        tablePage = p;
        loadTable();
    });

    // Update sort indicators
    document.querySelectorAll('#obs-table th.sortable').forEach(th => {
        th.classList.remove('sort-active', 'sort-asc', 'sort-desc');
        const field = th.dataset.sort;
        if (tableSort.startsWith(field + '_')) {
            th.classList.add('sort-active');
            th.classList.add(tableSort.endsWith('_asc') ? 'sort-asc' : 'sort-desc');
        }
    });
}

function formatDateFi(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(d)}.${parseInt(m)}.${y}`;
}

// Table header sort click
document.addEventListener('click', (e) => {
    const th = e.target.closest('#obs-table th.sortable');
    if (!th) return;
    const field = th.dataset.sort;
    if (tableSort.startsWith(field + '_')) {
        tableSort = field + (tableSort.endsWith('_desc') ? '_asc' : '_desc');
    } else {
        tableSort = field + '_desc';
    }
    tablePage = 1;
    loadTable();
});

// ============================================================
//  GALLERY VIEW
// ============================================================
let galleryPage = 1;

async function loadGallery() {
    const qs = buildQueryParams();
    const params = new URLSearchParams(qs);
    const sort = document.getElementById('gallery-sort').value;
    params.set('sort', sort);
    params.set('page', galleryPage);
    params.set('per_page', 24);

    try {
        const resp = await fetch('/api/gallery?' + params.toString());
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        renderGallery(data);
    } catch (err) {
        console.error('Gallery load failed:', err);
    }
}

function renderGallery(data) {
    const grid = document.getElementById('gallery-grid');
    document.getElementById('gallery-count').textContent = `${data.total} havaintoa`;

    if (data.images.length === 0) {
        grid.innerHTML = '<div class="dash-empty">Ei kuvia valituilla suodattimilla.</div>';
        document.getElementById('gallery-pagination').innerHTML = '';
        return;
    }

    grid.innerHTML = data.images.map((item, itemIdx) => {
        const conf = item.confidence;
        const confText = conf != null ? (conf * 100).toFixed(0) + '%' : '';
        const color = SPECIES_COLORS[item.species] || '#6b7280';
        const dateText = item.camera_date ? formatDateFi(item.camera_date) : '';
        const hourText = item.camera_hour != null ? item.camera_hour + ':00' : '';

        return `<div class="dash-gallery-card" data-idx="${itemIdx}">
            <img class="dash-gallery-img" src="/api/thumbnail/${encodeURIComponent(item.image)}" alt="" loading="lazy">
            <div class="dash-gallery-overlay">
                <span class="dash-gallery-species" style="color:${color}">${label(item.species)}</span>
                <span class="dash-gallery-meta">${dateText} ${hourText}</span>
                ${confText ? `<span class="dash-gallery-conf">${confText}</span>` : ''}
            </div>
        </div>`;
    }).join('');

    // Click -> lightbox (use index, not image name)
    grid.querySelectorAll('.dash-gallery-card').forEach(card => {
        card.addEventListener('click', () => {
            const items = data.images.map(r => ({
                image: r.image,
                species: r.species,
                camera_date: r.camera_date,
                camera_hour: r.camera_hour,
                confidence: r.confidence,
                from_prediction: r.from_prediction,
            }));
            const idx = parseInt(card.dataset.idx);
            openLightbox(items, idx);
        });
    });

    renderPagination('gallery-pagination', data.page, data.total_pages, (p) => {
        galleryPage = p;
        loadGallery();
    });
}

// Gallery sort change
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('gallery-sort').addEventListener('change', () => {
        galleryPage = 1;
        loadGallery();
    });
});

// ============================================================
//  PAGINATION HELPER
// ============================================================
function renderPagination(containerId, currentPage, totalPages, onChange) {
    const container = document.getElementById(containerId);
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button class="dash-page-btn" ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">&laquo;</button>`;

    const maxVisible = 7;
    let start = Math.max(1, currentPage - 3);
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

    if (start > 1) {
        html += `<button class="dash-page-btn" data-page="1">1</button>`;
        if (start > 2) html += `<span class="dash-page-dots">&hellip;</span>`;
    }
    for (let i = start; i <= end; i++) {
        html += `<button class="dash-page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    if (end < totalPages) {
        if (end < totalPages - 1) html += `<span class="dash-page-dots">&hellip;</span>`;
        html += `<button class="dash-page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    html += `<button class="dash-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">&raquo;</button>`;

    container.innerHTML = html;
    container.querySelectorAll('.dash-page-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => onChange(parseInt(btn.dataset.page)));
    });
}

// ============================================================
//  DAY VIEW
// ============================================================
async function loadDayView(date) {
    showLoading();
    try {
        const resp = await fetch(`/api/dashboard/day?date=${date}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        renderDayView(data);
        hideLoading();
    } catch (err) {
        console.error('Day view load failed:', err);
        hideLoading();
        showError();
    }
}

function renderDayView(data) {
    // Title
    const [y, m, d] = data.date.split('-');
    document.getElementById('day-title').textContent = `${parseInt(d)}.${parseInt(m)}.${y}`;

    // Mini KPIs
    const kpis = document.getElementById('day-kpis');
    kpis.innerHTML = `
        <div class="dash-kpi"><div class="dash-kpi__value">${data.total_annotations}</div><div class="dash-kpi__label">Havaintoja</div></div>
        <div class="dash-kpi"><div class="dash-kpi__value">${Object.keys(data.species_counts).length}</div><div class="dash-kpi__label">Lajeja</div></div>
        <div class="dash-kpi"><div class="dash-kpi__value">${data.unique_images}</div><div class="dash-kpi__label">Kuvia</div></div>
    `;

    // Hourly chart
    destroyChart('dayHourly');
    const species = SPECIES_ORDER.filter(sp => data.species_counts[sp]);
    const hours = Array.from({ length: 24 }, (_, i) => String(i));
    const ctx1 = document.getElementById('chart-day-hourly').getContext('2d');
    charts.dayHourly = new Chart(ctx1, {
        type: 'bar',
        data: {
            labels: hours.map(h => h + ':00'),
            datasets: species.map(sp => ({
                label: (data.species_labels || {})[sp] || sp,
                data: hours.map(h => (data.hourly_breakdown[h] || {})[sp] || 0),
                backgroundColor: SPECIES_COLORS[sp],
                borderRadius: 2,
            })),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, ticks: { maxRotation: 0 } },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
            },
            plugins: { legend: { position: 'top' } },
        },
    });

    // Species donut
    destroyChart('daySpecies');
    const ctx2 = document.getElementById('chart-day-species').getContext('2d');
    const spKeys = Object.keys(data.species_counts);
    charts.daySpecies = new Chart(ctx2, {
        type: 'doughnut',
        data: {
            labels: spKeys.map(sp => (data.species_labels || {})[sp] || sp),
            datasets: [{
                data: spKeys.map(sp => data.species_counts[sp]),
                backgroundColor: spKeys.map(sp => SPECIES_COLORS[sp] || '#6b7280'),
                borderColor: 'rgba(12,14,20,0.8)',
                borderWidth: 2,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: { legend: { position: 'right' } },
        },
    });

    // Image grid
    const grid = document.getElementById('day-images');
    grid.innerHTML = data.images.map((item, itemIdx) => {
        const color = SPECIES_COLORS[item.species] || '#6b7280';
        const hourText = item.camera_hour != null ? item.camera_hour + ':00' : '';
        return `<div class="dash-gallery-card" data-idx="${itemIdx}">
            <img class="dash-gallery-img" src="/api/thumbnail/${encodeURIComponent(item.image)}" alt="" loading="lazy">
            <div class="dash-gallery-overlay">
                <span class="dash-gallery-species" style="color:${color}">${item.species_label}</span>
                <span class="dash-gallery-meta">${hourText}</span>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.dash-gallery-card').forEach(card => {
        card.addEventListener('click', () => {
            const items = data.images.map(r => ({
                image: r.image,
                species: r.species,
                camera_date: data.date,
                camera_hour: r.camera_hour,
                confidence: r.confidence,
            }));
            openLightbox(items, parseInt(card.dataset.idx));
        });
    });
}

// ============================================================
//  LIGHTBOX
// ============================================================
let lightboxItems = [];
let lightboxIndex = 0;

function openLightbox(items, index) {
    lightboxItems = items;
    lightboxIndex = index;
    updateLightbox();
    document.getElementById('lightbox').classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    document.getElementById('lightbox').classList.remove('visible');
    document.body.style.overflow = '';
}

function updateLightbox() {
    const item = lightboxItems[lightboxIndex];
    if (!item) return;
    document.getElementById('lb-img').src = '/api/image/' + encodeURIComponent(item.image);
    const conf = item.confidence;
    const confText = conf != null ? (conf * 100).toFixed(0) + '%' : '\u2014';
    const dateText = item.camera_date ? formatDateFi(item.camera_date) : '\u2014';
    const hourText = item.camera_hour != null ? item.camera_hour + ':00' : '';
    const source = item.from_prediction ? 'AI' : 'Ihminen';
    const color = SPECIES_COLORS[item.species] || '#6b7280';

    document.getElementById('lb-info').innerHTML = `
        <span class="dash-feed-species" style="color:${color};font-size:16px">${label(item.species)}</span>
        <span class="lb-detail">${dateText} ${hourText}</span>
        <span class="lb-detail">Luottamus: ${confText}</span>
        <span class="lb-detail">Lähde: ${source}</span>
        <span class="lb-detail" style="font-size:10px;color:var(--text-muted)">${lightboxIndex + 1} / ${lightboxItems.length}</span>
    `;

    // Nav visibility
    document.getElementById('lb-prev').style.display = lightboxIndex > 0 ? '' : 'none';
    document.getElementById('lb-next').style.display = lightboxIndex < lightboxItems.length - 1 ? '' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('lb-close').addEventListener('click', closeLightbox);
    document.getElementById('lb-prev').addEventListener('click', () => {
        if (lightboxIndex > 0) { lightboxIndex--; updateLightbox(); }
    });
    document.getElementById('lb-next').addEventListener('click', () => {
        if (lightboxIndex < lightboxItems.length - 1) { lightboxIndex++; updateLightbox(); }
    });
    document.getElementById('lightbox').addEventListener('click', (e) => {
        if (e.target.id === 'lightbox') closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (!document.getElementById('lightbox').classList.contains('visible')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft' && lightboxIndex > 0) { lightboxIndex--; updateLightbox(); }
        if (e.key === 'ArrowRight' && lightboxIndex < lightboxItems.length - 1) { lightboxIndex++; updateLightbox(); }
    });
});
