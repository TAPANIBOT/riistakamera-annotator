#!/usr/bin/env python3
"""
Riistakamera Annotator - Flask backend
Kuvien lataus, annotaatioiden tallennus, AI-ennusteet, YOLO-eksportti
"""
import os
import re
import json
from pathlib import Path
from datetime import datetime
from flask import Flask, render_template, jsonify, request, send_from_directory
from PIL import Image

app = Flask(__name__)

# Konfiguraatio ympäristömuuttujista
DATA_DIR = Path(os.environ.get('DATA_DIR', '/data'))
IMAGE_DIR = Path(os.environ.get('IMAGE_DIR', str(DATA_DIR / 'images' / 'incoming')))
ANNOTATION_DIR = Path(os.environ.get('ANNOTATION_DIR', str(DATA_DIR / 'annotations')))
PREDICTION_DIR = Path(os.environ.get('PREDICTION_DIR', str(DATA_DIR / 'predictions')))
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.gif'}

CLASS_MAP = {
    0: 'kauris',
    1: 'peura',
    2: 'janis',
    3: 'linnut',
    4: 'supikoira',
    5: 'kettu',
    6: 'ihminen',
    7: 'koira',
    8: 'muu',
}

SPECIES_TO_ID = {v: k for k, v in CLASS_MAP.items()}


def ensure_dirs():
    """Luo tarvittavat hakemistot."""
    for d in [IMAGE_DIR, ANNOTATION_DIR, PREDICTION_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def get_image_files():
    """Hae kaikki kuvat kansiosta."""
    if not IMAGE_DIR.exists():
        return []
    images = []
    for f in sorted(IMAGE_DIR.iterdir()):
        if f.suffix.lower() in ALLOWED_EXTENSIONS:
            images.append(f.name)
    return images


def get_filtered_images(filter_type):
    """Suodata kuvat tyypin mukaan."""
    all_images = get_image_files()
    if filter_type == 'all':
        return all_images

    result = []
    for img_name in all_images:
        ann_path = get_annotation_path(img_name)
        pred_path = get_prediction_path(img_name)

        has_annotation = False
        is_empty = False
        if ann_path.exists():
            with open(ann_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            is_empty = data.get('is_empty', False)
            has_annotation = bool(data.get('annotations')) or is_empty

        has_prediction = pred_path.exists()

        if filter_type == 'annotated' and has_annotation:
            result.append(img_name)
        elif filter_type == 'unannotated' and not has_annotation:
            result.append(img_name)
        elif filter_type == 'predicted' and has_prediction and not has_annotation:
            result.append(img_name)
        elif filter_type == 'empty' and is_empty:
            result.append(img_name)

    return result


def get_annotation_path(image_name):
    """Palauta annotaatiotiedoston polku."""
    base = Path(image_name).stem
    return ANNOTATION_DIR / f"{base}.json"


def get_prediction_path(image_name):
    """Palauta ennustetiedoston polku."""
    base = Path(image_name).stem
    return PREDICTION_DIR / f"{base}.json"


# ===================== ROUTES =====================

@app.route('/')
def index():
    return render_template('dashboard.html')


@app.route('/annotator')
def annotator():
    return render_template('index.html')


@app.route('/api/images')
def list_images():
    filter_type = request.args.get('filter', 'all')
    if filter_type not in ('all', 'annotated', 'unannotated', 'predicted', 'empty'):
        filter_type = 'all'
    images = get_filtered_images(filter_type)
    return jsonify({'images': images, 'total': len(images), 'filter': filter_type})


@app.route('/api/image/<path:filename>')
def get_image(filename):
    return send_from_directory(IMAGE_DIR, filename)


@app.route('/api/annotation/<path:image_name>')
def get_annotation(image_name):
    path = get_annotation_path(image_name)
    if path.exists():
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    return jsonify({'image_name': image_name, 'annotations': [], 'is_empty': False})


@app.route('/api/annotation/<path:image_name>', methods=['POST'])
def save_annotation(image_name):
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid data'}), 400

    if 'annotations' not in data and 'is_empty' not in data:
        return jsonify({'error': 'Must provide annotations or is_empty'}), 400

    path = get_annotation_path(image_name)
    data['image_name'] = image_name

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    return jsonify({'success': True})


@app.route('/api/predictions/<path:image_name>')
def get_predictions(image_name):
    path = get_prediction_path(image_name)
    if path.exists():
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    return jsonify({'image_name': image_name, 'predictions': []})


@app.route('/api/image-info/<path:filename>')
def get_image_info(filename):
    try:
        img_path = IMAGE_DIR / filename
        with Image.open(img_path) as img:
            width, height = img.size
        return jsonify({'width': width, 'height': height})
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/stats')
def get_stats():
    """Tilastot: kuvien ja annotaatioiden määrä."""
    images = get_image_files()
    annotated = 0
    empty_images = 0
    total_annotations = 0
    species_counts = {}

    for img_name in images:
        path = get_annotation_path(img_name)
        if path.exists():
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if data.get('is_empty', False):
                empty_images += 1
                continue
            anns = data.get('annotations', [])
            if anns:
                annotated += 1
                total_annotations += len(anns)
                for ann in anns:
                    sp = ann.get('species', 'muu')
                    species_counts[sp] = species_counts.get(sp, 0) + 1

    predicted = 0
    for img_name in images:
        path = get_prediction_path(img_name)
        if path.exists():
            predicted += 1

    return jsonify({
        'total_images': len(images),
        'annotated_images': annotated,
        'empty_images': empty_images,
        'unannotated_images': len(images) - annotated - empty_images,
        'predicted_images': predicted,
        'total_annotations': total_annotations,
        'species_counts': species_counts,
        'class_map': CLASS_MAP,
    })


@app.route('/api/active-learning/ranking')
def active_learning_ranking():
    """Palauta kuvat epävarmuusjärjestyksessä."""
    from training.active_learning import get_uncertainty_ranking
    limit = request.args.get('limit', 50, type=int)
    ranking = get_uncertainty_ranking(limit=limit)
    return jsonify({'ranking': ranking, 'total': len(ranking)})


@app.route('/api/export/yolo', methods=['POST'])
def export_yolo():
    """Triggeroi YOLO-eksportin."""
    try:
        from export_yolo import export_dataset
        result = export_dataset(
            annotation_dir=str(ANNOTATION_DIR),
            image_dir=str(IMAGE_DIR),
            output_dir=str(DATA_DIR / 'dataset'),
            class_map=CLASS_MAP,
            species_to_id=SPECIES_TO_ID,
        )
        return jsonify(result)
    except ImportError:
        return jsonify({'error': 'export_yolo module not found'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/train', methods=['POST'])
def train_model():
    """Eksportoi dataset + kouluta YOLO-malli."""
    import threading

    # Check if already training
    if getattr(app, '_training_in_progress', False):
        return jsonify({'error': 'Koulutus on jo käynnissä'}), 409

    def run_training():
        app._training_in_progress = True
        app._training_status = 'exporting'
        try:
            # Step 1: Export YOLO dataset
            from export_yolo import export_dataset
            export_result = export_dataset(
                annotation_dir=str(ANNOTATION_DIR),
                image_dir=str(IMAGE_DIR),
                output_dir=str(DATA_DIR / 'dataset'),
                class_map=CLASS_MAP,
                species_to_id=SPECIES_TO_ID,
            )
            if not export_result.get('success'):
                app._training_status = f'error: {export_result.get("error", "export failed")}'
                return

            app._training_status = 'training'

            # Step 2: Train model (CPU in Docker)
            from training.train import train_species_model
            train_result = train_species_model(
                dataset_yaml=str(DATA_DIR / 'dataset' / 'dataset.yaml'),
                base_model='yolo11n.pt',
                epochs=50,
                imgsz=640,
                batch=4,
                device='cpu',
                patience=15,
            )
            if train_result.get('success'):
                app._training_status = 'done'
                app._training_result = train_result
            else:
                app._training_status = f'error: {train_result.get("error", "training failed")}'
        except Exception as e:
            app._training_status = f'error: {str(e)}'
        finally:
            app._training_in_progress = False

    thread = threading.Thread(target=run_training, daemon=True)
    thread.start()

    return jsonify({'success': True, 'message': 'Koulutus käynnistetty'})


@app.route('/api/train/status')
def train_status():
    """Koulutuksen tila."""
    return jsonify({
        'in_progress': getattr(app, '_training_in_progress', False),
        'status': getattr(app, '_training_status', 'idle'),
        'result': getattr(app, '_training_result', None),
    })


@app.route('/api/fetch', methods=['POST'])
def fetch_images():
    """Triggeroi sähköpostinouto + tunnistus (suora IMAP, ei Gmail-agenttia)."""
    try:
        from ingestion.fetch_camera_imap import fetch_camera_images
        result = fetch_camera_images()
    except Exception as e:
        return jsonify({'error': f'Sähköpostihaku epäonnistui: {e}'}), 500

    if result.get('new_images'):
        try:
            from detection.detect_batch import detect_new_images
            result['detection'] = detect_new_images()
        except Exception as e:
            result['detection_error'] = str(e)

    return jsonify(result)


@app.route('/api/recent-detections')
def recent_detections():
    """Viimeisimmät tunnistukset Tapanin raportteihin."""
    limit = request.args.get('limit', 20, type=int)

    if not PREDICTION_DIR.exists():
        return jsonify({'detections': [], 'species_summary': {}})

    pred_files = sorted(
        PREDICTION_DIR.glob('*.json'),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )[:limit]

    detections = []
    species_summary = {}

    for pf in pred_files:
        with open(pf, 'r', encoding='utf-8') as f:
            data = json.load(f)
        image_name = data.get('image', pf.stem)
        preds = data.get('predictions', [])
        for pred in preds:
            sp = pred.get('species')
            if sp:
                species_summary[sp] = species_summary.get(sp, 0) + 1
        detections.append({
            'image': image_name,
            'predictions_count': len(preds),
            'species': [p.get('species') for p in preds if p.get('species')],
        })

    return jsonify({
        'detections': detections,
        'species_summary': species_summary,
        'total': len(detections),
    })


SPECIES_LABELS = {
    'kauris': 'Metsäkauris',
    'peura': 'Valkohäntäpeura',
    'janis': 'Jänis',
    'linnut': 'Linnut',
    'supikoira': 'Supikoira',
    'kettu': 'Kettu',
    'ihminen': 'Ihminen',
    'koira': 'Koira',
    'muu': 'Muu',
}

_FILENAME_DATE_RE = re.compile(r'(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})')


def _parse_camera_datetime(filename):
    """Parse camera date+time from filename like 15339_25173_20260128_072622867."""
    m = _FILENAME_DATE_RE.search(filename)
    if not m:
        return None, None
    y, mo, d, h, mi, s = (int(x) for x in m.groups())
    try:
        dt = datetime(y, mo, d, h, mi, s)
        return dt.strftime('%Y-%m-%d'), dt.hour
    except ValueError:
        return None, None


@app.route('/api/dashboard')
def dashboard_data():
    """Aggregated analytics data for the dashboard."""
    # Query params
    from_date = request.args.get('from_date', '')
    to_date = request.args.get('to_date', '')
    species_filter = set()
    sp_param = request.args.get('species', '')
    if sp_param:
        species_filter = {s.strip() for s in sp_param.split(',') if s.strip()}

    images = get_image_files()

    total_images = 0
    annotated_count = 0
    empty_count = 0
    unannotated_count = 0
    total_annotations = 0
    species_counts = {}
    hourly_activity = {}     # hour -> {species: count}
    daily_activity = {}      # date -> {species: count}
    ai_accuracy = {}         # species -> {correct, overridden, total}
    confidence_bins = [0] * 10  # 0-10%, 10-20%, ..., 90-100%
    recent = []
    from_prediction_total = 0

    for img_name in images:
        camera_date, camera_hour = _parse_camera_datetime(img_name)

        # Date filtering
        if from_date and camera_date and camera_date < from_date:
            continue
        if to_date and camera_date and camera_date > to_date:
            continue

        total_images += 1

        ann_path = get_annotation_path(img_name)
        if not ann_path.exists():
            unannotated_count += 1
            continue

        with open(ann_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if data.get('is_empty', False):
            empty_count += 1
            continue

        anns = data.get('annotations', [])
        if not anns:
            unannotated_count += 1
            continue

        # Check if any annotation matches species filter
        if species_filter:
            has_match = any(ann.get('species', 'muu') in species_filter for ann in anns)
            if not has_match:
                total_images -= 1
                continue

        annotated_count += 1

        for ann in anns:
            sp = ann.get('species', 'muu')

            # Species filter
            if species_filter and sp not in species_filter:
                continue

            total_annotations += 1
            species_counts[sp] = species_counts.get(sp, 0) + 1

            # Hourly activity
            if camera_hour is not None:
                h_key = str(camera_hour)
                if h_key not in hourly_activity:
                    hourly_activity[h_key] = {}
                hourly_activity[h_key][sp] = hourly_activity[h_key].get(sp, 0) + 1

            # Daily activity
            if camera_date:
                if camera_date not in daily_activity:
                    daily_activity[camera_date] = {}
                daily_activity[camera_date][sp] = daily_activity[camera_date].get(sp, 0) + 1

            # AI accuracy
            if ann.get('from_prediction'):
                from_prediction_total += 1
                original = ann.get('original_species', '')
                if sp not in ai_accuracy:
                    ai_accuracy[sp] = {'correct': 0, 'overridden': 0, 'total': 0}
                ai_accuracy[sp]['total'] += 1
                if original == sp:
                    ai_accuracy[sp]['correct'] += 1
                else:
                    ai_accuracy[sp]['overridden'] += 1

            # Confidence histogram
            conf = ann.get('species_confidence') or ann.get('md_confidence')
            if conf is not None:
                bin_idx = min(int(conf * 10), 9)
                confidence_bins[bin_idx] += 1

            # Recent feed
            recent.append({
                'image': img_name,
                'species': sp,
                'camera_date': camera_date,
                'camera_hour': camera_hour,
                'confidence': ann.get('species_confidence') or ann.get('md_confidence'),
                'from_prediction': ann.get('from_prediction', False),
                'timestamp': ann.get('timestamp', ''),
            })

    # Sort recent by timestamp descending, keep 20
    recent.sort(key=lambda r: r.get('timestamp', ''), reverse=True)
    recent = recent[:20]

    return jsonify({
        'total_images': total_images,
        'annotated_count': annotated_count,
        'empty_count': empty_count,
        'unannotated_count': unannotated_count,
        'total_annotations': total_annotations,
        'unique_species': len(species_counts),
        'species_counts': species_counts,
        'hourly_activity': hourly_activity,
        'daily_activity': daily_activity,
        'ai_accuracy': ai_accuracy,
        'ai_from_prediction_total': from_prediction_total,
        'confidence_bins': confidence_bins,
        'recent': recent,
        'species_labels': SPECIES_LABELS,
    })


def _build_annotation_rows(from_date='', to_date='', species_filter=None):
    """Build flat list of annotation rows for table/gallery views."""
    images = get_image_files()
    rows = []
    for img_name in images:
        camera_date, camera_hour = _parse_camera_datetime(img_name)
        if from_date and camera_date and camera_date < from_date:
            continue
        if to_date and camera_date and camera_date > to_date:
            continue

        ann_path = get_annotation_path(img_name)
        if not ann_path.exists():
            continue
        with open(ann_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if data.get('is_empty', False):
            continue
        anns = data.get('annotations', [])
        if not anns:
            continue

        for ann in anns:
            sp = ann.get('species', 'muu')
            if species_filter and sp not in species_filter:
                continue
            rows.append({
                'image': img_name,
                'species': sp,
                'species_label': SPECIES_LABELS.get(sp, sp),
                'camera_date': camera_date,
                'camera_hour': camera_hour,
                'confidence': ann.get('species_confidence') or ann.get('md_confidence'),
                'from_prediction': ann.get('from_prediction', False),
                'original_species': ann.get('original_species', ''),
            })
    return rows


@app.route('/api/dashboard/table')
def dashboard_table():
    """Paginated table data for observations."""
    from_date = request.args.get('from_date', '')
    to_date = request.args.get('to_date', '')
    sp_param = request.args.get('species', '')
    species_filter = {s.strip() for s in sp_param.split(',') if s.strip()} if sp_param else None
    sort = request.args.get('sort', 'date_desc')
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    per_page = min(per_page, 200)

    rows = _build_annotation_rows(from_date, to_date, species_filter)

    # Sort
    sort_field, sort_dir = (sort.rsplit('_', 1) + ['desc'])[:2]
    reverse = sort_dir == 'desc'
    if sort_field == 'date':
        rows.sort(key=lambda r: (r['camera_date'] or '', r['camera_hour'] or 0), reverse=reverse)
    elif sort_field == 'species':
        rows.sort(key=lambda r: r['species'], reverse=reverse)
    elif sort_field == 'confidence':
        rows.sort(key=lambda r: r['confidence'] or 0, reverse=reverse)
    elif sort_field == 'hour':
        rows.sort(key=lambda r: r['camera_hour'] or 0, reverse=reverse)
    elif sort_field == 'source':
        rows.sort(key=lambda r: r['from_prediction'], reverse=reverse)
    else:
        rows.sort(key=lambda r: (r['camera_date'] or '', r['camera_hour'] or 0), reverse=True)

    total = len(rows)
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    start = (page - 1) * per_page
    page_rows = rows[start:start + per_page]

    return jsonify({
        'rows': page_rows,
        'total': total,
        'page': page,
        'total_pages': total_pages,
    })


@app.route('/api/dashboard/day')
def dashboard_day():
    """Day-specific analytics data."""
    date = request.args.get('date', '')
    if not date:
        return jsonify({'error': 'date parameter required'}), 400

    images = get_image_files()
    total_annotations = 0
    species_counts = {}
    hourly_breakdown = {}
    day_images = []

    for img_name in images:
        camera_date, camera_hour = _parse_camera_datetime(img_name)
        if camera_date != date:
            continue

        ann_path = get_annotation_path(img_name)
        if not ann_path.exists():
            continue
        with open(ann_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if data.get('is_empty', False):
            continue
        anns = data.get('annotations', [])
        if not anns:
            continue

        for ann in anns:
            sp = ann.get('species', 'muu')
            total_annotations += 1
            species_counts[sp] = species_counts.get(sp, 0) + 1

            if camera_hour is not None:
                h_key = str(camera_hour)
                if h_key not in hourly_breakdown:
                    hourly_breakdown[h_key] = {}
                hourly_breakdown[h_key][sp] = hourly_breakdown[h_key].get(sp, 0) + 1

            day_images.append({
                'image': img_name,
                'species': sp,
                'species_label': SPECIES_LABELS.get(sp, sp),
                'camera_hour': camera_hour,
                'confidence': ann.get('species_confidence') or ann.get('md_confidence'),
            })

    unique_images = len({img['image'] for img in day_images})

    return jsonify({
        'date': date,
        'total_annotations': total_annotations,
        'unique_images': unique_images,
        'species_counts': species_counts,
        'hourly_breakdown': hourly_breakdown,
        'images': day_images,
        'species_labels': SPECIES_LABELS,
    })


@app.route('/api/gallery')
def gallery_data():
    """Paginated gallery data."""
    from_date = request.args.get('from_date', '')
    to_date = request.args.get('to_date', '')
    sp_param = request.args.get('species', '')
    species_filter = {s.strip() for s in sp_param.split(',') if s.strip()} if sp_param else None
    sort = request.args.get('sort', 'date_desc')
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 24, type=int)
    per_page = min(per_page, 100)

    rows = _build_annotation_rows(from_date, to_date, species_filter)

    # Sort
    sort_field, sort_dir = (sort.rsplit('_', 1) + ['desc'])[:2]
    reverse = sort_dir == 'desc'
    if sort_field == 'date':
        rows.sort(key=lambda r: (r['camera_date'] or '', r['camera_hour'] or 0), reverse=reverse)
    elif sort_field == 'confidence':
        rows.sort(key=lambda r: r['confidence'] or 0, reverse=reverse)
    else:
        rows.sort(key=lambda r: (r['camera_date'] or '', r['camera_hour'] or 0), reverse=True)

    total = len(rows)
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    start = (page - 1) * per_page
    page_rows = rows[start:start + per_page]

    return jsonify({
        'images': page_rows,
        'total': total,
        'page': page,
        'total_pages': total_pages,
    })


@app.route('/api/ai/brief')
def ai_brief():
    """Token-efficient plain text summary for AI agents."""
    from flask import Response

    # Parse params
    days = request.args.get('days', 7, type=int)
    if days < 1 or days > 90:
        return Response('Virhe: days oltava 1-90', status=400, mimetype='text/plain')

    sp_param = request.args.get('species', '')
    species_filter = {s.strip() for s in sp_param.split(',') if s.strip()} if sp_param else None
    detail = request.args.get('detail', 'summary')
    from_date_param = request.args.get('from_date', '')

    # Calculate date range
    from datetime import timedelta
    today = datetime.now()
    if from_date_param:
        try:
            range_start = datetime.strptime(from_date_param, '%Y-%m-%d')
            range_end = range_start + timedelta(days=1)
        except ValueError:
            return Response('Virhe: from_date muodossa YYYY-MM-DD', status=400, mimetype='text/plain')
    else:
        range_start = today - timedelta(days=days)
        range_end = today + timedelta(days=1)

    start_str = range_start.strftime('%Y-%m-%d')
    end_str = range_end.strftime('%Y-%m-%d')

    images = get_image_files()

    _FI_WEEKDAYS = ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su']

    total_images = 0
    empty_count = 0
    unannotated_count = 0
    total_detections = 0
    species_counts = {}
    hourly_totals = {}   # hour -> count
    daily_counts = {}    # date_str -> count
    daily_species = {}   # date_str -> {label: count}
    ai_accuracy = {}     # species -> {correct, total}

    for img_name in images:
        camera_date, camera_hour = _parse_camera_datetime(img_name)

        # Date filtering
        if camera_date and camera_date < start_str:
            continue
        if camera_date and camera_date >= end_str:
            continue

        total_images += 1

        ann_path = get_annotation_path(img_name)
        if not ann_path.exists():
            unannotated_count += 1
            continue

        with open(ann_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if data.get('is_empty', False):
            empty_count += 1
            continue

        anns = data.get('annotations', [])
        if not anns:
            unannotated_count += 1
            continue

        for ann in anns:
            sp = ann.get('species', 'muu')
            if species_filter and sp not in species_filter:
                continue

            total_detections += 1
            label = SPECIES_LABELS.get(sp, sp).lower()
            species_counts[label] = species_counts.get(label, 0) + 1

            if camera_hour is not None:
                hourly_totals[camera_hour] = hourly_totals.get(camera_hour, 0) + 1

            if camera_date:
                daily_counts[camera_date] = daily_counts.get(camera_date, 0) + 1
                if camera_date not in daily_species:
                    daily_species[camera_date] = {}
                daily_species[camera_date][label] = daily_species[camera_date].get(label, 0) + 1

            if ann.get('from_prediction'):
                if sp not in ai_accuracy:
                    ai_accuracy[sp] = {'correct': 0, 'total': 0}
                ai_accuracy[sp]['total'] += 1
                if ann.get('original_species', '') == sp:
                    ai_accuracy[sp]['correct'] += 1

    # Build response
    if total_images == 0 or (total_detections == 0 and empty_count == 0 and unannotated_count == 0):
        return Response('Ei havaintoja valitulla aikavälillä.', mimetype='text/plain')

    if species_filter and total_detections == 0:
        filtered_names = ', '.join(SPECIES_LABELS.get(s, s) for s in species_filter)
        return Response(f'Ei havaintoja: {filtered_names}.', mimetype='text/plain')

    lines = []
    period_start = range_start.strftime('%Y-%m-%d')
    period_end = (range_end - timedelta(days=1)).strftime('%Y-%m-%d')
    lines.append(f'Riistakamera {days}pv ({period_start} – {period_end})')
    lines.append(
        f'Kuvia: {total_images} | Havaintoja: {total_detections} | Tyhjiä: {empty_count}'
    )

    # Species sorted by count descending
    sorted_species = sorted(species_counts.items(), key=lambda x: x[1], reverse=True)
    species_str = ', '.join(f'{name} {count}' for name, count in sorted_species)
    lines.append(f'Lajit: {species_str}')

    # Daily breakdown — always included
    # Generate all dates in range so days with 0 also show
    day_parts = []
    d = range_start
    end_date = range_end - timedelta(days=1)
    while d <= end_date:
        ds = d.strftime('%Y-%m-%d')
        weekday = _FI_WEEKDAYS[d.weekday()]
        count = daily_counts.get(ds, 0)
        date_short = d.strftime('%d.%m')
        if count > 0 and daily_species.get(ds):
            # Show top species for this day
            top = sorted(daily_species[ds].items(), key=lambda x: x[1], reverse=True)
            sp_brief = '+'.join(f'{n[:3]}{c}' for n, c in top[:3])
            day_parts.append(f'{weekday} {date_short}:{count} ({sp_brief})')
        else:
            day_parts.append(f'{weekday} {date_short}:0')
        d += timedelta(days=1)
    lines.append(f'Päivät: {", ".join(day_parts)}')

    # Hourly activity — always included, compact format with only active hours
    active_hours = sorted((h, c) for h, c in hourly_totals.items() if c > 0)
    if active_hours:
        hour_parts = [f'{h:02d}:{c}' for h, c in active_hours]
        lines.append(f'Aktiiviset tunnit: {" ".join(hour_parts)}')

    if detail == 'full':
        # Full 24h hourly breakdown
        all_hours = [f'{h:02d}:{hourly_totals.get(h, 0)}' for h in range(24)]
        lines.append(f'Tunnit 00-23: {" ".join(all_hours)}')

        # AI accuracy per species
        if ai_accuracy:
            acc_parts = []
            for sp, acc in ai_accuracy.items():
                label = SPECIES_LABELS.get(sp, sp).lower()
                if acc['total'] > 0:
                    pct = round(100 * acc['correct'] / acc['total'])
                    acc_parts.append(f'{label} {pct}% ({acc["correct"]}/{acc["total"]})')
            if acc_parts:
                lines.append(f'AI-tarkkuus: {", ".join(acc_parts)}')

    text = '\n'.join(lines) + '\n'
    return Response(text, mimetype='text/plain')


THUMBNAIL_DIR = DATA_DIR / 'thumbnails'


@app.route('/api/thumbnail/<path:filename>')
def get_thumbnail(filename):
    """Serve 300px-wide thumbnail, generate and cache if needed."""
    THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)
    thumb_path = THUMBNAIL_DIR / filename
    if not thumb_path.exists():
        src_path = IMAGE_DIR / filename
        if not src_path.exists():
            return jsonify({'error': 'Image not found'}), 404
        try:
            with Image.open(src_path) as img:
                img.thumbnail((300, 300))
                img.save(thumb_path, 'JPEG', quality=80)
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    return send_from_directory(THUMBNAIL_DIR, filename)


@app.route('/api/status')
def get_status():
    """Palvelun tila."""
    model_path = DATA_DIR / 'models' / 'species_latest.pt'
    speciesnet_available = False
    try:
        import speciesnet
        speciesnet_available = True
    except ImportError:
        pass
    return jsonify({
        'status': 'ok',
        'image_dir': str(IMAGE_DIR),
        'annotation_dir': str(ANNOTATION_DIR),
        'prediction_dir': str(PREDICTION_DIR),
        'has_species_model': model_path.exists() or speciesnet_available,
        'has_speciesnet': speciesnet_available,
        'species_model_path': str(model_path) if model_path.exists() else None,
    })


if __name__ == '__main__':
    ensure_dirs()
    print(f"Riistakamera Annotator")
    print(f"Image directory: {IMAGE_DIR}")
    print(f"Annotation directory: {ANNOTATION_DIR}")
    print(f"Starting server at http://localhost:5000")

    image_count = len(get_image_files())
    print(f"Found {image_count} images")

    app.run(debug=True, host='0.0.0.0', port=5000)
