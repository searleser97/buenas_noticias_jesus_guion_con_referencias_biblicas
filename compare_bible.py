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


def slugify(text):
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return text or "pelicula"


def tokenize(text):
    """Devuelve (originales, normalizadas) para alinear por palabra."""
    raw = WORD_RE.findall(text or "")
    norm = [w.lower() for w in raw]
    return raw, norm


def _ref_tokens(ref):
    text = " ".join(v.get("text", "") for v in ref.get("verses", []))
    return tokenize(text)


def select_spine(script_norm, refs):
    """Elige, por escena, los pasajes que la película realmente representa.

    Greedy tipo set-cover: se van seleccionando las referencias que aportan
    más palabras NUEVAS del guion. Los relatos paralelos redundantes (cuyo
    contenido ya cubre otra referencia) no aportan cobertura nueva y quedan
    fuera, así que no se cuentan como 'omitidos'.
    """
    from collections import Counter
    toklist = [(_ref_tokens(r), r.get("label", "")) for r in refs]
    remaining = Counter(script_norm)
    selected = [False] * len(refs)
    threshold = max(3, int(0.10 * len(script_norm)))

    def contribution(nl):
        c = Counter(nl)
        return sum(min(remaining[w], c[w]) for w in c)

    while True:
        best, besti = -1, -1
        for i, ((rraw, rnorm), lab) in enumerate(toklist):
            if selected[i]:
                continue
            contr = contribution(rnorm)
            if contr > best:
                best, besti = contr, i
        if besti < 0:
            break
        if best < threshold and any(selected):
            break
        selected[besti] = True
        for w in toklist[besti][0][1]:
            if remaining[w] > 0:
                remaining[w] -= 1
    return selected


def build_scene_diff(script_text, refs):
    """Token stream para el PDF: eq=igual, add=añadido por el guion,
    del=omitido de la Escritura representada. Los pasajes paralelos que la
    película no siguió no se consideran (no generan 'del')."""
    s_raw, s_norm = tokenize(script_text)
    s_set = set(s_norm)
    # Verde: una palabra del guion es 'añadida' solo si no aparece en NINGÚN
    # versículo referenciado (ni siquiera en un relato paralelo).
    union_set = set()
    for r in refs:
        union_set |= set(_ref_tokens(r)[1])

    selected = select_spine(s_norm, refs)
    b_raw, b_norm = [], []
    used_labels, skipped_labels = [], []
    for i, r in enumerate(refs):
        rr, rn = _ref_tokens(r)
        if selected[i]:
            b_raw += rr
            b_norm += rn
            used_labels.append(r.get("label", "").strip())
        else:
            skipped_labels.append(r.get("label", "").strip())

    sm = SequenceMatcher(a=b_norm, b=s_norm, autojunk=False)
    tokens = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for j in range(j1, j2):
                tokens.append({"t": "eq", "w": s_raw[j]})
        elif tag == "insert":
            for j in range(j1, j2):
                tokens.append({"t": "add" if s_norm[j] not in union_set else "eq", "w": s_raw[j]})
        elif tag == "delete":
            for i in range(i1, i2):
                if b_norm[i] not in s_set:
                    tokens.append({"t": "del", "w": b_raw[i]})
        elif tag == "replace":
            for j in range(j1, j2):
                tokens.append({"t": "add" if s_norm[j] not in union_set else "eq", "w": s_raw[j]})
            for i in range(i1, i2):
                if b_norm[i] not in s_set:
                    tokens.append({"t": "del", "w": b_raw[i]})
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


def main():
    with open("bible_scenes.json", "r", encoding="utf-8") as f:
        data = json.load(f)

    import os
    os.makedirs("output", exist_ok=True)

    diff_out = []
    for movie in data:
        md, overall, n_diffs = render_movie_md(movie)
        slug = slugify(movie["title"])
        fname = f"output/episodio_{movie['episode']}_{slug}_comparacion.md"
        with open(fname, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"Episodio {movie['episode']}: cobertura {overall*100:.1f}%, "
              f"{n_diffs} escenas con diferencias -> {fname}")
        diff_out.append({
            "episode": movie["episode"],
            "day": movie.get("day"),
            "title": movie["title"],
            "series": movie.get("series"),
            "scenes": [
                _scene_diff_entry(sc)
                for sc in movie["scenes"]
            ],
        })

    with open("compare_diff.json", "w", encoding="utf-8") as f:
        json.dump(diff_out, f, ensure_ascii=False, indent=1)
    print("Diff por escena guardado en compare_diff.json")


def _scene_diff_entry(sc):
    tokens, used, skipped = build_scene_diff(sc["scriptText"], sc.get("refs", []))
    return {
        "description": sc["description"],
        "references": sc.get("references", ""),
        "usedRefs": [l for l in used if l],
        "skippedRefs": [l for l in skipped if l],
        "tokens": tokens,
    }


if __name__ == "__main__":
    main()
