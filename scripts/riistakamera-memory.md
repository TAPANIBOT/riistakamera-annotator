# Riistakamera

## API
- Tilastot: `curl -s http://localhost:5000/api/stats`
- Viimeisimmät: `curl -s http://localhost:5000/api/recent-detections`
- Hae uudet: `curl -s -X POST http://localhost:5000/api/fetch`
- Epävarmuus: `curl -s "http://localhost:5000/api/active-learning/ranking?limit=10"`
- YOLO-eksportti: `curl -s -X POST http://localhost:5000/api/export/yolo`

## Annotaatio-UI
- Tailscale: http://tapani---mac-mini.tail3d5d3c.ts.net:5000
- LAN: http://100.93.64.41:5000

## Skill
- Nimi: riistakamera
- Sijainti: ~/.openclaw/skills/riistakamera/SKILL.md

## Lajit
kauris, peura, janis, linnut, supikoira, kettu, ihminen, koira, muu

## Docker
- Kontti: wildlife-detector
- Data: wildlife-data volume → /data/
- Verkko: agent-network
