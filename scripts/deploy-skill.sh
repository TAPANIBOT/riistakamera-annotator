#!/bin/bash
# Deployaa riistakamera-skill ja muisti Mac Minille
# Käyttö: ./scripts/deploy-skill.sh

set -e

REMOTE="tapani@100.93.64.41"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Deploying riistakamera skill to Mac Mini..."

# Luo hakemistot
ssh "$REMOTE" "mkdir -p ~/.openclaw/skills/riistakamera ~/.openclaw/memory"

# Kopioi SKILL.md
scp "$SCRIPT_DIR/SKILL.md" "$REMOTE:~/.openclaw/skills/riistakamera/SKILL.md"

# Kopioi muistitiedosto
scp "$SCRIPT_DIR/riistakamera-memory.md" "$REMOTE:~/.openclaw/memory/riistakamera.md"

echo "Done! Skill and memory deployed."
echo ""
echo "Next steps on Mac Mini:"
echo "  1. Add exec-approvals for curl localhost:5000/api/*"
echo "  2. Add cron job: openclaw cron add --name riistakamera-fetch --every 30m --session isolated --system-event 'Hae uudet riistakamerakuvat: curl -s -X POST http://localhost:5000/api/fetch' --wake now"
