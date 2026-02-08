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

    total_images = len(images)
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
