# Películas de "Las buenas noticias según Jesús" — Guion vs. Biblia (PDF)

Genera, **por episodio/película** de la serie *"Las buenas noticias según Jesús"* (jw.org),
un **PDF** que muestra el **texto bíblico versículo por versículo** y, superpuesto, lo
que el **guion de la película** añade, omite o dice en otro orden.

| PDF | Película |
|-----|----------|
| `output/episodio_1_la_verdadera_luz_del_mundo_guion.pdf` | Episodio 1 — "La verdadera luz del mundo" |
| `output/episodio_2_este_es_mi_hijo_guion.pdf` | Episodio 2 — "Este es mi Hijo" |
| `output/episodio_3_ese_soy_yo_guion.pdf` | Episodio 3 — "Ese soy yo" |
| `output/episodio_4_para_eso_he_venido_guion.pdf` | Episodio 4 — "Para eso he venido" |
| `output/episodio_5_impactados_con_su_manera_de_ensenar_guion.pdf` | Episodio 5 — "Impactados con su manera de enseñar" |
| `output/episodio_6_eres_tu_el_que_tiene_que_venir_guion.pdf` | Episodio 6 — "¿Eres tú el que tiene que venir?" |

El extractor funciona con **cualquier episodio** de la serie (ver más abajo).

## Cómo se lee el PDF

El **texto base es el de la Biblia** (Traducción del Nuevo Mundo, jw.org), tomado
**versículo por versículo**. Cada escena indica su **rango de minutos** y los
**pasajes** que representa. Sobre la base se marca:

- **texto bíblico** — negro; el número de versículo va en **azul** y, al cambiar de
  libro, se antepone su **abreviatura** (naranja).
- **añadido por el guion** — **verde negrita**; cada bloque añadido va en su propia
  línea, con espacio extra para distinguirlo.
- ~~omitido por el guion~~ — **rojo tachado** (palabras bíblicas que la película no dice).
- *dicho en otro orden* — **morado cursiva**: texto que sí está en la Biblia pero que
  la película pronuncia en distinto orden del que tiene en el versículo (transposición).

Cuando una escena combina **varios relatos** (Mateo, Marcos, Lucas, Juan), la base los
**mezcla en un solo texto continuo**, escogiendo por cada tramo el versículo que la
película realmente cita (priorizando la coincidencia literal y en orden) e indicando con
la abreviatura del libro de dónde proviene cada parte.

## Cómo funciona

El guion se obtiene de los **subtítulos oficiales (`.vtt`)** que jw.org publica para
cada video (no se transcribe el audio), por lo que el texto es **exacto**.

1. **`extract_scripts.mjs`**
   - Descarga los subtítulos VTT de cada episodio desde la API de medios de jw.org
     (`GETPUBMEDIALINKS`, `pub=gnj`), cacheados en `vtt/`.
   - Abre la *Guía de videos* (`pub-gnjvrg`), que lista cada **escena** con su **rango de
     tiempo** y los **versículos** que representa.
   - Alinea los subtítulos con cada escena **por marca de tiempo** y guarda todo en
     `script_data.json`.

2. **`compare_fetch.mjs`** descarga el texto de los versículos de cada escena
   (reutilizando el scraper de `extract.js`) a `bible_scenes.json`. Los capítulos se
   **cachean en `bible_chapters.json`** (versionado): el resultado del API queda
   respaldado y las corridas posteriores no vuelven a llamarlo.

3. **`fetch_corpus.mjs`** descarga/cachea los **4 Evangelios completos** en
   `bible_corpus.json` (versionado). Sirve para ubicar en la Biblia una frase que la
   película cita aunque la guía la liste en otra escena.

4. **`compare_bible.py`** alinea, palabra por palabra, el guion contra el texto bíblico:
   - **Mezcla los relatos** referenciados (y busca en el corpus) para armar la base.
   - Marca añadidos, omisiones y **transposiciones** (texto reubicado).
   - Guarda el diff por escena en `compare_diff.json`.

5. **`make_compare_pdfs.js`** renderiza el PDF por película con los colores de jw.org.

## Uso

```bash
npm install
npx playwright install chromium   # solo la primera vez

npm run guion   # VTT + guía + texto bíblico + corpus + diff + PDFs
```

O por pasos:

```bash
npm run extract:scripts   # -> script_data.json
npm run guion:corpus      # -> bible_corpus.json (los 4 Evangelios)
npm run guion:data        # -> bible_scenes.json + compare_diff.json
npm run pdf:guion         # -> output/*_guion.pdf
```

Los PDFs quedan en `output/` con el formato `episodio_N_titulo_guion.pdf`.

### Otros episodios de la serie

El extractor descubre las guías desde el índice oficial y funciona con **cualquier
episodio**. Indica los números como argumentos (sin argumentos procesa **todos**):

```bash
node extract_scripts.mjs 1 2 3   # script_data.json para los episodios 1, 2 y 3
npm run pdf:guion                # -> output/episodio_1_*_guion.pdf, etc.
```

### Verificación

- `npm run verify:scripts` — comprueba que el guion coincide **palabra por palabra** con
  los subtítulos VTT de origen.

## Notas

- La fuente de los textos es la **Traducción del Nuevo Mundo** publicada en jw.org.
- Si jw.org cambia la estructura de la página, ajusta los selectores en `extract.js`.
