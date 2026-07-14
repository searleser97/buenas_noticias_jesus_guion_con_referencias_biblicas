#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compara, por película, el texto del guion (subtítulos oficiales) contra el
texto bíblico de los versículos que cada escena referencia (bible_scenes.json).

Enfoque:
- Se alinean las palabras del guion con las de la Escritura referenciada
  usando difflib.SequenceMatcher (coincidencia de subsecuencias, respetando
  el orden).
- "Cobertura": fracción de palabras del guion que aparecen textualmente y en
  orden en los versículos referenciados. Es la métrica que responde a
  "¿el guion es lo mismo que el texto bíblico?".
- Las escenas suelen referenciar RELATOS PARALELOS (p. ej. Marcos + Lucas),
  mientras el film narra una sola versión armonizada; por eso habrá
  versículos referenciados que no se pronuncian. Eso NO se cuenta como
  diferencia del guion, solo se informa aparte.
- Solo se listan las escenas donde el guion dice algo que NO está textual en
  la Escritura (palabras añadidas o cambiadas). Si una película no tiene
  ninguna, se indica explícitamente.

Genera un archivo Markdown por película en output/.
"""
import sys
import re
import json
import unicodedata
from difflib import SequenceMatcher

sys.stdout.reconfigure(encoding="utf-8")

WORD_RE = re.compile(r"[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ']+")

# Token = palabra con su puntuación adjunta (signos de apertura/cierre). Así el
# texto base conserva «¿», «?», «¡», «!», comas y puntos, mientras que la
# normalización para alinear (norm) sigue ignorando toda la puntuación.
_LEAD = r"[¿¡«\"'(\[\u2014\u2013\u2026]*"
_TRAIL = r"[?!.,;:»\"')\]\u2014\u2013\u2026]*"
TOKEN_RE = re.compile(_LEAD + r"[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ']+" + _TRAIL)


def slugify(text):
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return text or "pelicula"


def tokenize(text):
    """Devuelve (originales, normalizadas) para alinear por palabra.

    `raw` conserva cada palabra con su puntuación adjunta (para mostrarla tal
    cual en el PDF); `norm` es solo el núcleo de la palabra en minúsculas (para
    emparejar guion y Biblia ignorando puntuación y mayúsculas).
    """
    raw = TOKEN_RE.findall(text or "")
    norm = [WORD_RE.search(t).group(0).lower() for t in raw]
    return raw, norm





def _align_verse(v_norm, s_norm):
    """Alinea un versículo contra el guion.

    Devuelve (score, matched_js, anchor, max_block):
      - matched_js: índices del guion que el versículo cubre (subsecuencia)
      - score: tamaño de matched_js
      - anchor: posición donde empieza a cubrir el guion
      - max_block: longitud del bloque contiguo (verbatim) más largo; sirve
        para exigir una cita literal real al buscar en el corpus.
      - block_start: índice del guion donde empieza ese bloque más largo; se
        usa para anclar (ordenar) los versículos prestados del corpus en el
        lugar donde realmente se cita, no donde coincidan palabras sueltas.
    """
    if not v_norm or not s_norm:
        return 0, set(), 10 ** 9, 0, 10 ** 9
    sm = SequenceMatcher(a=v_norm, b=s_norm, autojunk=False)
    matched = set()
    max_block = 0
    block_start = 10 ** 9
    for block in sm.get_matching_blocks():
        if block.size > max_block:
            max_block = block.size
            block_start = block.b
        for k in range(block.size):
            matched.add(block.b + k)
    anchor = min(matched) if matched else 10 ** 9
    return len(matched), matched, anchor, max_block, block_start


def _collect_verses(refs):
    """Aplana las referencias en una lista de versículos candidatos."""
    seen, out = set(), []
    for r in refs:
        abbrev = _abbrev_from_label(r.get("label", ""))
        label = r.get("label", "").strip()
        for v in r.get("verses", []):
            key = (abbrev, v.get("chapter"), v.get("num"))
            if key in seen:
                continue
            seen.add(key)
            vr, vn = tokenize(v.get("text", ""))
            out.append({"abbrev": abbrev, "chapter": v.get("chapter"),
                        "num": v.get("num"), "raw": vr, "norm": vn,
                        "label": label})
    return out


def _density(idx_set):
    """Qué tan contiguo/denso es un conjunto de índices del guion (0..1)."""
    if not idx_set:
        return 0.0
    span = max(idx_set) - min(idx_set) + 1
    return len(idx_set) / span


def select_spine(s_norm, refs, extra_pool=None):
    """Construye la base MEZCLANDO los relatos referenciados.

    La película arma una versión armonizada: distintas partes del subtítulo
    provienen de distintos evangelios. Aquí, para cada parte del guion se toma
    el versículo (de cualquier libro) que mejor la cubre y se ordenan según la
    narración, de modo que la base se lea como un solo texto continuo.

    Selección voraz por puntuación: cada versículo aceptado debe aportar
    cobertura NUEVA del guion. Así los versículos paralelos redundantes (que
    repiten lo que otro relato ya cubrió) y los versículos que la película no
    usa quedan fuera.

    extra_pool (opcional): corpus de versículos donde buscar el origen de lo
    que dice la película. Idealmente los 4 Evangelios completos (bible_corpus)
    para no depender de que la Guía liste el versículo. Si la película cita un
    texto que la Guía no ubica en esta escena (p. ej. un adelanto de Juan 5:25),
    ese versículo se incorpora a la base para que se muestre como texto bíblico
    y no como añadido, siempre que cubra de forma densa, contigua y verbatim un
    tramo del guion aún no explicado.

    Devuelve (versículos_ordenados, used_labels, skipped_labels).
    """
    cands = _collect_verses(refs)
    for c in cands:
        (c["score"], c["matched"], c["anchor"],
         c["max_block"], _) = _align_verse(c["norm"], s_norm)

    claimed = set()
    accepted = []
    # Se prioriza el bloque verbatim CONTIGUO más largo (lo que la película
    # realmente cita palabra por palabra y en orden), y solo luego la cobertura
    # total. Así, entre relatos paralelos, gana el que respeta el orden del
    # guion (p. ej. Marcos "autoridad para perdonar pecados en la tierra")
    # sobre otro que cubre más palabras pero en distinto orden (Lucas
    # "autoridad en la tierra para perdonar pecados").
    for c in sorted(cands, key=lambda x: (-x["max_block"], -x["score"], x["anchor"])):
        if c["score"] <= 0:
            continue
        new = c["matched"] - claimed
        # Debe aportar al menos 2 palabras nuevas y no ser casi todo solapado
        # (un versículo paralelo cuya parte útil ya cubrió otro relato se cae).
        if len(new) < 2 or len(new) * 2 < c["score"]:
            continue
        claimed |= c["matched"]
        c["anchor"] = min(c["matched"])
        accepted.append(c)

    used_keys = {(c["abbrev"], c["chapter"], c["num"]) for c in accepted}
    own_keys = {(c["abbrev"], c["chapter"], c["num"]) for c in cands}

    # Segunda pasada: busca en el corpus el origen de lo que aún queda sin
    # explicar (lo que se marcaría como añadido). Solo se acepta un versículo
    # "prestado" si es una CITA VERBATIM real: un bloque contiguo largo, denso,
    # que aporta cobertura nueva. Esto evita arrastrar versículos por
    # coincidencias de palabras funcionales dispersas.
    if extra_pool:
        extra = [c for c in extra_pool
                 if (c["abbrev"], c["chapter"], c["num"]) not in own_keys]
        for c in extra:
            (c["score"], c["matched"], c["anchor"],
             c["max_block"], c["block_start"]) = _align_verse(c["norm"], s_norm)
        for c in sorted(extra, key=lambda x: (-x.get("max_block", 0), -x["score"])):
            key = (c["abbrev"], c["chapter"], c["num"])
            if key in used_keys:
                continue
            new = c["matched"] - claimed
            new_block = c.get("max_block", 0)
            if (new_block < 5 or len(new) < 5
                    or len(new) * 2 < c["score"] or _density(new) < 0.5):
                continue
            claimed |= c["matched"]
            # Ancla en el inicio de la cita verbatim, no en coincidencias sueltas.
            c["anchor"] = c["block_start"]
            accepted.append(c)
            used_keys.add(key)

    accepted.sort(key=lambda x: (x["anchor"], x["abbrev"],
                                 x["chapter"] or 0, x["num"] or 0))

    used_labels = list(dict.fromkeys(c["label"] for c in accepted if c["label"]))
    used_keys = {(c["abbrev"], c["chapter"], c["num"]) for c in accepted}
    skipped_labels = []
    for r in refs:
        ab = _abbrev_from_label(r.get("label", ""))
        lab = r.get("label", "").strip()
        used = any((ab, v.get("chapter"), v.get("num")) in used_keys
                   for v in r.get("verses", []))
        if not used and lab and lab not in skipped_labels:
            skipped_labels.append(lab)
    return accepted, used_labels, skipped_labels


ABBR_FULL = {"Mt": "Mateo", "Mr": "Marcos", "Lu": "Lucas", "Jn": "Juan"}


def _abbrev_from_label(label):
    m = re.match(r"\s*([1-3]?\s?[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)", label or "")
    return m.group(1).strip() if m else (label or "").strip()


def build_scene_diff(script_text, refs, extra_pool=None, script_paragraphs=None):
    """Token stream para el PDF, con el TEXTO BÍBLICO como base.

    La base MEZCLA los relatos referenciados (select_spine): verso a verso se
    toma, de cualquier libro, el versículo que mejor cubre esa parte del guion,
    y se ordenan según la narración para leerse como un solo texto. Sobre esa
    base se superpone el guion en estilo control-de-cambios:
      book  -> nombre abreviado del libro (al cambiar de procedencia)
      vnum  -> número de versículo (o 'cap:versículo')
      eq    -> palabra del texto bíblico (también dicha por el guion)
      del   -> palabra del texto bíblico que el guion NO dice (rojo tachado)
      add   -> palabra que el guion AÑADE (verde)
      br    -> salto de línea entre oraciones del guion (formato de guion)

    extra_pool: versículos del resto de la película, para incorporar citas que
    la Guía ubica en otra escena (así no se marcan como añadidas si sí están
    en la Biblia). Ver select_spine.

    script_paragraphs: lista de oraciones/líneas del guion. Cada una es una
    entrada; al cambiar de línea se emite un token 'br' para que el PDF muestre
    el guion línea por línea (más fácil ver quién dice qué).

    El texto base nunca se pierde: cada palabra bíblica aparece (negra si el
    guion la dice, roja tachada si la omite). Las sustituciones se muestran
    como bíblico (rojo) seguido del guion (verde).
    """
    # Tokeniza por línea del guion para saber a qué oración pertenece cada
    # palabra (y poder cortar en 'br'). Si no hay líneas, todo es una sola.
    paras = script_paragraphs if script_paragraphs else [script_text]
    s_raw, s_norm, s_para = [], [], []
    for pi, para in enumerate(paras):
        pr, pn = tokenize(para)
        s_raw += pr
        s_norm += pn
        s_para += [pi] * len(pr)

    verses, used_labels, skipped_labels = select_spine(s_norm, refs, extra_pool)
    if not verses:
        # Sin base: todo el guion es "añadido" (respetando las líneas).
        toks = []
        for j, w in enumerate(s_raw):
            if j > 0 and s_para[j] != s_para[j - 1]:
                toks.append({"t": "br"})
            toks.append({"t": "add", "w": w})
        return toks, used_labels, skipped_labels

    # --- Propiedad por token -------------------------------------------------
    # Cada palabra del guion se asigna al versículo que la "dice" de forma más
    # literal (el bloque contiguo más largo que la contiene). Así, aunque una
    # cita (p. ej. un adelanto de Juan 5:25) parta a la mitad otro versículo,
    # cada palabra queda atribuida a su verdadero origen.
    n = len(s_norm)
    own_v = [None] * n          # índice del versículo dueño de cada palabra
    own_i = [None] * n          # índice de la palabra dentro de ese versículo
    own_strength = [0] * n      # tamaño del bloque contiguo que la reclamó
    for vidx, v in enumerate(verses):
        sm = SequenceMatcher(a=v["norm"], b=s_norm, autojunk=False)
        for block in sm.get_matching_blocks():
            if block.size < 2:
                continue
            for k in range(block.size):
                j = block.b + k
                if block.size > own_strength[j]:
                    own_strength[j] = block.size
                    own_v[j] = vidx
                    own_i[j] = block.a + k

    # Última posición del guion donde se pronuncia cada versículo (para volcar
    # ahí sus palabras no dichas -en rojo- una sola vez).
    last_j = {}
    for j in range(n):
        if own_v[j] is not None:
            last_j[own_v[j]] = j

    tokens = []
    emit_i = [0] * len(verses)   # cuántas palabras de cada versículo ya emitidas
    cur_book = cur_chapter = None
    cur_v = None

    def emit_marker(v):
        nonlocal cur_book, cur_chapter
        if v["abbrev"] != cur_book:
            tokens.append({"t": "book", "w": v["abbrev"]})
            tokens.append({"t": "vnum", "w": f'{v["chapter"]}:{v["num"]}'})
        elif v["chapter"] != cur_chapter:
            tokens.append({"t": "vnum", "w": f'{v["chapter"]}:{v["num"]}'})
        else:
            tokens.append({"t": "vnum", "w": f'{v["num"]}'})
        cur_book, cur_chapter = v["abbrev"], v["chapter"]

    for j in range(n):
        # Salto de línea entre oraciones del guion (formato de guion).
        if j > 0 and s_para[j] != s_para[j - 1]:
            tokens.append({"t": "br"})
        vidx = own_v[j]
        if vidx is None:
            # Palabra que el guion añade (no está en ningún versículo).
            tokens.append({"t": "add", "w": s_raw[j]})
            continue
        v = verses[vidx]
        if vidx != cur_v:
            emit_marker(v)
            cur_v = vidx
        i = own_i[j]
        # Palabras bíblicas saltadas antes de esta (no dichas) -> rojo.
        while emit_i[vidx] < i:
            tokens.append({"t": "del", "w": v["raw"][emit_i[vidx]]})
            emit_i[vidx] += 1
        tokens.append({"t": "eq", "w": v["raw"][i]})
        emit_i[vidx] = i + 1
        # Si es la última aparición de este versículo, vuelca su cola no dicha.
        if last_j.get(vidx) == j:
            while emit_i[vidx] < len(v["raw"]):
                tokens.append({"t": "del", "w": v["raw"][emit_i[vidx]]})
                emit_i[vidx] += 1

    return tokens, used_labels, skipped_labels


def compare_scene(script_text, bible_text):
    s_raw, s_norm = tokenize(script_text)
    b_raw, b_norm = tokenize(bible_text)
    b_set = set(b_norm)
    sm = SequenceMatcher(a=b_norm, b=s_norm, autojunk=False)
    matched_mask = [False] * len(s_norm)
    bible_only = 0      # palabras bíblicas no pronunciadas (paralelos/omitidas)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for j in range(j1, j2):
                matched_mask[j] = True
        elif tag in ("delete", "replace"):
            bible_only += (i2 - i1)
    matched = sum(matched_mask)

    # Palabras del guion presentes en la Escritura sin importar el orden.
    in_bag = sum(1 for w in s_norm if w in b_set)

    # Frases realmente añadidas por el film: palabras consecutivas del guion
    # que NO aparecen en ningún versículo referenciado (ni reordenadas).
    added = []
    cur = []
    for j, w in enumerate(s_norm):
        if w in b_set:
            if cur:
                added.append(" ".join(cur))
                cur = []
        else:
            cur.append(s_raw[j])
    if cur:
        added.append(" ".join(cur))

    coverage = matched / len(s_norm) if s_norm else 1.0
    coverage_bag = in_bag / len(s_norm) if s_norm else 1.0
    return {
        "coverage": coverage,
        "coverage_bag": coverage_bag,
        "script_words": len(s_norm),
        "bible_words": len(b_norm),
        "matched": matched,
        "in_bag": in_bag,
        "bible_only": bible_only,
        "diffs": added,
    }


def render_movie_md(movie):
    lines = []
    title = movie["title"]
    ep = movie["episode"]
    lines.append(f"# Comparación guion ↔ texto bíblico")
    lines.append("")
    lines.append(f"**Episodio {ep}: {title}**")
    if movie.get("series"):
        lines.append(f"*{movie['series']}*")
    lines.append("")
    lines.append(
        "Se compara, palabra por palabra y respetando el orden, el guion de la "
        "película (subtítulos oficiales) con el texto de los versículos que cada "
        "escena referencia en la *Guía de videos*."
    )
    lines.append("")
    lines.append(
        "> **Nota:** muchas escenas citan **relatos paralelos** (p. ej. Mateo, "
        "Marcos y Lucas a la vez), pero la película narra una sola versión "
        "armonizada. Por eso siempre hay versículos referenciados que no se "
        "pronuncian; eso **no** se considera una diferencia del guion, solo se "
        "informa como contexto."
    )
    lines.append("")

    results = []
    for idx, scene in enumerate(movie["scenes"], 1):
        r = compare_scene(scene["scriptText"], scene["bibleText"])
        r["idx"] = idx
        r["description"] = scene["description"]
        r["references"] = scene.get("references", "")
        results.append(r)

    total_words = sum(r["script_words"] for r in results)
    total_matched = sum(r["matched"] for r in results)
    total_bag = sum(r["in_bag"] for r in results)
    overall = total_matched / total_words if total_words else 1.0
    overall_bag = total_bag / total_words if total_words else 1.0

    # Resumen
    scenes_with_diffs = [r for r in results if r["diffs"]]
    lines.append("## Resumen")
    lines.append("")
    lines.append(f"- Escenas analizadas: **{len(results)}**")
    lines.append(
        f"- Palabras del guion textuales y **en el mismo orden** que la Escritura "
        f"referenciada: **{total_matched}/{total_words} ({overall*100:.1f}%)**"
    )
    lines.append(
        f"- Palabras del guion que aparecen en la Escritura referenciada **sin "
        f"importar el orden**: **{total_bag}/{total_words} ({overall_bag*100:.1f}%)**"
    )
    lines.append(
        f"- Escenas con palabras **realmente añadidas** por el film (ausentes de "
        f"la Escritura): **{len(scenes_with_diffs)}**"
    )
    lines.append("")
    lines.append(
        "> La diferencia entre las dos coberturas se debe al **orden**: como el "
        "film armoniza varios evangelios, reordena frases que sí son textuales. "
        "Lo que de verdad no proviene de la Escritura son las palabras listadas "
        "abajo."
    )
    lines.append("")
    lines.append("| # | Escena | En orden | Sin orden | Palabras añadidas |")
    lines.append("|---|--------|----------|-----------|-------------------|")
    for r in results:
        own = sum(len(WORD_RE.findall(d)) for d in r["diffs"])
        desc = r["description"].replace("|", "\\|")
        flag = "" if r["diffs"] else " ✓"
        lines.append(
            f"| {r['idx']} | {desc}{flag} | {r['coverage']*100:.0f}% | "
            f"{r['coverage_bag']*100:.0f}% | {own} |"
        )
    lines.append("")

    if not scenes_with_diffs:
        lines.append("## Diferencias")
        lines.append("")
        lines.append(
            "**No se encontraron palabras añadidas:** cada palabra del guion "
            "aparece en los versículos referenciados (con diferencias solo de "
            "orden por la armonización de los relatos)."
        )
        lines.append("")
        return "\n".join(lines), overall, len(scenes_with_diffs)

    lines.append("## Diferencias por escena")
    lines.append("")
    lines.append(
        "Se listan solo las escenas donde el guion incluye palabras que **no "
        "aparecen en ningún versículo referenciado** (ni reordenadas). Son, en "
        "su mayoría, diálogo ambiental dramatizado: gritos de la multitud, "
        "nombres, interjecciones o conectores narrativos."
    )
    lines.append("")
    for r in scenes_with_diffs:
        lines.append(f"### Escena {r['idx']}: {r['description']}")
        lines.append("")
        lines.append(f"*Referencias:* {r['references']}")
        lines.append("")
        lines.append(
            f"*Cobertura de la escena:* {r['coverage']*100:.1f}% en orden / "
            f"{r['coverage_bag']*100:.1f}% sin orden "
            f"({r['matched']}/{r['script_words']} palabras textuales)"
        )
        lines.append("")
        lines.append("Palabras del guion ausentes de la Escritura referenciada:")
        lines.append("")
        for phrase in r["diffs"]:
            lines.append(f"- «{phrase}»")
        lines.append("")
    return "\n".join(lines), overall, len(scenes_with_diffs)


def _load_corpus():
    """Carga bible_corpus.json (Evangelios completos) como candidatos.

    Cada versículo se convierte a la misma forma que _collect_verses, con una
    etiqueta legible ('Mt 9:13') para poder mostrarlo como referencia si se usa.
    Si el archivo no existe, se devuelve None (se cae al acervo de la película).
    """
    import os
    if not os.path.exists("bible_corpus.json"):
        return None
    with open("bible_corpus.json", "r", encoding="utf-8") as f:
        raw = json.load(f)
    out = []
    for v in raw:
        vr, vn = tokenize(v.get("text", ""))
        out.append({"abbrev": v["abbrev"], "chapter": v["chapter"],
                    "num": v["num"], "raw": vr, "norm": vn,
                    "label": f'{v["abbrev"]} {v["chapter"]}:{v["num"]}'})
    return out


def main():
    with open("bible_scenes.json", "r", encoding="utf-8") as f:
        data = json.load(f)

    import os
    os.makedirs("output", exist_ok=True)

    corpus = _load_corpus()
    if corpus:
        print(f"Corpus de Evangelios: {len(corpus)} versículos (bible_corpus.json).")
    else:
        print("Sin bible_corpus.json: se usará solo el acervo de cada película.")

    diff_out = []
    for movie in data:
        _, overall, n_diffs = render_movie_md(movie)
        print(f"Episodio {movie['episode']}: cobertura {overall*100:.1f}%, "
              f"{n_diffs} escenas con diferencias")
        # Acervo donde buscar el origen de lo que dice la película: el corpus
        # completo de los Evangelios si está disponible; si no, las referencias
        # de todas las escenas de la propia película.
        if corpus is not None:
            pool = corpus
        else:
            pool = []
            for sc in movie["scenes"]:
                pool += _collect_verses(sc.get("refs", []))
        diff_out.append({
            "episode": movie["episode"],
            "day": movie.get("day"),
            "title": movie["title"],
            "series": movie.get("series"),
            "scenes": [
                _scene_diff_entry(sc, pool)
                for sc in movie["scenes"]
            ],
        })

    with open("compare_diff.json", "w", encoding="utf-8") as f:
        json.dump(diff_out, f, ensure_ascii=False, indent=1)
    print("Diff por escena guardado en compare_diff.json")


def _scene_diff_entry(sc, extra_pool=None):
    tokens, used, skipped = build_scene_diff(
        sc["scriptText"], sc.get("refs", []), extra_pool,
        sc.get("scriptParagraphs"))
    return {
        "description": sc["description"],
        "references": sc.get("references", ""),
        "timeStart": sc.get("timeStart"),
        "timeEnd": sc.get("timeEnd"),
        "usedRefs": [l for l in used if l],
        "skippedRefs": [l for l in skipped if l],
        "tokens": tokens,
    }


if __name__ == "__main__":
    main()
