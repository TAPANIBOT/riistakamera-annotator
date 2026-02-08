#!/usr/bin/env python3
"""
Mallin arviointi: mAP, per-laji metriikat, confusion matrix.
"""
import json
import os
from pathlib import Path

DATA_DIR = Path(os.environ.get('DATA_DIR', '/data'))
MODEL_DIR = DATA_DIR / 'models'
DATASET_DIR = DATA_DIR / 'dataset'


def evaluate_model(model_path=None, dataset_yaml=None, device='mps'):
    """
    Arvioi YOLO-malli validointidatalla.

    Args:
        model_path: Mallin polku (oletus: species_latest.pt)
        dataset_yaml: dataset.yaml polku
        device: Laite

    Returns:
        dict: Arviointitulokset
    """
    from ultralytics import YOLO

    if model_path is None:
        model_path = str(MODEL_DIR / 'species_latest.pt')
    if dataset_yaml is None:
        dataset_yaml = str(DATASET_DIR / 'dataset.yaml')

    if not Path(model_path).exists():
        return {'success': False, 'error': f'Mallia ei löydy: {model_path}'}
    if not Path(dataset_yaml).exists():
        return {'success': False, 'error': f'dataset.yaml ei löydy: {dataset_yaml}'}

    model = YOLO(model_path)
    results = model.val(
        data=dataset_yaml,
        device=device,
        verbose=True,
    )

    metrics = {}
    if hasattr(results, 'results_dict'):
        metrics = {
            k: round(float(v), 4) if isinstance(v, (int, float)) else str(v)
            for k, v in results.results_dict.items()
        }

    # Per-laji metriikat
    class_map = {
        0: 'kauris', 1: 'peura', 2: 'janis', 3: 'linnut',
        4: 'supikoira', 5: 'kettu', 6: 'ihminen', 7: 'koira', 8: 'muu',
    }

    per_class = {}
    if hasattr(results, 'box') and hasattr(results.box, 'ap_class_index'):
        for i, cls_idx in enumerate(results.box.ap_class_index):
            cls_name = class_map.get(int(cls_idx), f'class_{cls_idx}')
            per_class[cls_name] = {
                'ap50': round(float(results.box.ap50[i]), 4),
            }

    return {
        'success': True,
        'model_path': model_path,
        'metrics': metrics,
        'per_class': per_class,
    }


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Arvioi YOLO-malli')
    parser.add_argument('--model', default=None, help='Mallin polku')
    parser.add_argument('--dataset', default=None, help='dataset.yaml polku')
    parser.add_argument('--device', default='mps')
    args = parser.parse_args()

    print("Arvioidaan malli...")
    result = evaluate_model(
        model_path=args.model,
        dataset_yaml=args.dataset,
        device=args.device,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
