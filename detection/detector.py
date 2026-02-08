#!/usr/bin/env python3
"""
Eläintunnistus: MegaDetector v5A + SpeciesNet/YOLO-lajimalli.

Kaksivaihemalli:
1. MegaDetector: Havaitsee eläimen/ihmisen/ajoneuvon ja piirtää bounding boxin
2. SpeciesNet: Rajattu kuva-alue → lajitunnistus (kauris, peura, jne.)
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

# SpeciesNet taksonomia → suomalaiset lajinimet
SPECIESNET_TO_FINNISH = {
    'capreolus capreolus': 'kauris',
    'odocoileus virginianus': 'peura',
    'lepus europaeus': 'janis',
    'lepus timidus': 'janis',
    'vulpes vulpes': 'kettu',
    'nyctereutes procyonoides': 'supikoira',
    'homo sapiens': 'ihminen',
    'canis familiaris': 'koira',
    'canis lupus familiaris': 'koira',
    'alces alces': 'muu',       # hirvi
    'sus scrofa': 'muu',        # villisika
    'lynx lynx': 'muu',         # ilves
    'meles meles': 'muu',       # mäyrä
    'mustela erminea': 'muu',   # kärppä
    'martes martes': 'muu',     # näätä
    'sciurus vulgaris': 'muu',  # orava
    'lutra lutra': 'muu',       # saukko
    'cervus elaphus': 'peura',  # saksanhirvi
    'dama dama': 'peura',       # kuusipeura
}


class WildlifeDetector:
    """
    Kaksivaihemalli riistakamerakuvien tunnistukseen.

    - MegaDetector v5A: bbox-tunnistus (aina saatavilla)
    - SpeciesNet: lajitunnistus (Google, 2000+ lajia, geofencing)
    - YOLO-lajimalli: vaihtoehtoinen lajitunnistus (custom-koulutettu)
    """

    def __init__(self, megadetector_model=None, species_model_path=None,
                 confidence_threshold=0.2, use_speciesnet=True):
        self.confidence_threshold = confidence_threshold
        self.md_model = None
        self.species_model = None
        self.speciesnet_classifier = None

        # Lataa MegaDetector
        if megadetector_model:
            self._load_megadetector(megadetector_model)

        # Lataa SpeciesNet (ensisijainen lajimalli)
        if use_speciesnet:
            self._load_speciesnet()

        # Lataa YOLO-lajimalli (vaihtoehtoinen/varasuunnitelma)
        if species_model_path and Path(species_model_path).exists():
            self._load_species_model(species_model_path)

    def _load_megadetector(self, model_path):
        """Lataa MegaDetector-malli (v10.0.17+ API)."""
        try:
            from megadetector.detection.run_detector import load_detector
            self.md_model = load_detector(model_path, force_cpu=True)
        except Exception as e:
            raise RuntimeError(f"MegaDetector-lataus epäonnistui: {e}")

    def _load_speciesnet(self):
        """Lataa SpeciesNet crop classifier lajintunnistukseen."""
        try:
            from speciesnet.classifier import SpeciesNetClassifier
            # Yritä ensin pysyvä polku (Docker volume)
            local_model = Path(os.environ.get('DATA_DIR', '/data')) / 'models' / 'speciesnet'
            if (local_model / 'always_crop_99710272_22x8_v12_epoch_00148.pt').exists():
                print(f"Ladataan SpeciesNet paikallisesta: {local_model}")
                self.speciesnet_classifier = SpeciesNetClassifier(
                    model_name=str(local_model),
                    device="cpu",
                )
            else:
                print("Ladataan SpeciesNet Kagglesta...")
                self.speciesnet_classifier = SpeciesNetClassifier(
                    model_name="kaggle:google/speciesnet/pyTorch/v4.0.2a/1",
                    device="cpu",
                )
            print("SpeciesNet ladattu.")
        except Exception as e:
            print(f"SpeciesNet-lataus epäonnistui: {e}")
            self.speciesnet_classifier = None

    def _load_species_model(self, model_path):
        """Lataa YOLO-lajimalli (vaihtoehtoinen)."""
        try:
            from ultralytics import YOLO
            self.species_model = YOLO(model_path)
        except Exception as e:
            print(f"YOLO-lajimallin lataus epäonnistui: {e}")

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

            # Vaihe 2: Lajitunnistus (SpeciesNet tai YOLO)
            elif md_cat == '1':
                species_result = None

                # Ensisijainen: SpeciesNet
                if self.speciesnet_classifier is not None:
                    species_result = self._classify_with_speciesnet(
                        image_path, [x1, y1, x2, y2]
                    )

                # Vaihtoehtoinen: YOLO custom -malli
                if species_result is None and self.species_model is not None:
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

    def _classify_with_speciesnet(self, image_path, bbox):
        """
        Tunnista laji SpeciesNet crop classifier -mallilla.

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
                # SpeciesNet odottaa 480x480 crop
                crop_resized = crop.resize((480, 480), PILImage.Resampling.LANCZOS)

            # Esikäsittele ja ennusta
            preprocessed = self.speciesnet_classifier.preprocess(crop_resized)
            result = self.speciesnet_classifier.predict(str(image_path), preprocessed)

            if result and 'classifications' in result:
                classes = result['classifications'].get('classes', [])
                scores = result['classifications'].get('scores', [])

                if classes and scores:
                    # SpeciesNet luokka: "uuid;class;order;family;genus;species;common"
                    top_raw = classes[0]
                    top_score = float(scores[0])

                    finnish_name = self._parse_speciesnet_class(top_raw)

                    # Jos top1 on matala, yritä aggregoida lajitason tuloksia
                    if finnish_name == 'muu' and len(classes) > 1:
                        # Yhdistä saman lajin tulokset
                        species_scores = {}
                        for cls_str, score in zip(classes[:5], scores[:5]):
                            name = self._parse_speciesnet_class(cls_str)
                            species_scores[name] = species_scores.get(name, 0) + float(score)
                        # Valitse paras (paitsi 'muu')
                        best = max(
                            ((n, s) for n, s in species_scores.items() if n != 'muu'),
                            key=lambda x: x[1],
                            default=None,
                        )
                        if best and best[1] > top_score:
                            finnish_name = best[0]
                            top_score = best[1]

                    if top_score >= 0.1:  # Matala kynnys riistakamerakuville
                        return {
                            'species': finnish_name,
                            'confidence': round(top_score, 4),
                            'speciesnet_class': top_raw,
                        }

        except Exception as e:
            print(f"SpeciesNet-tunnistusvirhe: {e}")

        return None

    @staticmethod
    def _parse_speciesnet_class(class_str):
        """Muunna SpeciesNet luokkastring suomalaiseksi lajinimeksi.

        SpeciesNet-muoto: "uuid;class;order;family;genus;species;common_name"
        Esim: "xxx;mammalia;lagomorpha;leporidae;lepus;europaeus;european hare"
        """
        parts = class_str.lower().split(';')
        # parts: [uuid, class, order, family, genus, species, common_name]

        genus = parts[4].strip() if len(parts) > 4 else ''
        species = parts[5].strip() if len(parts) > 5 else ''
        common = parts[6].strip() if len(parts) > 6 else ''
        order = parts[2].strip() if len(parts) > 2 else ''
        family = parts[3].strip() if len(parts) > 3 else ''

        # Yritä genus+species (taksonominen nimi)
        if genus and species:
            full_name = f'{genus} {species}'
            if full_name in SPECIESNET_TO_FINNISH:
                return SPECIESNET_TO_FINNISH[full_name]

        # Yritä englanninkielisellä nimellä
        common_to_finnish = {
            'roe deer': 'kauris',
            'white-tailed deer': 'peura',
            'european hare': 'janis',
            'mountain hare': 'janis',
            'red fox': 'kettu',
            'raccoon dog': 'supikoira',
            'human': 'ihminen',
            'domestic dog': 'koira',
            'dog': 'koira',
            'moose': 'muu',
            'wild boar': 'muu',
            'eurasian lynx': 'muu',
            'european badger': 'muu',
            'european rabbit': 'janis',
            'white-tailed jackrabbit': 'janis',
        }
        if common in common_to_finnish:
            return common_to_finnish[common]

        # Yritä suvun perusteella
        genus_map = {
            'capreolus': 'kauris',
            'odocoileus': 'peura',
            'lepus': 'janis',
            'oryctolagus': 'janis',
            'vulpes': 'kettu',
            'nyctereutes': 'supikoira',
            'homo': 'ihminen',
            'canis': 'koira',
        }
        if genus in genus_map:
            return genus_map[genus]

        # Yritä lahkon perusteella
        if order == 'lagomorpha':
            return 'janis'
        if order in ('passeriformes', 'anseriformes', 'galliformes',
                     'accipitriformes', 'strigiformes', 'charadriiformes'):
            return 'linnut'
        if 'bird' in common or 'aves' in parts[1] if len(parts) > 1 else False:
            return 'linnut'

        # Rodentia → 'muu' (ei erillinen luokka)
        return 'muu'

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
