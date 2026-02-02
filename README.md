# 📸 Riistakamera Annotator

Yksinkertainen web-pohjainen työkalu riistakamerakuvien annotointiin. Piirä bounding boxit eläinten ympärille ja tallenna annotaatiot JSON-muodossa.

## ✨ Ominaisuudet

- 🖼️ Kuvan lataus ja näyttö
- 🎯 Drag-to-select bounding box -työkalu
- 🦌 Eläinlaji-dropdown (hirvi, kauris, kettu, jänis, ilves, karhu, susi, muu)
- 💾 JSON-annotaatioiden tallennus per kuva
- ⏭️ Seuraava kuva -nappi
- ⌨️ Pikatoiminnot (Enter, N, C)
- 🎨 Responsiivinen, käyttäjäystävällinen UI

## 🛠️ Asennus

### 1. Riippuvuudet

```bash
pip install Flask Pillow
```

### 2. Projektikansio

```bash
cd ~/clawd-openrouter-coder/riistakamera-annotator
```

### 3. Kuvakansio

Varmista, että kuvakansio on olemassa:

```bash
mkdir -p ~/clawd/riistakamera
```

Kopioi riistakamerakuvat kansioon:

```bash
cp /polku/kuviisi/*.jpg ~/clawd/riistakamera/
```

## 🚀 Käyttö

### Käynnistä sovellus:

```bash
python app.py
```

### Avaa selaimessa:

```
http://localhost:5000
```

## 📖 Käyttöohjeet

1. **Piirrä bounding box**: Vedä hiirellä laatikko eläimen ympärille
2. **Valitse laji**: Valitse eläinlaji pudotusvalikosta
3. **Tallenna**: Klikkaa "💾 Tallenna" -nappia
4. **Seuraava kuva**: Klikkaa "➡️ Seuraava kuva" siirtyäksesi eteenpäin

### Pikatoiminnot

- **Enter**: Tallenna annotaatio
- **N**: Seuraava kuva
- **C**: Tyhjennä nykyinen laatikko

## 📁 Tiedostorakenne

```
riistakamera-annotator/
├── app.py                  # Flask backend
├── templates/
│   └── index.html          # HTML-template
├── static/
│   ├── style.css           # Tyylit
│   └── script.js           # Canvas-logiikka
└── README.md
```

## 💾 Annotaatiot

Annotaatiot tallennetaan JSON-muodossa samaan kansioon kuin kuvat:

```
~/clawd/riistakamera/
├── IMG_0001.jpg
├── IMG_0001.json           # Annotaatiot
├── IMG_0002.jpg
├── IMG_0002.json
└── ...
```

### JSON-rakenne:

```json
{
  "image_name": "IMG_0001.jpg",
  "annotations": [
    {
      "bbox": [120, 80, 350, 280],
      "species": "hirvi"
    },
    {
      "bbox": [400, 150, 520, 300],
      "species": "kauris"
    }
  ]
}
```

### Bounding box koordinaatit:

- `[x1, y1, x2, y2]` (pikselit)
- `x1, y1`: Vasen yläkulma
- `x2, y2`: Oikea alakulma

## 🎯 Tuetut eläinlajit

- 🦌 Hirvi
- 🦌 Kauris
- 🦊 Kettu
- 🐰 Jänis
- 🐱 Ilves
- 🐻 Karhu
- 🐺 Susi
- ❓ Muu

## 🔧 Konfiguraatio

Voit muuttaa kuvakansion polkua muokkaamalla `app.py`:

```python
IMAGE_DIR = Path.home() / "clawd" / "riistakamera"
```

## 🐛 Vianmääritys

### "Ei kuvia kansiossa"

- Varmista, että kuvat ovat oikeassa kansiossa: `~/clawd/riistakamera/`
- Tuetut formaatit: `.jpg`, `.jpeg`, `.png`, `.bmp`, `.gif`

### "Connection refused"

- Tarkista, että Flask-palvelin on käynnissä
- Tarkista portti 5000 (muuta tarvittaessa `app.py`:ssä)

### Annotaatiot eivät tallennu

- Tarkista kirjoitusoikeudet kansioon `~/clawd/riistakamera/`
- Katso Flask-lokit konsolista

## 📊 Käyttötilastot

- Sovellus näyttää:
  - Nykyinen kuva / Kuvien määrä
  - Annotaatioiden määrä nykyisessä kuvassa

## 🚀 Jatkokehitys

Mahdollisia lisäyksiä tulevaisuudessa:

- ✏️ Annotaatioiden muokkaus (raahaaminen, koon muutos)
- 🔍 Zoomaus-ominaisuus suurille kuville
- 📊 Tilastonäkymä (lajien jakaumat)
- 🎨 Eri värit eri lajeille
- 🔙 Edellinen kuva -nappi
- 📤 Export COCO/YOLO-formaattiin

## 📝 Lisenssi

Vapaa käyttöön riistakameran kuvien annotointiin.

## 🙋 Tuki

Ongelmat? Avaa issue tai ota yhteyttä.

---

**Valmis käyttöön!** 🎉
