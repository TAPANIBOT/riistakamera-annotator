#!/usr/bin/env python3
"""
Eräajo: tunnista eläimet kaikista uusista kuvista.
Tallentaa ennusteet /data/predictions/-hakemistoon.
"""
import json
import os
from pathlib import Path

DATA_DIR = Path(os.environ.get('DATA_DIR', '/data'))
IMAGE_DIR = DATA_DIR / 'images' / 'incoming'
PREDICTION_DIR = DATA_DIR / 'predictions'
MODEL_DIR = DATA_DIR / 'models'

MEGADETECTOR_MODEL = os.environ.get('MEGADETECTOR_MODEL', 'MDV5A')
SPECIES_MODEL = str(MODEL_DIR / 'species_latest.pt')

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.gif'}


def detect_new_images(force=False):
    """
    Aja tunnistus kuville joilla ei vielä ole ennusteita.

    Args:
        force: Jos True, aja uudelleen myös jo ennustetuille kuville

    Returns:
        dict: Tilastot
    """
    PREDICTION_DIR.mkdir(parents=True, exist_ok=True)

    if not IMAGE_DIR.exists():
        return {'processed': 0, 'error': 'Image directory not found'}

    # Etsi kuvat joilta puuttuu ennuste
    images_to_process = []
    for f in sorted(IMAGE_DIR.iterdir()):
        if f.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        pred_path = PREDICTION_DIR / f"{f.stem}.json"
        if not force and pred_path.exists():
            continue
        images_to_process.append(f)

    if not images_to_process:
        return {'processed': 0, 'message': 'Ei uusia kuvia tunnistettavaksi'}

    # Lataa detector
    from detection.detector import WildlifeDetector

    species_model = SPECIES_MODEL if Path(SPECIES_MODEL).exists() else None
    megadetector = MEGADETECTOR_MODEL

    detector = WildlifeDetector(
        megadetector_model=megadetector,
        species_model_path=species_model,
    )

    results = {
        'processed': 0,
        'detections': 0,
        'errors': [],
    }

    for img_path in images_to_process:
        try:
            result = detector.detect(str(img_path))

            # Tallenna ennuste
            pred_path = PREDICTION_DIR / f"{img_path.stem}.json"
            with open(pred_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)

            results['processed'] += 1
            results['detections'] += len(result.get('predictions', []))

        except Exception as e:
            results['errors'].append(f"{img_path.name}: {e}")

    return results


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Tunnista eläimet uusista kuvista')
    parser.add_argument('--force', action='store_true', help='Aja uudelleen kaikille kuville')
    args = parser.parse_args()

    print("Ajetaan eläintunnistus...")
    result = detect_new_images(force=args.force)
    print(json.dumps(result, indent=2, ensure_ascii=False))
