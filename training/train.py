#!/usr/bin/env python3
"""
YOLO-lajimallin koulutus riistakameradatalla.
Ajetaan Mac Minin hostissa (Apple Silicon MPS).
"""
import json
import os
import shutil
from datetime import datetime
from pathlib import Path

DATA_DIR = Path(os.environ.get('DATA_DIR', '/data'))
MODEL_DIR = DATA_DIR / 'models'
DATASET_DIR = DATA_DIR / 'dataset'
HISTORY_FILE = DATA_DIR / 'training_history.json'


def get_training_history():
    """Lataa koulutushistoria."""
    if HISTORY_FILE.exists():
        with open(HISTORY_FILE, 'r') as f:
            return json.load(f)
    return {'runs': [], 'last_annotation_count': 0}


def save_training_history(history):
    """Tallenna koulutushistoria."""
    with open(HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=2)


def count_annotations():
    """Laske annotaatioiden kokonaismäärä."""
    ann_dir = DATA_DIR / 'annotations'
    if not ann_dir.exists():
        return 0
    count = 0
    for f in ann_dir.glob('*.json'):
        with open(f, 'r') as fh:
            data = json.load(fh)
        count += len(data.get('annotations', []))
    return count


def should_retrain(min_new_annotations=50):
    """Tarkista tarvitaanko uudelleenkoulutusta."""
    history = get_training_history()
    current_count = count_annotations()
    last_count = history.get('last_annotation_count', 0)
    return current_count - last_count >= min_new_annotations


def train_species_model(
    dataset_yaml=None,
    base_model='yolo11n-cls.pt',
    epochs=100,
    imgsz=640,
    batch=8,
    device='mps',
    patience=20,
    project=None,
    name=None,
):
    """
    Kouluta YOLO-lajimalli.

    Args:
        dataset_yaml: dataset.yaml polku
        base_model: Pohjamalli (yolo11n-cls.pt, yolo11n.pt, yolo11s.pt)
        epochs: Koulutusepookit
        imgsz: Kuvan koko
        batch: Eräkoko
        device: Laite ('mps' Apple Siliconille, 'cpu' Dockerille)
        patience: Early stopping epookit
        project: Tuloshakemisto
        name: Koulutuksen nimi

    Returns:
        dict: Koulutuksen tulokset
    """
    from ultralytics import YOLO

    if dataset_yaml is None:
        dataset_yaml = str(DATASET_DIR / 'dataset.yaml')

    if not Path(dataset_yaml).exists():
        return {'success': False, 'error': f'dataset.yaml not found: {dataset_yaml}'}

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    if project is None:
        project = str(MODEL_DIR)
    if name is None:
        name = f'species_{timestamp}'

    model = YOLO(base_model)

    results = model.train(
        data=dataset_yaml,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=device,
        patience=patience,
        project=project,
        name=name,
        exist_ok=True,
        verbose=True,
    )

    # Kopioi paras malli species_latest.pt:ksi
    best_model = Path(project) / name / 'weights' / 'best.pt'
    latest_link = MODEL_DIR / 'species_latest.pt'

    if best_model.exists():
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best_model, latest_link)

    # Päivitä koulutushistoria
    history = get_training_history()
    ann_count = count_annotations()

    run_info = {
        'timestamp': timestamp,
        'base_model': base_model,
        'epochs': epochs,
        'annotation_count': ann_count,
        'model_path': str(best_model) if best_model.exists() else None,
    }

    # Lisää metriikat jos saatavilla
    if hasattr(results, 'results_dict'):
        run_info['metrics'] = {
            k: round(float(v), 4) if isinstance(v, (int, float)) else str(v)
            for k, v in results.results_dict.items()
        }

    history['runs'].append(run_info)
    history['last_annotation_count'] = ann_count
    save_training_history(history)

    return {
        'success': True,
        'model_path': str(latest_link),
        'training_dir': str(Path(project) / name),
        'run_info': run_info,
    }


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Kouluta YOLO-lajimalli')
    parser.add_argument('--dataset', default=None, help='dataset.yaml polku')
    parser.add_argument('--base-model', default='yolo11n-cls.pt', help='Pohjamalli')
    parser.add_argument('--epochs', type=int, default=100)
    parser.add_argument('--imgsz', type=int, default=640)
    parser.add_argument('--batch', type=int, default=8)
    parser.add_argument('--device', default='mps', help='mps (Mac), cpu, cuda')
    parser.add_argument('--patience', type=int, default=20)
    args = parser.parse_args()

    print("Aloitetaan koulutus...")
    result = train_species_model(
        dataset_yaml=args.dataset,
        base_model=args.base_model,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        patience=args.patience,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
