#!/usr/bin/env python3
"""
Ajastettu kuvien nouto riistakamerasta.
Hakee uudet kuvat 30 min välein ja ajaa tunnistuksen.
"""
import os
import time
import logging
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
)
log = logging.getLogger(__name__)

FETCH_INTERVAL = int(os.environ.get('FETCH_INTERVAL_SECONDS', 1800))  # 30 min


def run_fetch_cycle():
    """Aja yksi nouto- ja tunnistuskierros."""
    from ingestion.fetch_camera_emails import fetch_camera_images

    log.info("Aloitetaan kuvien nouto...")
    result = fetch_camera_images()
    log.info(
        "Nouto valmis: %d uutta kuvaa, %d ohitettu, %d virhettä",
        result.get('fetched', 0),
        result.get('skipped', 0),
        len(result.get('errors', [])),
    )

    # Aja tunnistus uusille kuville
    new_images = result.get('new_images', [])
    if new_images:
        try:
            from detection.detect_batch import detect_new_images
            det_result = detect_new_images()
            log.info(
                "Tunnistus valmis: %d kuvaa käsitelty",
                det_result.get('processed', 0),
            )
        except ImportError:
            log.warning("Detection-moduulia ei löydy, ohitetaan tunnistus")
        except Exception as e:
            log.error("Tunnistusvirhe: %s", e)

    return result


def main():
    """Pääsilmukka: hae kuvat säännöllisin väliajoin."""
    log.info("Riistakamera-ajastin käynnistyy (intervalli: %ds)", FETCH_INTERVAL)

    while True:
        try:
            run_fetch_cycle()
        except Exception as e:
            log.error("Virhe noutokierroksessa: %s", e)

        log.info("Seuraava nouto %d sekunnin kuluttua...", FETCH_INTERVAL)
        time.sleep(FETCH_INTERVAL)


if __name__ == '__main__':
    main()
