#!/usr/bin/env python3
"""
Riistakamera Annotator - Flask backend
Kuvien lataus, annotaatioiden tallennus
"""
import os
import json
from pathlib import Path
from flask import Flask, render_template, jsonify, request, send_from_directory
from PIL import Image

app = Flask(__name__)

# Kuvakansio (voi muuttaa tarvittaessa)
IMAGE_DIR = Path.home() / "clawd" / "riistakamera"
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.gif'}

def get_image_files():
    """Hae kaikki kuvat kansiosta."""
    if not IMAGE_DIR.exists():
        IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        return []
    
    images = []
    for f in sorted(IMAGE_DIR.iterdir()):
        if f.suffix.lower() in ALLOWED_EXTENSIONS:
            images.append(f.name)
    return images

def get_annotation_path(image_name):
    """Palauta annotaatiotiedoston polku."""
    base_name = Path(image_name).stem
    return IMAGE_DIR / f"{base_name}.json"

@app.route('/')
def index():
    """Pääsivu."""
    return render_template('index.html')

@app.route('/api/images')
def list_images():
    """Listaa kaikki kuvat."""
    images = get_image_files()
    return jsonify({'images': images})

@app.route('/api/image/<path:filename>')
def get_image(filename):
    """Lataa kuva."""
    return send_from_directory(IMAGE_DIR, filename)

@app.route('/api/annotation/<path:image_name>')
def get_annotation(image_name):
    """Hae annotaatio kuvalle."""
    annotation_path = get_annotation_path(image_name)
    
    if annotation_path.exists():
        with open(annotation_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    else:
        return jsonify({'image_name': image_name, 'annotations': []})

@app.route('/api/annotation/<path:image_name>', methods=['POST'])
def save_annotation(image_name):
    """Tallenna annotaatio."""
    data = request.get_json()
    annotation_path = get_annotation_path(image_name)
    
    # Validoi data
    if 'image_name' not in data or 'annotations' not in data:
        return jsonify({'error': 'Invalid data format'}), 400
    
    # Tallenna JSON
    with open(annotation_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    return jsonify({'success': True, 'saved_to': str(annotation_path)})

@app.route('/api/image-info/<path:filename>')
def get_image_info(filename):
    """Hae kuvan dimensiot."""
    try:
        img_path = IMAGE_DIR / filename
        with Image.open(img_path) as img:
            width, height = img.size
        return jsonify({'width': width, 'height': height})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    print(f"📸 Riistakamera Annotator")
    print(f"📁 Image directory: {IMAGE_DIR}")
    print(f"🌐 Starting server at http://localhost:5000")
    
    if not IMAGE_DIR.exists():
        print(f"⚠️  Warning: Image directory does not exist. Creating it...")
        IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    
    image_count = len(get_image_files())
    print(f"📷 Found {image_count} images")
    
    app.run(debug=True, host='0.0.0.0', port=5000)
