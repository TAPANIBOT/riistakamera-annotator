#!/usr/bin/env python3
"""
Active learning: priorisoi annotaatiot epävarmuuden mukaan.
Matalimman luottamuksen kuvat ensin → suurin hyöty koulutukselle.
"""
import json
import os
from pathlib import Path

DATA_DIR = Path(os.environ.get('DATA_DIR', '/data'))
PREDICTION_DIR = DATA_DIR / 'predictions'
ANNOTATION_DIR = DATA_DIR / 'annotations'
IMAGE_DIR = DATA_DIR / 'images' / 'incoming'


def get_uncertainty_ranking(limit=50):
    """
    Järjestä kuvat epävarmuuden mukaan (matalin ensin).

    Strategia:
    - Kuvat joilla on ennusteita MUTTA ei annotaatioita → annotoitavia
    - Järjestetään ennusteen maksimiluottamuksen mukaan (matalin ensin)
    - Kuvat ilman ennusteitakaan → toissijainen prioriteetti

    Returns:
        list: [{image, max_confidence, predictions_count, reason}]
    """
    if not PREDICTION_DIR.exists():
        return []

    candidates = []

    for pred_file in sorted(PREDICTION_DIR.glob('*.json')):
        stem = pred_file.stem

        # Ohita jo annotoidut ja tyhjäksi merkityt
        ann_path = ANNOTATION_DIR / f"{stem}.json"
        if ann_path.exists():
            with open(ann_path, 'r') as f:
                ann_data = json.load(f)
            if ann_data.get('annotations') or ann_data.get('is_empty', False):
                continue

        # Lue ennusteet
        with open(pred_file, 'r') as f:
            pred_data = json.load(f)

        predictions = pred_data.get('predictions', [])
        if not predictions:
            continue

        # Laske epävarmuusmetriikat
        confidences = []
        for p in predictions:
            if p.get('species_confidence') is not None:
                confidences.append(p['species_confidence'])
            elif p.get('md_confidence') is not None:
                confidences.append(p['md_confidence'])

        if confidences:
            max_conf = max(confidences)
            min_conf = min(confidences)
            avg_conf = sum(confidences) / len(confidences)
        else:
            max_conf = 0
            min_conf = 0
            avg_conf = 0

        # Etsi vastaava kuva
        image_name = pred_data.get('image', '')
        image_path = IMAGE_DIR / image_name
        if not image_path.exists():
            continue

        # Prioriteetti: matala luottamus = arvokkaampi annotaatio
        reason = 'low_confidence'
        if max_conf < 0.3:
            reason = 'very_uncertain'
        elif max_conf < 0.6:
            reason = 'uncertain'
        elif max_conf < 0.8:
            reason = 'moderate'
        else:
            reason = 'confident'

        candidates.append({
            'image': image_name,
            'max_confidence': round(max_conf, 4),
            'min_confidence': round(min_conf, 4),
            'avg_confidence': round(avg_conf, 4),
            'predictions_count': len(predictions),
            'reason': reason,
        })

    # Järjestä epävarmuuden mukaan (matalin luottamus ensin)
    candidates.sort(key=lambda x: x['max_confidence'])

    return candidates[:limit]


def get_annotation_stats():
    """Hae annotaatiotilastot koulutuksen seurantaan."""
    stats = {
        'total_images': 0,
        'annotated_images': 0,
        'empty_images': 0,
        'predicted_images': 0,
        'unannotated_with_predictions': 0,
        'species_distribution': {},
    }

    # Laske kuvat
    if IMAGE_DIR.exists():
        image_exts = {'.jpg', '.jpeg', '.png', '.bmp', '.gif'}
        stats['total_images'] = sum(
            1 for f in IMAGE_DIR.iterdir()
            if f.suffix.lower() in image_exts
        )

    # Laske annotaatiot
    if ANNOTATION_DIR.exists():
        for f in ANNOTATION_DIR.glob('*.json'):
            with open(f, 'r') as fh:
                data = json.load(fh)
            if data.get('is_empty', False):
                stats['empty_images'] += 1
                continue
            anns = data.get('annotations', [])
            if anns:
                stats['annotated_images'] += 1
                for ann in anns:
                    sp = ann.get('species', 'muu')
                    stats['species_distribution'][sp] = \
                        stats['species_distribution'].get(sp, 0) + 1

    # Laske ennusteet
    if PREDICTION_DIR.exists():
        for f in PREDICTION_DIR.glob('*.json'):
            stats['predicted_images'] += 1
            stem = f.stem
            ann_path = ANNOTATION_DIR / f"{stem}.json"
            if not ann_path.exists():
                stats['unannotated_with_predictions'] += 1

    return stats


if __name__ == '__main__':
    print("=== Active Learning Ranking ===")
    ranking = get_uncertainty_ranking()
    for i, item in enumerate(ranking[:20], 1):
        print(f"{i:3d}. {item['image']:<40s} "
              f"conf={item['max_confidence']:.2f} "
              f"({item['reason']}, {item['predictions_count']} det)")

    print("\n=== Annotaatiotilastot ===")
    stats = get_annotation_stats()
    print(json.dumps(stats, indent=2, ensure_ascii=False))
