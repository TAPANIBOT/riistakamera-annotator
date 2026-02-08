"""Flask test client fixture for API tests."""
import json
import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def test_data_dir(tmp_path):
    """Create a temporary data directory with sample images and annotations."""
    img_dir = tmp_path / 'images' / 'incoming'
    ann_dir = tmp_path / 'annotations'
    pred_dir = tmp_path / 'predictions'
    img_dir.mkdir(parents=True)
    ann_dir.mkdir(parents=True)
    pred_dir.mkdir(parents=True)

    # Create minimal JPEG files (1x1 pixel)
    import struct
    def make_tiny_jpeg(path):
        # Minimal valid JPEG: SOI + APP0 + DQT + SOF0 + DHT + SOS + data + EOI
        # For simplicity, create a white 1x1 BMP and convert via Pillow
        from PIL import Image as PILImage
        img = PILImage.new('RGB', (4, 4), (128, 128, 128))
        img.save(str(path), 'JPEG')

    # 3 images with date-based filenames
    filenames = [
        '15339_25173_20260128_072622867.jpg',  # Jan 28, 07:26
        '15339_25173_20260128_143015000.jpg',  # Jan 28, 14:30
        '15339_25173_20260129_061200000.jpg',  # Jan 29, 06:12
    ]
    for fn in filenames:
        make_tiny_jpeg(img_dir / fn)

    # Annotations for first two images
    ann1 = {
        'image_name': filenames[0],
        'annotations': [{
            'bbox': [100, 100, 200, 200],
            'species': 'janis',
            'md_confidence': 0.95,
            'species_confidence': 0.82,
            'from_prediction': True,
            'original_species': 'janis',
            'timestamp': '2026-01-28T07:26:22Z',
        }],
        'is_empty': False,
    }
    (ann_dir / filenames[0].replace('.jpg', '.json')).write_text(
        json.dumps(ann1, ensure_ascii=False), encoding='utf-8'
    )

    ann2 = {
        'image_name': filenames[1],
        'annotations': [
            {
                'bbox': [50, 50, 300, 300],
                'species': 'kauris',
                'md_confidence': 0.88,
                'species_confidence': 0.75,
                'from_prediction': True,
                'original_species': 'peura',
                'timestamp': '2026-01-28T14:30:15Z',
            },
            {
                'bbox': [400, 200, 600, 500],
                'species': 'linnut',
                'md_confidence': 0.60,
                'species_confidence': 0.55,
                'from_prediction': True,
                'original_species': 'linnut',
                'timestamp': '2026-01-28T14:30:15Z',
            },
        ],
        'is_empty': False,
    }
    (ann_dir / filenames[1].replace('.jpg', '.json')).write_text(
        json.dumps(ann2, ensure_ascii=False), encoding='utf-8'
    )

    # Third image: empty
    ann3 = {
        'image_name': filenames[2],
        'is_empty': True,
        'annotations': [],
    }
    (ann_dir / filenames[2].replace('.jpg', '.json')).write_text(
        json.dumps(ann3, ensure_ascii=False), encoding='utf-8'
    )

    return tmp_path


@pytest.fixture
def client(test_data_dir):
    """Create Flask test client with temporary data directory."""
    os.environ['DATA_DIR'] = str(test_data_dir)
    os.environ['IMAGE_DIR'] = str(test_data_dir / 'images' / 'incoming')
    os.environ['ANNOTATION_DIR'] = str(test_data_dir / 'annotations')
    os.environ['PREDICTION_DIR'] = str(test_data_dir / 'predictions')

    # Need to reimport to pick up new env vars
    import importlib
    import sys
    # Remove cached module so env vars take effect
    if 'app' in sys.modules:
        del sys.modules['app']

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    import app as flask_app

    # Override paths directly
    flask_app.DATA_DIR = test_data_dir
    flask_app.IMAGE_DIR = test_data_dir / 'images' / 'incoming'
    flask_app.ANNOTATION_DIR = test_data_dir / 'annotations'
    flask_app.PREDICTION_DIR = test_data_dir / 'predictions'
    flask_app.THUMBNAIL_DIR = test_data_dir / 'thumbnails'

    flask_app.app.config['TESTING'] = True
    with flask_app.app.test_client() as c:
        yield c
