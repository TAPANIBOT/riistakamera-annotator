FROM python:3.11-slim

WORKDIR /app

# Järjestelmäriippuvuudet OpenCV:lle ja Pillowille
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Python-riippuvuudet
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kopioi sovellus
COPY . .

# Luo data-hakemistot
RUN mkdir -p /data/images/incoming /data/annotations /data/predictions /data/models /data/dataset

# Non-root käyttäjä
RUN useradd -m -s /bin/bash appuser && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/api/status')" || exit 1

ENV DATA_DIR=/data
ENV FLASK_APP=app.py

CMD ["python", "app.py"]
