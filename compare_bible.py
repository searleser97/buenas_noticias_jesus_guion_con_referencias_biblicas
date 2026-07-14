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


def _group_refs_by_book(refs):
    """Agrupa las referencias de una escena por libro (relato)."""
    groups, order = {}, []
    for r in refs:
        ab = _abbrev_from_label(r.get("label", ""))
        if ab not in groups:
            groups[ab] = []
            order.append(ab)
        groups[ab].append(r)
    return [(ab, groups[ab]) for ab in order]


def select_base_account(s_norm, refs):
    """Elige el ÚNICO relato (libro) que la película sigue más de cerca.

    Sin relatos paralelos: se puntúa cada libro por cuántas palabras del guion
    explica (coincidencia en orden) y se toma el de mayor puntuación como base.
    Devuelve (refs_base, refs_descartadas).
    """
    groups = _group_refs_by_book(refs)
    if not groups:
        return [], []
    best_ab, best_score = groups[0][0], -1
    for ab, grp in groups:
        toks = []
        for r in grp:
            toks += _ref_tokens(r)[1]
        sm = SequenceMatcher(a=toks, b=s_norm, autojunk=False)
        score = sum(i2 - i1 for tag, i1, i2, _, _ in sm.get_opcodes() if tag == "equal")
        if score > best_score:
            best_ab, best_score = ab, score
    base_refs, others = [], []
    for ab, grp in groups:
        (base_refs if ab == best_ab else others).extend(grp)
    return base_refs, others


ABBR_FULL = {"Mt": "Mateo", "Mr": "Marcos", "Lu": "Lucas", "Jn": "Juan"}


def _abbrev_from_label(label):
    m = re.match(r"\s*([1-3]?\s?[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)", label or "")
    return m.group(1).strip() if m else (label or "").strip()


def build_scene_diff(script_text, refs):
    """Token stream para el PDF, con el TEXTO BÍBLICO como base.

    Se toma un solo relato (select_base_account) y se muestra su texto
    completo, versículo por versículo, en orden. El guion se superpone:
      book  -> nombre abreviado del libro
      vnum  -> número de versículo (o 'cap:versículo')
      eq    -> palabra del texto bíblico (también dicha por el guion)
      del   -> palabra del texto bíblico que el guion NO dice (rojo)
      add   -> palabra que el guion AÑADE (ausente del relato base, verde)

    El texto base nunca se pierde: cada palabra bíblica aparece (negra si el
    guion la dice, roja tachada si la omite). Las palabras que el guion añade
    aparecen en verde, en estilo control-de-cambios (sustituciones = bíblico
    rojo seguido del guion verde).
    """
    s_raw, s_norm = tokenize(script_text)

    base_refs, other_refs = select_base_account(s_norm, refs)
    used_labels = [r.get("label", "").strip() for r in base_refs]
    skipped_labels = [r.get("label", "").strip() for r in other_refs]

    # Texto base: versículos del relato elegido, ordenados y sin duplicar.
    seen = set()
    verses = []  # {abbrev, chapter, num, raw, norm}
    for r in base_refs:
        abbrev = _abbrev_from_label(r.get("label", ""))
        for v in r.get("verses", []):
            key = (abbrev, v.get("chapter"), v.get("num"))
            if key in seen:
                continue
            seen.add(key)
            vr, vn = tokenize(v.get("text", ""))
            verses.append({"abbrev": abbrev, "chapter": v.get("chapter"),
                           "num": v.get("num"), "raw": vr, "norm": vn})
    verses.sort(key=lambda x: (x["abbrev"], x["chapter"] or 0, x["num"] or 0))

    b_raw, b_norm, b_vid, verses_meta = [], [], [], []
    for v in verses:
        vid = len(verses_meta)
        verses_meta.append({"abbrev": v["abbrev"], "chapter": v["chapter"], "num": v["num"]})
        for w, n in zip(v["raw"], v["norm"]):
            b_raw.append(w)
            b_norm.append(n)
            b_vid.append(vid)

    sm = SequenceMatcher(a=b_norm, b=s_norm, autojunk=False)
    raw_tokens = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                raw_tokens.append({"t": "eq", "w": b_raw[i1 + k], "vid": b_vid[i1 + k]})
        elif tag == "delete":
            # Palabra bíblica que el guion no dice aquí -> rojo tachado.
            for i in range(i1, i2):
                raw_tokens.append({"t": "del", "w": b_raw[i], "vid": b_vid[i]})
        elif tag == "insert":
            # Palabra que el guion añade -> verde.
            for j in range(j1, j2):
                raw_tokens.append({"t": "add", "w": s_raw[j], "vid": None})
        elif tag == "replace":
            # Sustitución: primero lo bíblico (rojo), luego lo del guion (verde).
            for i in range(i1, i2):
                raw_tokens.append({"t": "del", "w": b_raw[i], "vid": b_vid[i]})
            for j in range(j1, j2):
                raw_tokens.append({"t": "add", "w": s_raw[j], "vid": None})

    # Inserta marcadores de versículo/libro al cambiar la procedencia.
    tokens = []
    cur_vid, cur_book = None, None
    for tk in raw_tokens:
        vid = tk["vid"]
        if vid is not None and vid != cur_vid:
            meta = verses_meta[vid]
            prev_chapter = verses_meta[cur_vid]["chapter"] if cur_vid is not None else None
            if meta["abbrev"] != cur_book:
                tokens.append({"t": "book", "w": meta["abbrev"]})
                tokens.append({"t": "vnum", "w": f'{meta["chapter"]}:{meta["num"]}'})
            elif meta["chapter"] != prev_chapter:
                tokens.append({"t": "vnum", "w": f'{meta["chapter"]}:{meta["num"]}'})
            else:
                tokens.append({"t": "vnum", "w": f'{meta["num"]}'})
            cur_vid, cur_book = vid, meta["abbrev"]
        tokens.append({"t": tk["t"], "w": tk["w"]})

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
        _, overall, n_diffs = render_movie_md(movie)
        print(f"Episodio {movie['episode']}: cobertura {overall*100:.1f}%, "
              f"{n_diffs} escenas con diferencias")
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
