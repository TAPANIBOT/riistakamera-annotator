#!/usr/bin/env python3
"""
YOLO-formaatin eksportti annotaatioista.
Konvertoi JSON-annotaatiot → YOLO txt-tiedostot + dataset.yaml.
"""
import json
import os
import random
import shutil
from pathlib import Path

DEFAULT_CLASS_MAP = {
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

DEFAULT_SPECIES_TO_ID = {v: k for k, v in DEFAULT_CLASS_MAP.items()}


def bbox_to_yolo(bbox, img_width, img_height):
    """
    Muunna [x1, y1, x2, y2] (pikselit) → [x_center, y_center, w, h] (normalisoitu 0-1).
    """
    x1, y1, x2, y2 = bbox
    x_center = (x1 + x2) / 2.0 / img_width
    y_center = (y1 + y2) / 2.0 / img_height
    w = (x2 - x1) / img_width
    h = (y2 - y1) / img_height

    # Clamp to [0, 1]
    x_center = max(0.0, min(1.0, x_center))
    y_center = max(0.0, min(1.0, y_center))
    w = max(0.0, min(1.0, w))
    h = max(0.0, min(1.0, h))

    return x_center, y_center, w, h


def export_dataset(
    annotation_dir,
    image_dir,
    output_dir,
    class_map=None,
    species_to_id=None,
    val_split=0.2,
    seed=42,
):
    """
    Eksportoi annotaatiot YOLO-formaattiin.

    Args:
        annotation_dir: Hakemisto jossa JSON-annotaatiot
        image_dir: Hakemisto jossa kuvat
        output_dir: Tulostettu dataset-hakemisto
        class_map: {id: species_name}
        species_to_id: {species_name: id}
        val_split: Validointijoukon osuus (0.0-1.0)
        seed: Random seed toistettavuuteen

    Returns:
        dict: Tilastot eksportista
    """
    if class_map is None:
        class_map = DEFAULT_CLASS_MAP
    if species_to_id is None:
        species_to_id = DEFAULT_SPECIES_TO_ID

    annotation_dir = Path(annotation_dir)
    image_dir = Path(image_dir)
    output_dir = Path(output_dir)

    # Luo hakemistorakenne
    for split in ['train', 'val']:
        (output_dir / 'images' / split).mkdir(parents=True, exist_ok=True)
        (output_dir / 'labels' / split).mkdir(parents=True, exist_ok=True)

    # Kerää annotoidut ja tyhjät kuvat
    image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.gif'}
    annotated_images = []
    background_images = []

    for ann_file in sorted(annotation_dir.glob('*.json')):
        with open(ann_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Etsi vastaava kuva
        stem = ann_file.stem
        img_path = None
        for ext in image_extensions:
            candidate = image_dir / f"{stem}{ext}"
            if candidate.exists():
                img_path = candidate
                break

        if img_path is None:
            continue

        # Tyhjäksi merkityt → taustadata
        if data.get('is_empty', False):
            background_images.append({
                'image_path': img_path,
                'stem': stem,
            })
            continue

        annotations = data.get('annotations', [])
        if not annotations:
            continue

        annotated_images.append({
            'image_path': img_path,
            'annotations': annotations,
            'stem': stem,
        })

    if not annotated_images and not background_images:
        return {
            'success': False,
            'error': 'Ei annotaatioita eksportoitavaksi',
            'total': 0,
        }

    # Jaa train/val
    random.seed(seed)
    random.shuffle(annotated_images)
    random.shuffle(background_images)

    val_count = max(1, int(len(annotated_images) * val_split)) if annotated_images else 0
    val_set = annotated_images[:val_count]
    train_set = annotated_images[val_count:]

    bg_val_count = max(1, int(len(background_images) * val_split)) if background_images else 0
    bg_val_set = background_images[:bg_val_count]
    bg_train_set = background_images[bg_val_count:]

    stats = {
        'total': len(annotated_images),
        'train': len(train_set),
        'val': len(val_set),
        'background_images': len(background_images),
        'bg_train': len(bg_train_set),
        'bg_val': len(bg_val_set),
        'annotations_total': 0,
        'species_counts': {},
        'skipped_unknown': 0,
    }

    # Prosessoi annotoidut kuvat
    for split_name, split_data in [('train', train_set), ('val', val_set)]:
        for item in split_data:
            img_path = item['image_path']
            stem = item['stem']

            # Hae kuvan dimensiot
            from PIL import Image
            with Image.open(img_path) as pil_img:
                img_w, img_h = pil_img.size

            # Kopioi kuva
            dst_img = output_dir / 'images' / split_name / img_path.name
            shutil.copy2(img_path, dst_img)

            # Kirjoita label-tiedosto
            label_lines = []
            for ann in item['annotations']:
                species = ann.get('species', '')
                if species not in species_to_id:
                    stats['skipped_unknown'] += 1
                    continue

                class_id = species_to_id[species]
                bbox = ann.get('bbox', [])
                if len(bbox) != 4:
                    continue

                xc, yc, w, h = bbox_to_yolo(bbox, img_w, img_h)
                label_lines.append(f"{class_id} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")

                stats['annotations_total'] += 1
                stats['species_counts'][species] = stats['species_counts'].get(species, 0) + 1

            label_path = output_dir / 'labels' / split_name / f"{stem}.txt"
            with open(label_path, 'w') as f:
                f.write('\n'.join(label_lines) + '\n' if label_lines else '')

    # Prosessoi taustakuvat (tyhjä label-tiedosto = YOLO background)
    for split_name, split_data in [('train', bg_train_set), ('val', bg_val_set)]:
        for item in split_data:
            img_path = item['image_path']
            stem = item['stem']

            dst_img = output_dir / 'images' / split_name / img_path.name
            shutil.copy2(img_path, dst_img)

            label_path = output_dir / 'labels' / split_name / f"{stem}.txt"
            with open(label_path, 'w') as f:
                f.write('')  # Tyhjä label = taustakuva

    # Kirjoita dataset.yaml
    yaml_content = f"""# Riistakamera Wildlife Dataset
# Generated automatically by export_yolo.py

path: {output_dir.resolve()}
train: images/train
val: images/val

nc: {len(class_map)}
names: {json.dumps(class_map)}
"""
    yaml_path = output_dir / 'dataset.yaml'
    with open(yaml_path, 'w') as f:
        f.write(yaml_content)

    stats['success'] = True
    stats['dataset_yaml'] = str(yaml_path)
    return stats


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Eksportoi annotaatiot YOLO-formaattiin')
    parser.add_argument('--annotation-dir', default='/data/annotations')
    parser.add_argument('--image-dir', default='/data/images/incoming')
    parser.add_argument('--output-dir', default='/data/dataset')
    parser.add_argument('--val-split', type=float, default=0.2)
    args = parser.parse_args()

    result = export_dataset(
        annotation_dir=args.annotation_dir,
        image_dir=args.image_dir,
        output_dir=args.output_dir,
        val_split=args.val_split,
    )

    print(json.dumps(result, indent=2, ensure_ascii=False))
