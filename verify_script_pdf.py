import sys, json, re, unicodedata, fitz
sys.stdout.reconfigure(encoding='utf-8')

def toks(s):
    s = s.lower()
    return [t for t in re.split(r'[^0-9a-záéíóúñü]+', s) if t]

def slug(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'[^a-zA-Z0-9]+', '_', s).strip('_').lower()
    return s

def pdf_name(ep, i):
    if ep.get('daySlug'):
        return f"{ep.get('fileIndex', i)}_{ep['daySlug']}_episodio_{ep['episode']}_guion.pdf"
    return f"episodio_{ep['episode']}_{slug(ep['title'])}_guion.pdf"

data = json.load(open('script_data.json', encoding='utf-8'))
allok = True
for i, ep in enumerate(data, 1):
    path = 'output/' + pdf_name(ep, i)
    d = fitz.open(path)
    pdf_lines = []
    for pg in d:
        for line in pg.get_text().splitlines():
            if 'guion — página' in line:  # quitar pie de página
                continue
            pdf_lines.append(line)
    pdf_toks = toks(' '.join(pdf_lines))
    script_toks = []
    for sc in ep['scenes']:
        for p in sc['paragraphs']:
            script_toks += toks(p)
    # ¿script_toks es subsecuencia (en orden) de pdf_toks?
    j = 0
    missing = None
    for t in script_toks:
        found = False
        while j < len(pdf_toks):
            if pdf_toks[j] == t:
                j += 1; found = True; break
            j += 1
        if not found:
            missing = t; break
    ok = missing is None
    allok = allok and ok
    print(f"Episodio {ep['episode']}: guion={len(script_toks)} palabras | "
          + ("TODAS presentes en el PDF, en orden" if ok else "FALTA: " + repr(missing)))

print('\n' + ('OK: todos los subtítulos aparecen en los PDFs.' if allok else 'HAY PALABRAS FALTANTES.'))
sys.exit(0 if allok else 1)

