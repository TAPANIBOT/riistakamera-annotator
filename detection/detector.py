#!/usr/bin/env python3
"""
Eläintunnistus: MegaDetector v5A + YOLO-lajimalli.

Kaksivaihemalli:
1. MegaDetector: Havaitsee eläimen/ihmisen/ajoneuvon ja piirtää bounding boxin
2. YOLO-lajimalli: Rajattu kuva-alue → lajitunnistus (kauris, peura, jne.)
"""
import json
import os
from pathlib import Path

# MegaDetector-kategoriat
MD_CATEGORIES = {
    '1': 'animal',
    '2': 'person',
    '3': 'vehicle',
}

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


class WildlifeDetector:
    """
    Kaksivaihemalli riistakamerakuvien tunnistukseen.

    - MegaDetector v5A: bbox-tunnistus (aina saatavilla)
    - YOLO-lajimalli: lajitunnistus (valinnainen, paranee koulutuksella)
    """

    def __init__(self, megadetector_model=None, species_model_path=None, confidence_threshold=0.2):
        self.confidence_threshold = confidence_threshold
        self.md_model = None
        self.species_model = None

        # Lataa MegaDetector
        if megadetector_model:
            self._load_megadetector(megadetector_model)

        # Lataa lajimalli (valinnainen)
        if species_model_path and Path(species_model_path).exists():
            self._load_species_model(species_model_path)

    def _load_megadetector(self, model_path):
        """Lataa MegaDetector-malli (v10.0.17+ API)."""
        try:
            from megadetector.detection.run_detector import load_detector
            self.md_model = load_detector(model_path, force_cpu=True)
        except Exception as e:
            raise RuntimeError(f"MegaDetector-lataus epäonnistui: {e}")

    def _load_species_model(self, model_path):
        """Lataa YOLO-lajimalli."""
        try:
            from ultralytics import YOLO
            self.species_model = YOLO(model_path)
        except Exception as e:
            print(f"Lajimallin lataus epäonnistui: {e}")

    def detect(self, image_path, confidence_threshold=None):
        """
        Tunnista eläimet kuvasta.

        Args:
            image_path: Kuvan polku
            confidence_threshold: Luottamuskynnys (oletus: self.confidence_threshold)

        Returns:
            dict: {
                'image': kuvatiedoston nimi,
                'predictions': [{
                    'bbox': [x1, y1, x2, y2],  # pikselit
                    'md_category': 'animal'|'person'|'vehicle',
                    'md_confidence': float,
                    'species': str|None,
                    'species_confidence': float|None,
                }]
            }
        """
        if confidence_threshold is None:
            confidence_threshold = self.confidence_threshold

        image_path = Path(image_path)
        predictions = []

        if self.md_model is None:
            return {
                'image': image_path.name,
                'predictions': [],
                'error': 'MegaDetector not loaded',
            }

        # Vaihe 1: MegaDetector bbox-tunnistus
        md_results = self._run_megadetector(str(image_path), confidence_threshold)

        from PIL import Image as PILImage
        with PILImage.open(image_path) as pil_img:
            img_w, img_h = pil_img.size

        for det in md_results:
            md_bbox_rel = det['bbox']  # [x, y, w, h] normalisoitu
            md_conf = det['conf']
            md_cat = det['category']
            md_cat_name = MD_CATEGORIES.get(md_cat, 'unknown')

            # Muunna [x, y, w, h] (normalisoitu) → [x1, y1, x2, y2] (pikselit)
            x1 = int(md_bbox_rel[0] * img_w)
            y1 = int(md_bbox_rel[1] * img_h)
            x2 = int((md_bbox_rel[0] + md_bbox_rel[2]) * img_w)
            y2 = int((md_bbox_rel[1] + md_bbox_rel[3]) * img_h)

            prediction = {
                'bbox': [x1, y1, x2, y2],
                'md_category': md_cat_name,
                'md_confidence': round(md_conf, 4),
                'species': None,
                'species_confidence': None,
            }

            # Ihminen tunnistetaan suoraan MegaDetectorilla
            if md_cat == '2':
                prediction['species'] = 'ihminen'
                prediction['species_confidence'] = round(md_conf, 4)

            # Vaihe 2: Lajitunnistus (jos malli ja eläin)
            elif md_cat == '1' and self.species_model is not None:
                species_result = self._classify_species(
                    image_path, [x1, y1, x2, y2]
                )
                if species_result:
                    prediction['species'] = species_result['species']
                    prediction['species_confidence'] = species_result['confidence']

            predictions.append(prediction)

        return {
            'image': image_path.name,
            'predictions': predictions,
        }

    def _run_megadetector(self, image_path, confidence_threshold):
        """Aja MegaDetector-tunnistus (v10.0.17+ API)."""
        from PIL import Image as PILImage
        import numpy as np

        pil_img = PILImage.open(image_path)
        result = self.md_model.generate_detections_one_image(
            np.array(pil_img),
            image_id=image_path,
            detection_threshold=confidence_threshold,
        )
        return [
            {
                'bbox': d['bbox'],      # [x, y, w, h] normalisoitu
                'conf': d['conf'],
                'category': d['category'],
            }
            for d in result.get('detections', [])
        ]

    def _classify_species(self, image_path, bbox):
        """
        Tunnista laji rajatusta kuva-alueesta.

        Args:
            image_path: Kuvan polku
            bbox: [x1, y1, x2, y2] pikseleinä

        Returns:
            dict: {'species': str, 'confidence': float} tai None
        """
        try:
            from PIL import Image as PILImage

            with PILImage.open(image_path) as img:
                # Rajaa bbox-alue pienellä marginaalilla
                x1, y1, x2, y2 = bbox
                margin = int(max(x2 - x1, y2 - y1) * 0.1)
                x1 = max(0, x1 - margin)
                y1 = max(0, y1 - margin)
                x2 = min(img.width, x2 + margin)
                y2 = min(img.height, y2 + margin)

                crop = img.crop((x1, y1, x2, y2))

            # Aja lajimalli
            results = self.species_model(crop, verbose=False)

            if results and len(results) > 0:
                r = results[0]
                if hasattr(r, 'probs') and r.probs is not None:
                    # Classification-malli
                    top1_idx = int(r.probs.top1)
                    top1_conf = float(r.probs.top1conf)
                    species = CLASS_MAP.get(top1_idx, 'muu')
                    return {'species': species, 'confidence': round(top1_conf, 4)}
                elif hasattr(r, 'boxes') and len(r.boxes) > 0:
                    # Detection-malli
                    box = r.boxes[0]
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    species = CLASS_MAP.get(cls_id, 'muu')
                    return {'species': species, 'confidence': round(conf, 4)}

        except Exception as e:
            print(f"Lajitunnistusvirhe: {e}")

        return None
