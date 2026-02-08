#!/usr/bin/env python3
"""
Riistakamerakuvien nouto Gmail-agentin API:n kautta.
Hakee Uovision-kameran lähettämät kuvat sähköpostista ja tallentaa ne.
"""
import base64
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

import requests

GMAIL_AGENT_URL = os.environ.get('GMAIL_AGENT_URL', 'http://gmail-agent:8001')
DATA_DIR = Path(os.environ.get('DATA_DIR', '/data'))
IMAGE_DIR = DATA_DIR / 'images' / 'incoming'
PROCESSED_FILE = DATA_DIR / 'processed_emails.json'

# Uovision-kameran lähettäjä (voi olla eri malleja)
CAMERA_SENDERS = os.environ.get(
    'CAMERA_SENDERS',
    'uovision,trail camera,riistakamera'
).lower().split(',')

CAMERA_SUBJECT_PATTERNS = [
    r'uovision',
    r'trail\s*cam',
    r'riistakamera',
    r'wildlife\s*cam',
]


def load_processed():
    """Lataa käsiteltyjen viestien ID:t."""
    if PROCESSED_FILE.exists():
        with open(PROCESSED_FILE, 'r') as f:
            return json.load(f)
    return {'processed_ids': [], 'last_fetch': None}


def save_processed(data):
    """Tallenna käsitellyt viestin ID:t."""
    PROCESSED_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PROCESSED_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def gmail_api_call(action, params=None):
    """Kutsu Gmail-agentin API:a."""
    payload = {
        'action': action,
        'params': params or {},
    }

    resp = requests.post(
        f'{GMAIL_AGENT_URL}/execute',
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def is_camera_email(email_data):
    """Tarkista onko viesti riistakamerasta."""
    sender = (email_data.get('from', '') or '').lower()
    subject = (email_data.get('subject', '') or '').lower()

    # Tarkista lähettäjä
    for pattern in CAMERA_SENDERS:
        if pattern.strip() in sender:
            return True

    # Tarkista otsikko
    for pattern in CAMERA_SUBJECT_PATTERNS:
        if re.search(pattern, subject):
            return True

    return False


def extract_exif_metadata(image_path):
    """Pura EXIF-metadata kuvasta."""
    try:
        from PIL import Image
        from PIL.ExifTags import TAGS

        metadata = {}
        with Image.open(image_path) as img:
            metadata['width'] = img.width
            metadata['height'] = img.height

            exif = img.getexif()
            if exif:
                for tag_id, value in exif.items():
                    tag = TAGS.get(tag_id, tag_id)
                    try:
                        if isinstance(value, bytes):
                            value = value.decode('utf-8', errors='ignore')
                        metadata[str(tag)] = str(value)
                    except Exception:
                        pass

        return metadata
    except Exception as e:
        return {'error': str(e)}


def fetch_camera_images():
    """Hae uudet riistakamerakuvat sähköpostista."""
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    processed = load_processed()
    processed_ids = set(processed.get('processed_ids', []))

    results = {
        'fetched': 0,
        'skipped': 0,
        'errors': [],
        'new_images': [],
    }

    # Hae viimeaikaiset viestit liitteineen
    try:
        search_result = gmail_api_call('search_emails', {
            'query': 'has:attachment filename:jpg OR filename:jpeg',
            'max_results': 50,
        })
    except Exception as e:
        results['errors'].append(f'Gmail-haku epäonnistui: {e}')
        return results

    messages = search_result.get('result', {}).get('messages', [])

    for msg_summary in messages:
        msg_id = msg_summary.get('id', '')
        if msg_id in processed_ids:
            results['skipped'] += 1
            continue

        # Hae täysi viesti liitteineen
        try:
            msg_data = gmail_api_call('read_email', {
                'message_id': msg_id,
                'include_attachments': True,
            })
        except Exception as e:
            results['errors'].append(f'Viestin {msg_id} luku epäonnistui: {e}')
            continue

        email_content = msg_data.get('result', {})

        # Tarkista onko kameraviesti
        if not is_camera_email(email_content):
            processed_ids.add(msg_id)
            continue

        # Prosessoi liitteet
        attachments = email_content.get('attachments', [])
        for att in attachments:
            filename = att.get('filename', '')
            if not filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue

            # Luo uniikki tiedostonimi aikaleimalla
            timestamp = email_content.get('date', '')
            try:
                dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                prefix = dt.strftime('%Y%m%d_%H%M%S')
            except Exception:
                prefix = datetime.now().strftime('%Y%m%d_%H%M%S')

            safe_filename = re.sub(r'[^\w\-.]', '_', filename)
            target_name = f"{prefix}_{safe_filename}"
            target_path = IMAGE_DIR / target_name

            # Vältä päällekirjoitus
            counter = 1
            while target_path.exists():
                stem = Path(target_name).stem
                ext = Path(target_name).suffix
                target_path = IMAGE_DIR / f"{stem}_{counter}{ext}"
                counter += 1

            # Tallenna kuva
            try:
                image_data = base64.b64decode(att.get('data', ''))
                with open(target_path, 'wb') as f:
                    f.write(image_data)

                # Pura EXIF-metadata
                meta = extract_exif_metadata(target_path)
                meta['email_date'] = timestamp
                meta['email_subject'] = email_content.get('subject', '')
                meta['email_from'] = email_content.get('from', '')
                meta['original_filename'] = filename

                meta_path = target_path.with_suffix('.meta.json')
                with open(meta_path, 'w', encoding='utf-8') as f:
                    json.dump(meta, f, indent=2, ensure_ascii=False)

                results['fetched'] += 1
                results['new_images'].append(target_path.name)

            except Exception as e:
                results['errors'].append(f'Liitteen {filename} tallennus epäonnistui: {e}')

        processed_ids.add(msg_id)

    # Tallenna käsitellyt
    processed['processed_ids'] = list(processed_ids)
    processed['last_fetch'] = datetime.now().isoformat()
    save_processed(processed)

    return results


if __name__ == '__main__':
    print("Haetaan riistakamerakuvat sähköpostista...")
    result = fetch_camera_images()
    print(json.dumps(result, indent=2, ensure_ascii=False))
