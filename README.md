# Assembly Movies Script Extractor

Extrae los **textos bíblicos** que se utilizan en las producciones audiovisuales
(películas) de la **Asamblea Regional 2026 de los testigos de Jehová — "Felices para siempre"**
desde jw.org, y genera un **PDF por película** con los textos en orden.

Cada día del programa (Viernes, Sábado, Domingo) tiene una sección
`PRODUCCIÓN AUDIOVISUAL` que corresponde a un episodio/película:

| PDF | Día | Película |
|-----|-----|----------|
| `output/episodio_4_para_eso_he_venido.pdf` | Viernes | Episodio 4 — "Para eso he venido" |
| `output/episodio_5_impactados_con_su_manera_de_ensenar.pdf` | Sábado | Episodio 5 — "Impactados con su manera de enseñar" |
| `output/episodio_6_eres_tu_el_que_tiene_que_venir.pdf` | Domingo | Episodio 6 — "¿Eres tú el que tiene que venir?" |

## Cómo funciona

1. **`extract.js`** usa Playwright (Chromium) para:
   - Abrir la página de cada día y localizar la sección `PRODUCCIÓN AUDIOVISUAL`.
   - Leer los enlaces bíblicos de la película. Cada enlace trae el atributo
     `data-targetverses` con el rango exacto (`BBCCCVVV-BBCCCVVV`), lo que permite
     resolver correctamente incluso rangos que cruzan capítulos
     (p. ej. *Marcos 1:21–3:19*).
   - Navegar a cada capítulo de la *Biblia de estudio* y extraer el texto limpio
     de cada versículo (quitando notas al margen, referencias cruzadas, etc.).
   - Guardar todo en `data.json`.

2. **`make_pdfs.js`** lee `data.json` y genera los 3 PDFs con `pdfkit`:
   - **Nombre del libro + cita** (p. ej. `Mateo 4:23-25`) en **naranja negrita**.
   - **Números de versículo** en **azul negrita** para diferenciarlos del texto.
   - En rangos multi-capítulo, el número se muestra como `capítulo:versículo`
     al cambiar de capítulo (p. ej. `6:1`).
   - Texto **justificado**, con los colores oficiales de jw.org.

## Guion de las películas

Además de los textos bíblicos, el proyecto genera un **PDF con el guion** de cada
película, organizado **por escena**. El **texto base es el de la Biblia** (versículo
por versículo, con el número de versículo en azul) y sobre él se resalta lo que el
guion **añade** (verde) y lo que **omite** (tachado en rojo). Este PDF es la única
versión del guion: reemplaza al antiguo PDF de "guion literal".

| PDF | Día | Película |
|-----|-----|----------|
| `output/episodio_4_para_eso_he_venido_guion.pdf` | Viernes | Episodio 4 — "Para eso he venido" |
| `output/episodio_5_impactados_con_su_manera_de_ensenar_guion.pdf` | Sábado | Episodio 5 — "Impactados con su manera de enseñar" |
| `output/episodio_6_eres_tu_el_que_tiene_que_venir_guion.pdf` | Domingo | Episodio 6 — "¿Eres tú el que tiene que venir?" |

El guion se obtiene de los **subtítulos oficiales (`.vtt`)** que jw.org publica para
cada video (no se transcribe el audio), por lo que el texto es **exacto**:

1. **`extract_scripts.mjs`**:
   - Descarga los subtítulos VTT de cada episodio desde la API de medios de jw.org
     (`GETPUBMEDIALINKS`, `pub=gnj`).
   - Abre la *Guía de videos de "Las buenas noticias según Jesús"* (`pub-gnjvrg`),
     que lista cada **escena** con su **rango de tiempo** y los **versículos** que
     representa.
   - Alinea los subtítulos con cada escena **por marca de tiempo** (no por
     coincidencia difusa), y guarda todo en `script_data.json`.

2. **`compare_fetch.mjs`** descarga el texto de los versículos de cada escena
   (reutilizando `extract.js`) a `bible_scenes.json`. Los capítulos descargados se
   **cachean en `bible_chapters.json`** (versionado en el repo): así el resultado del
   API queda respaldado y las corridas posteriores no vuelven a llamarlo (si el
   caché ya cubre todo, ni siquiera se abre el navegador).

3. **`compare_bible.py`** alinea, palabra por palabra, el guion contra el texto
   bíblico. **Sin relatos paralelos:** por escena elige **un solo relato** (el que
   más se asemeja a los subtítulos) como base, y guarda el diff en `compare_diff.json`.

4. **`make_compare_pdfs.js`** renderiza el PDF del guion por película, con el mismo
   estilo que los PDFs de textos bíblicos:
   - **Título de la escena** en azul oscuro y **pasajes bíblicos** en naranja negrita.
   - **Texto base bíblico** con el **nombre del libro abreviado** (naranja) y los
     **números de versículo** (azul).
   - Sobre la base: **verde** = palabras que el guion añade, ~~rojo tachado~~ =
     palabras bíblicas que el guion no dice.

```bash
npm run guion            # VTT + guía + texto bíblico + diff + PDFs del guion
npm run verify:scripts   # verifica el guion contra los subtítulos oficiales
```

O por pasos: `npm run extract:scripts` (-> `script_data.json`), `npm run guion:data`
(-> `bible_scenes.json` + `compare_diff.json`) y `npm run pdf:guion`
(-> `output/*_guion.pdf`).

Sin argumentos, `extract_scripts.mjs` procesa **todos** los episodios que descubre
en el índice oficial.

### Otros episodios de la serie

El extractor descubre las guías desde el índice oficial y funciona con **cualquier
episodio** de la serie (no solo los de la asamblea). Indica los números como
argumentos:

```bash
node extract_scripts.mjs 1 2 3   # genera script_data.json para los episodios 1, 2 y 3
npm run pdf:guion                # -> output/episodio_1_*_guion.pdf, etc.
```

Todos los PDFs siguen el mismo formato de nombre:
`episodio_N_titulo.pdf` (textos bíblicos) y `episodio_N_titulo_guion.pdf` (guion).

### Verificación

- `npm run verify:scripts` — comprueba que el guion coincide **palabra por palabra**
  con los subtítulos VTT de origen.


## Uso

```bash
npm install
npx playwright install chromium   # solo la primera vez

npm start        # extrae los datos y genera los 3 PDFs
```

O por pasos:

```bash
npm run extract  # -> data.json
npm run pdf      # -> output/*.pdf
```

Los PDFs quedan en la carpeta `output/`.

## Notas

- La fuente de los textos es la **Traducción del Nuevo Mundo** publicada en jw.org.
- Si jw.org cambia la estructura de la página, ajusta los selectores en `extract.js`.
