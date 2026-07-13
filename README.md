# Assembly Movies Script Extractor

Extrae los **textos bíblicos** que se utilizan en las producciones audiovisuales
(películas) de la **Asamblea Regional 2026 de los testigos de Jehová — "Felices para siempre"**
desde jw.org, y genera un **PDF por película** con los textos en orden.

Cada día del programa (Viernes, Sábado, Domingo) tiene una sección
`PRODUCCIÓN AUDIOVISUAL` que corresponde a un episodio/película:

| PDF | Día | Película |
|-----|-----|----------|
| `output/1_viernes_episodio.pdf` | Viernes | Episodio 4 — "Para eso he venido" |
| `output/2_sabado_episodio.pdf`  | Sábado  | Episodio 5 — "Impactados con su manera de enseñar" |
| `output/3_domingo_episodio.pdf` | Domingo | Episodio 6 — "¿Eres tú el que tiene que venir?" |

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
   - **Nombre del libro + cita** (p. ej. `Mateo 4:23-25`) en **azul negrita**.
   - **Números de versículo** en **naranja negrita** para diferenciarlos del texto.
   - En rangos multi-capítulo, el número se muestra como `capítulo:versículo`
     al cambiar de capítulo (p. ej. `6:1`).

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
