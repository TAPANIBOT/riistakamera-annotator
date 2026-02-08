#!/bin/bash
# Kouluta YOLO-lajimalli Mac Minin hostissa (Apple Silicon MPS).
# Docker ei tue MPS:ää, joten koulutus ajetaan suoraan hostissa.
#
# Käyttö:
#   bash scripts/train_on_host.sh
#   bash scripts/train_on_host.sh --epochs 200 --base-model yolo11s-cls.pt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-/data}"

echo "=== Riistakamera: YOLO-lajimallin koulutus ==="
echo "Data: ${DATA_DIR}"
echo "Aika: $(date)"
echo ""

# Tarkista dataset
DATASET_YAML="${DATA_DIR}/dataset/dataset.yaml"
if [ ! -f "$DATASET_YAML" ]; then
    echo "Eksportoidaan YOLO-dataset ensin..."
    python3 "${SCRIPT_DIR}/export_yolo.py" \
        --annotation-dir "${DATA_DIR}/annotations" \
        --image-dir "${DATA_DIR}/images/incoming" \
        --output-dir "${DATA_DIR}/dataset"
    echo ""
fi

if [ ! -f "$DATASET_YAML" ]; then
    echo "VIRHE: dataset.yaml ei löydy. Onko annotaatioita tehty?"
    exit 1
fi

# Laske annotaatiot
ANN_COUNT=$(find "${DATA_DIR}/annotations" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "Annotoituja kuvia: ${ANN_COUNT}"

# Valitse malli koon mukaan
BASE_MODEL="${1:-yolo11n-cls.pt}"
if [ "$ANN_COUNT" -gt 500 ]; then
    BASE_MODEL="yolo11s-cls.pt"
    echo "Käytetään isompaa mallia (>500 annotaatiota): ${BASE_MODEL}"
elif [ "$ANN_COUNT" -lt 100 ]; then
    echo "VAROITUS: Alle 100 annotaatiota. Koulutus voi olla epäluotettava."
fi

echo "Pohjamalli: ${BASE_MODEL}"
echo ""

# Aja koulutus
export DATA_DIR
python3 "${SCRIPT_DIR}/training/train.py" \
    --dataset "$DATASET_YAML" \
    --base-model "$BASE_MODEL" \
    --device mps \
    "$@"

echo ""
echo "=== Koulutus valmis ==="
echo "Malli: ${DATA_DIR}/models/species_latest.pt"
