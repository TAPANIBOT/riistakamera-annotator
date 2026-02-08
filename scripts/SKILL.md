---
name: riistakamera
description: Riistakameran kuvien hallinta — tilastot, havainnot, haku, annotaatiotilanne
---

# Riistakamera-skill

Hallinnoi riistakameran kuvia, tunnistuksia ja annotaatioita.

## API-komennot

### Tilastot
```bash
curl -s http://localhost:5000/api/stats
```
Palauttaa: total_images, annotated_images, empty_images, unannotated_images, predicted_images, species_counts.

### Viimeisimmät havainnot
```bash
curl -s http://localhost:5000/api/recent-detections
```
Palauttaa: detections (kuvakohtaiset tunnistukset), species_summary (lajijakauma).

### Hae uudet kuvat sähköpostista
```bash
curl -s -X POST http://localhost:5000/api/fetch
```
Triggeroi sähköpostien haun ja tunnistuksen uusille kuville.

### Epävarmuusjärjestys (active learning)
```bash
curl -s "http://localhost:5000/api/active-learning/ranking?limit=10"
```
Palauttaa kuvat jotka hyötyisivät eniten ihmisen annotaatiosta.

### YOLO-eksportti
```bash
curl -s -X POST http://localhost:5000/api/export/yolo
```
Eksportoi annotaatiot YOLO-koulutusformaattiin.

## Vastausohjeet

- Raportoi tilastot suomeksi: "Riistakamerassa on X kuvaa, joista Y annotoitu, Z tyhjää"
- Lajijakaumasta mainitse yleisimmät lajit: "Yleisimmät: kauris (N kpl), peura (N kpl)"
- Jos annotoimattomia on paljon, muistuta: "Annotaatio-UI: http://tapani---mac-mini.tail3d5d3c.ts.net:5000"
- Hae uudet kuvat automaattisesti kun käyttäjä kysyy tilannetta

## Annotaatio-UI

Selaimella: `http://tapani---mac-mini.tail3d5d3c.ts.net:5000` tai `http://100.93.64.41:5000`
