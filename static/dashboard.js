/* ============================================
   Riistakamera Annotator — Dashboard Charts
   Chart.js 4 + date-fns adapter
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

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-refresh').addEventListener('click', loadDashboard);
    document.getElementById('btn-reset').addEventListener('click', () => {
        document.getElementById('filter-from').value = '';
        document.getElementById('filter-to').value = '';
        activeSpecies.clear();
        document.querySelectorAll('.dash-chip').forEach(c => c.classList.remove('active'));
        loadDashboard();
    });
    loadDashboard();
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
    const qs = buildQueryParams();
    const url = '/api/dashboard' + (qs ? '?' + qs : '');
    try {
        const resp = await fetch(url);
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
    } catch (err) {
        console.error('Dashboard load failed:', err);
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
        total > 0 ? accPct + '%' : '—';
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
    const ctx = document.getElementById('chart-species').getContext('2d');
    const species = speciesInData(data);
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
    const ctx = document.getElementById('chart-hourly').getContext('2d');
    const hours = Array.from({ length: 24 }, (_, i) => String(i));
    const species = speciesInData(data);

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
    const ctx = document.getElementById('chart-calendar').getContext('2d');

    const dates = Object.keys(data.daily_activity).sort();
    if (dates.length === 0) {
        charts.calendar = null;
        return;
    }

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
    const ctx = document.getElementById('chart-ai').getContext('2d');

    const species = SPECIES_ORDER.filter(sp => data.ai_accuracy[sp]);
    if (species.length === 0) {
        charts.ai = null;
        return;
    }

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
    const ctx = document.getElementById('chart-confidence').getContext('2d');
    const bins = data.confidence_bins;
    const labels = ['0-10%','10-20%','20-30%','30-40%','40-50%','50-60%','60-70%','70-80%','80-90%','90-100%'];

    // Color gradient: red → amber → green
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

    container.innerHTML = data.recent.map(item => {
        const conf = item.confidence;
        let confClass = 'dash-feed-conf--low';
        if (conf >= 0.8) confClass = 'dash-feed-conf--high';
        else if (conf >= 0.5) confClass = 'dash-feed-conf--med';

        const confText = conf != null ? (conf * 100).toFixed(0) + '%' : '—';
        const dateText = item.camera_date || '—';
        const hourText = item.camera_hour != null ? item.camera_hour + ':00' : '';
        const colorDot = SPECIES_COLORS[item.species] || '#6b7280';

        return `<div class="dash-feed-item">
            <img class="dash-feed-thumb" src="/api/image/${item.image}" alt="" loading="lazy">
            <div class="dash-feed-info">
                <span class="dash-feed-species" style="color:${colorDot}">${label(item.species)}</span>
                <span class="dash-feed-meta">${dateText} ${hourText}</span>
                <span class="dash-feed-conf ${confClass}">${confText}</span>
            </div>
        </div>`;
    }).join('');
}
