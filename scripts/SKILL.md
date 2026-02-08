---
name: riistakamera
description: Riistakameran havaintotiedot — tilastot, lajit, vuorokausirytmi, trendit
---

# Riistakamera-skill

Riistakameran havaintodata: lajitilastot, vuorokausirytmi, aktiivisimmat tunnit, AI-tarkkuus.

## Komennot

### Yhteenveto (oletus 7 päivää)
```bash
riista-api brief [days] [species] [detail]
```
- `days` (1-90, oletus 7) — montako päivää taaksepäin
- `species` — suodata lajiin, esim. `janis` tai `janis,kauris`
- `detail` — `summary` (oletus) tai `full` (tunnit + AI-tarkkuus)

**Esimerkki:**
```bash
riista-api brief 7          # viikon yhteenveto
riista-api brief 30 "" full # kuukauden data, täydet tunnit + AI-tarkkuus
riista-api brief 7 janis    # vain jänikset, 7pv
```

### Päiväkohtainen
```bash
riista-api day [YYYY-MM-DD]
```
Palauttaa yhden päivän tiedot. Ilman päivämäärää = tänään.

### Palvelimen tila
```bash
riista-api health
```

## Vastausohjeet

- Raportoi suomeksi
- Mainitse top 3 aktiivisimmat tunnit ja yleisimmät lajit
- Jos annotoimattomia kuvia on paljon, muistuta: "Annotaatio-UI: http://tapani---mac-mini.tail3d5d3c.ts.net:5000/annotator"
- Dashboard: http://tapani---mac-mini.tail3d5d3c.ts.net:5000/dashboard
- Vastaus on plain text, voit lukea sen suoraan käyttäjälle

## Lajikartta (API-nimi → suomenkielinen)

| API-nimi | Suomeksi |
|----------|----------|
| kauris | Metsäkauris |
| peura | Valkohäntäpeura |
| janis | Jänis |
| linnut | Linnut |
| supikoira | Supikoira |
| kettu | Kettu |
| ihminen | Ihminen |
| koira | Koira |
| muu | Muu |

## Esimerkkejä

| Käyttäjä kysyy | Komento |
|-----------------|---------|
| "Mitä riistakameralla näkyy?" | `riista-api brief 7` |
| "Onko jäniksiä näkynyt?" | `riista-api brief 14 janis` |
| "Riistakameran kuukausiraportti" | `riista-api brief 30 "" full` |
| "Mitä eilen näkyi?" | `riista-api day 2026-02-07` |
| "Toimiiko riistakamera?" | `riista-api health` |
