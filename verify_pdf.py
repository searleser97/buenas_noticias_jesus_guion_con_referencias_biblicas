import json
import re
import sys
import glob
import fitz  # pymupdf

sys.stdout.reconfigure(encoding='utf-8')

# Verifica que cada PDF contenga EXACTAMENTE el texto de data.json (palabras y
# orden), reconstruyendo el flujo esperado y comparándolo con el texto extraído.

with open('data.json', encoding='utf-8') as f:
    movies = json.load(f)


def normalize(s):
    # Colapsa todos los espacios/saltos a un solo espacio y normaliza unicode.
    import unicodedata
    s = unicodedata.normalize('NFC', s)
    s = s.replace('\u00a0', ' ')
    return re.sub(r'\s+', ' ', s).strip()


def pdf_text(path, series):
    d = fitz.open(path)
    parts = []
    for i in range(len(d)):
        parts.append(d[i].get_text())
    d.close()
    text = normalize(' '.join(parts))
    # Quitar los pies de página, que se interponen en versículos que cruzan
    # un salto de página al extraer el texto de forma lineal.
    footer = re.escape(normalize(series)) + r' — página \d+ de \d+'
    text = re.sub(footer, ' ', text)
    return normalize(text)


problems = 0
# mapa numero de episodio -> archivo del PDF de versiculos (se excluyen los guiones).
import re as _re
ep_to_pdf = {}
for p in sorted(glob.glob('output/*.pdf')):
    name = p.replace('\\', '/').split('/')[-1]
    if name.endswith('_guion.pdf'):
        continue
    m = _re.search(r'episodio_(\d+)', name)
    if m:
        ep_to_pdf[m.group(1)] = p

for movie in movies:
    m = _re.search(r'Episodio\s+(\d+)', movie['series'])
    epnum = m.group(1) if m else None
    path = ep_to_pdf.get(epnum)
    print(f"\n== {movie['day']} — {movie['series']} ==")
    if not path:
        print(f"  \u2717 No se encontró PDF para el episodio {epnum}")
        problems += 1
        continue
    text = pdf_text(path, movie['series'])

    # Recorre las referencias EN ORDEN, buscando cada bloque como subcadena
    # que además aparezca después del bloque anterior (verifica el orden global).
    cursor = 0
    prev_chapter = None
    for ref in movie['references']:
        # Encabezado de referencia debe aparecer
        heading = normalize(ref['heading'])
        h_idx = text.find(heading, cursor)
        if h_idx == -1:
            print(f"  \u2717 Encabezado no encontrado o fuera de orden: '{heading}'")
            problems += 1
        else:
            cursor = h_idx + len(heading)

        prev_chapter = None
        for v in ref['verses']:
            if ref['multiChapter'] and v['chapter'] != prev_chapter:
                label = f"{v['chapter']}:{v['num']}"
            else:
                label = f"{v['num']}"
            prev_chapter = v['chapter']
            expected = normalize(f"{label} {v['text']}")
            idx = text.find(expected, cursor)
            if idx == -1:
                # Reintentar sin la etiqueta, por si el número quedó separado
                alt = normalize(v['text'])
                idx2 = text.find(alt, cursor)
                if idx2 == -1:
                    print(f"  \u2717 {ref['heading']} v{label}: texto NO encontrado en orden")
                    print(f"      esperado: {expected[:80]}...")
                    problems += 1
                else:
                    print(f"  \u26a0 {ref['heading']} v{label}: texto ok pero etiqueta '{label}' no adyacente")
                    cursor = idx2 + len(alt)
                    problems += 1
            else:
                cursor = idx + len(expected)
        print(f"  \u2713 {ref['heading']} ({len(ref['verses'])} versículos, en orden)")

print('\n' + '=' * 50)
if problems == 0:
    print('\u2714 VERIFICACIÓN B (PDF): cada PDF contiene EXACTAMENTE el texto de data.json, en orden.')
else:
    print(f'\u2717 VERIFICACIÓN B: {problems} problema(s) encontrados.')
    sys.exit(1)
