#!/usr/bin/env python3
"""
Riistakamerakuvien nouto suoraan IMAP:lla — ohittaa Gmail-agentin.
Ei kuluta Haiku-tokeneita.

Tukee:
- LinckEazi Cloud -palvelun kuvia (HTML-linkki Aliyun-pilveen)
- Perinteiset liitetiedostot (Uovision yms.)
"""
import base64
import email
import email.utils
import imaplib
import json
import os
import re
from datetime import datetime
from email.header import decode_header
from pathlib import Path

import requests
import yaml

DATA_DIR = Path(os.environ.get('DATA_DIR', '/data'))
IMAGE_DIR = DATA_DIR / 'images' / 'incoming'
PROCESSED_FILE = DATA_DIR / 'processed_emails.json'

IMAP_SERVER = 'imap.gmail.com'
IMAP_PORT = 993

# LinckEazi kuvien URL-pattern (Aliyun OSS)
LINCKEAZI_IMAGE_PATTERN = re.compile(
    r'https?://[^"<>\s]*\.(?:aliyuncs|linckeazi)\.com/[^"<>\s]*\.(?:jpg|jpeg|png)',
    re.IGNORECASE,
)


def get_credentials():
    """Lue Gmail-tunnukset Docker Secretsistä tai ympäristömuuttujista."""
    gmail_user = os.environ.get('GMAIL_USER', '')
    gmail_password = os.environ.get('GMAIL_APP_PASSWORD', '')

    # Yritä Docker Secrets -tiedosto
    secrets_path = '/run/secrets/gmail_app_password'
    if not gmail_password and os.path.exists(secrets_path):
        with open(secrets_path, 'r') as f:
            content = f.read().strip()
            # Tarkista onko YAML-muodossa
            if ':' in content:
                try:
                    data = yaml.safe_load(content)
                    if isinstance(data, dict) and 'gmail' in data:
                        gmail_password = data['gmail'].get('app_password', '')
                    elif isinstance(data, dict) and 'app_password' in data:
                        gmail_password = data['app_password']
                except yaml.YAMLError:
                    gmail_password = content
            else:
                gmail_password = content

    if not gmail_user or not gmail_password:
        raise ValueError(
            'Gmail-tunnukset puuttuvat. Aseta GMAIL_USER ja GMAIL_APP_PASSWORD '
            'tai mounttaa Docker Secret.'
        )

    return gmail_user, gmail_password


def decode_mime_header(value):
    """Purkaa MIME-enkoodatun headerin."""
    if not value:
        return ''
    decoded_parts = decode_header(value)
    parts = []
    for part, charset in decoded_parts:
        if isinstance(part, bytes):
            parts.append(part.decode(charset or 'utf-8', errors='ignore'))
        else:
            parts.append(str(part))
    return ' '.join(parts)


def get_email_body(msg):
    """Pura sähköpostin tekstisisältö."""
    body = ''
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type in ('text/plain', 'text/html'):
                try:
                    payload = part.get_payload(decode=True)
                    charset = part.get_content_charset() or 'utf-8'
                    body += payload.decode(charset, errors='ignore')
                except Exception:
                    pass
    else:
        try:
            payload = msg.get_payload(decode=True)
            charset = msg.get_content_charset() or 'utf-8'
            body = payload.decode(charset, errors='ignore')
        except Exception:
            pass
    return body


def get_image_attachments(msg):
    """Pura kuva-liitteet sähköpostista."""
    attachments = []
    if not msg.is_multipart():
        return attachments

    for part in msg.walk():
        content_type = part.get_content_type()
        filename = part.get_filename()
        if filename:
            filename = decode_mime_header(filename)

        if content_type.startswith('image/') or (
            filename and filename.lower().endswith(('.jpg', '.jpeg', '.png'))
        ):
            payload = part.get_payload(decode=True)
            if payload:
                attachments.append({
                    'filename': filename or 'image.jpg',
                    'data': payload,
                })
    return attachments


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
        with Image.open(image_path) as img_file:
            metadata['width'] = img_file.width
            metadata['height'] = img_file.height

            exif = img_file.getexif()
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


def save_image_with_metadata(image_path, subject, sender, date_str, body, source_url=None):
    """Tallenna metadata kuvan viereen."""
    meta = extract_exif_metadata(image_path)
    meta['email_date'] = date_str
    meta['email_subject'] = subject
    meta['email_from'] = sender
    if source_url:
        meta['source_url'] = source_url
    meta.update(parse_email_body_for_metadata(body))

    meta_path = image_path.with_suffix('.meta.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def make_target_path(subject, email_date_str):
    """Luo kohdetiedostonimi sähköpostin tiedoista."""
    filename_match = re.search(r'(\d+_\d+_\d+_\d+\.jpg)', subject, re.IGNORECASE)
    if filename_match:
        filename = filename_match.group(1)
    else:
        try:
            dt = datetime.fromisoformat(email_date_str.replace('Z', '+00:00'))
            filename = dt.strftime('%Y%m%d_%H%M%S') + '.jpg'
        except Exception:
            filename = datetime.now().strftime('%Y%m%d_%H%M%S') + '.jpg'

    safe_name = re.sub(r'[^\w\-.]', '_', filename)
    target_path = IMAGE_DIR / safe_name

    counter = 1
    while target_path.exists():
        stem = Path(safe_name).stem
        ext = Path(safe_name).suffix
        target_path = IMAGE_DIR / f"{stem}_{counter}{ext}"
        counter += 1

    return target_path


def fetch_camera_images():
    """Hae uudet riistakamerakuvat suoraan IMAP:lla.

    Ohittaa Gmail-agentin kokonaan — ei Haiku-tokeneita.
    """
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    processed = load_processed()
    processed_ids = set(processed.get('processed_ids', []))

    results = {
        'fetched': 0,
        'skipped': 0,
        'errors': [],
        'new_images': [],
    }

    try:
        gmail_user, gmail_password = get_credentials()
    except ValueError as e:
        results['errors'].append(str(e))
        return results

    try:
        mail = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
        mail.login(gmail_user, gmail_password)
        mail.select('INBOX', readonly=True)
    except Exception as e:
        results['errors'].append(f'IMAP-yhteys epäonnistui: {e}')
        return results

    try:
        # Hae linckeazi.com-viestit
        status, msg_ids = mail.search(None, '(FROM "linckeazi.com")')
        if status != 'OK' or not msg_ids[0]:
            mail.logout()
            return results

        message_nums = msg_ids[0].split()

        # Käsittele viimeisimmät ensin (max 500 kerralla)
        message_nums = message_nums[-500:]

        for msg_num in message_nums:
            msg_id_str = msg_num.decode()

            if msg_id_str in processed_ids:
                results['skipped'] += 1
                continue

            try:
                status, msg_data = mail.fetch(msg_num, '(RFC822)')
                if status != 'OK':
                    continue

                raw_email = msg_data[0][1]
                msg = email.message_from_bytes(raw_email)

                # Pura headerit
                subject = decode_mime_header(msg.get('Subject', ''))
                sender = decode_mime_header(msg.get('From', ''))
                date_str = msg.get('Date', '')

                # Parsitaan RFC 2822 -päivämäärä
                try:
                    date_tuple = email.utils.parsedate_to_datetime(date_str)
                    date_iso = date_tuple.isoformat()
                except Exception:
                    date_iso = date_str

                body = get_email_body(msg)

                # Etsi kuva-URL:t body-tekstistä
                image_urls = LINCKEAZI_IMAGE_PATTERN.findall(body)

                # Fallback: muodosta URL otsikosta
                if not image_urls:
                    fn_match = re.search(r'(\d+_\d+_\d+_\d+\.jpg)', subject, re.IGNORECASE)
                    if fn_match:
                        image_urls = [
                            f'https://msp-thumbnail.oss-eu-central-1.aliyuncs.com/{fn_match.group(1)}'
                        ]

                if image_urls:
                    for url in image_urls:
                        target_path = make_target_path(subject, date_iso)
                        try:
                            download_image(url, target_path)
                            save_image_with_metadata(
                                target_path, subject, sender, date_iso, body,
                                source_url=url,
                            )
                            results['fetched'] += 1
                            results['new_images'].append(target_path.name)
                        except Exception as e:
                            results['errors'].append(f'Kuvan lataus epäonnistui ({url}): {e}')
                else:
                    # Perinteiset liitteet
                    attachments = get_image_attachments(msg)
                    for att in attachments:
                        target_path = make_target_path(att['filename'], date_iso)
                        try:
                            with open(target_path, 'wb') as f:
                                f.write(att['data'])
                            save_image_with_metadata(
                                target_path, subject, sender, date_iso, body,
                            )
                            results['fetched'] += 1
                            results['new_images'].append(target_path.name)
                        except Exception as e:
                            results['errors'].append(
                                f'Liitteen {att["filename"]} tallennus epäonnistui: {e}'
                            )

                processed_ids.add(msg_id_str)

            except Exception as e:
                results['errors'].append(f'Viestin {msg_id_str} käsittely epäonnistui: {e}')
                processed_ids.add(msg_id_str)

    finally:
        try:
            mail.logout()
        except Exception:
            pass

    # Tallenna käsitellyt
    processed['processed_ids'] = list(processed_ids)
    processed['last_fetch'] = datetime.now().isoformat()
    save_processed(processed)

    return results


if __name__ == '__main__':
    print("Haetaan riistakamerakuvat suoraan IMAP:lla...")
    result = fetch_camera_images()
    print(json.dumps(result, indent=2, ensure_ascii=False))
