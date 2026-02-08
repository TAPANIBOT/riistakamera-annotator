#!/usr/bin/env python3
"""
Riistakamerakuvien nouto Gmail-agentin API:n kautta.
Tukee:
- LinckEazi Cloud -palvelun kuvia (HTML-linkki Aliyun-pilveen)
- Perinteiset liitetiedostot (Uovision yms.)
"""
import base64
import json
import os
import re
from datetime import datetime
from pathlib import Path

import requests

GMAIL_AGENT_URL = os.environ.get('GMAIL_AGENT_URL', 'http://gmail-agent:8000')
DATA_DIR = Path(os.environ.get('DATA_DIR', '/data'))
IMAGE_DIR = DATA_DIR / 'images' / 'incoming'
PROCESSED_FILE = DATA_DIR / 'processed_emails.json'

CAMERA_SENDERS = os.environ.get(
    'CAMERA_SENDERS',
    'uovision,trail camera,riistakamera,linckeazi'
).lower().split(',')

CAMERA_SUBJECT_PATTERNS = [
    r'uovision',
    r'trail\s*cam',
    r'riistakamera',
    r'wildlife\s*cam',
    r'linckeazi',
    r'_SUNDOM',
]

# LinckEazi kuvien URL-pattern (Aliyun OSS)
LINCKEAZI_IMAGE_PATTERN = re.compile(
    r'https?://[^"<>\s]*\.(?:aliyuncs|linckeazi)\.com/[^"<>\s]*\.(?:jpg|jpeg|png)',
    re.IGNORECASE,
)


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
    resp = requests.post(
        f'{GMAIL_AGENT_URL}/execute',
        json={'action': action, 'params': params or {}},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def extract_gmail_messages(search_result):
    """Pura viestilista Gmail-agentin monikerroksisesta vastauksesta."""
    # data.data.results.messages
    try:
        return search_result['data']['data']['results']['messages']
    except (KeyError, TypeError):
        return []


def extract_email_content(read_result):
    """Pura sähköpostin sisältö Gmail-agentin vastauksesta."""
    # data.data
    try:
        return read_result['data']['data']
    except (KeyError, TypeError):
        return {}


def is_camera_email(email_data):
    """Tarkista onko viesti riistakamerasta."""
    sender = (email_data.get('from', '') or '').lower()
    subject = (email_data.get('subject', '') or '').lower()

    for pattern in CAMERA_SENDERS:
        if pattern.strip() in sender:
            return True

    for pattern in CAMERA_SUBJECT_PATTERNS:
        if re.search(pattern, subject, re.IGNORECASE):
            return True

    return False


def download_image(url, target_path):
    """Lataa kuva URL:sta."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    content_type = resp.headers.get('content-type', '')
    if 'image' not in content_type and len(resp.content) < 1000:
        raise ValueError(f'Ei kuva: content-type={content_type}, size={len(resp.content)}')
    with open(target_path, 'wb') as f:
        f.write(resp.content)
    return len(resp.content)


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


def parse_email_body_for_metadata(body_text):
    """Pura kameran metadata sähköpostin tekstistä."""
    meta = {}
    patterns = {
        'camera_date': r'Date:\s*(.+)',
        'camera_time': r'Time:\s*(.+)',
        'temperature': r'Temperature:\s*(.+)',
        'battery': r'Battery:\s*(\d+%)',
        'signal': r'Signal:\s*(\w+)',
        'trigger_mode': r'Trigger Mode:\s*(\w+)',
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, body_text)
        if m:
            meta[key] = m.group(1).strip()
    return meta


def save_image_with_metadata(image_path, email_content, source_url=None):
    """Tallenna metadata kuvan viereen."""
    meta = extract_exif_metadata(image_path)
    meta['email_date'] = email_content.get('date', '')
    meta['email_subject'] = email_content.get('subject', '')
    meta['email_from'] = email_content.get('from', '')
    if source_url:
        meta['source_url'] = source_url

    # Pura kameran metadata body-tekstistä
    body = email_content.get('body', '')
    meta.update(parse_email_body_for_metadata(body))

    meta_path = image_path.with_suffix('.meta.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def make_target_path(subject, email_date):
    """Luo kohdetiedostonimi sähköpostin tiedoista."""
    # Yritä parsia tiedostonimi otsikosta (esim. 15339_25173_20260208_164730696.jpg_SUNDOM)
    filename_match = re.search(r'(\d+_\d+_\d+_\d+\.jpg)', subject, re.IGNORECASE)
    if filename_match:
        filename = filename_match.group(1)
    else:
        # Fallback: käytä aikaleimaa
        try:
            dt = datetime.fromisoformat(email_date.replace('Z', '+00:00'))
            filename = dt.strftime('%Y%m%d_%H%M%S') + '.jpg'
        except Exception:
            filename = datetime.now().strftime('%Y%m%d_%H%M%S') + '.jpg'

    safe_name = re.sub(r'[^\w\-.]', '_', filename)
    target_path = IMAGE_DIR / safe_name

    # Vältä päällekirjoitus
    counter = 1
    while target_path.exists():
        stem = Path(safe_name).stem
        ext = Path(safe_name).suffix
        target_path = IMAGE_DIR / f"{stem}_{counter}{ext}"
        counter += 1

    return target_path


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

    # Hae LinckEazi-kameran viestit
    try:
        search_result = gmail_api_call('search_emails', {
            'query': 'from:linckeazi.com',
            'max_results': 50,
        })
    except Exception as e:
        results['errors'].append(f'Gmail-haku epäonnistui: {e}')
        return results

    messages = extract_gmail_messages(search_result)

    for msg_summary in messages:
        msg_id = str(msg_summary.get('id', ''))
        if msg_id in processed_ids:
            results['skipped'] += 1
            continue

        # Hae täysi viesti
        try:
            msg_data = gmail_api_call('read_email', {
                'message_id': msg_id,
            })
        except Exception as e:
            results['errors'].append(f'Viestin {msg_id} luku epäonnistui: {e}')
            continue

        email_content = extract_email_content(msg_data)

        if not is_camera_email(email_content):
            processed_ids.add(msg_id)
            continue

        # Etsi kuva-URL body-tekstistä (LinckEazi lähettää linkin, ei liitettä)
        body = email_content.get('body', '')
        subject = email_content.get('subject', '')
        email_date = email_content.get('date', '')

        image_urls = LINCKEAZI_IMAGE_PATTERN.findall(body)

        # Jos ei löydy body-tekstistä, kokeile otsikosta muodostaa URL
        if not image_urls and 'linckeazi' in email_content.get('from', '').lower():
            # Otsikon muoto: 15339_25173_20260208_164730696.jpg_SUNDOM
            fn_match = re.search(r'(\d+_\d+_\d+_\d+\.jpg)', subject, re.IGNORECASE)
            if fn_match:
                image_urls = [
                    f'https://msp-thumbnail.oss-eu-central-1.aliyuncs.com/{fn_match.group(1)}'
                ]

        if image_urls:
            for url in image_urls:
                target_path = make_target_path(subject, email_date)
                try:
                    download_image(url, target_path)
                    save_image_with_metadata(target_path, email_content, source_url=url)
                    results['fetched'] += 1
                    results['new_images'].append(target_path.name)
                except Exception as e:
                    results['errors'].append(f'Kuvan lataus epäonnistui ({url}): {e}')
        else:
            # Fallback: perinteiset liitteet
            attachments = email_content.get('attachments', [])
            for att in attachments:
                filename = att.get('filename', '')
                if not filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                    continue
                target_path = make_target_path(filename, email_date)
                try:
                    image_data = base64.b64decode(att.get('data', ''))
                    with open(target_path, 'wb') as f:
                        f.write(image_data)
                    save_image_with_metadata(target_path, email_content)
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
