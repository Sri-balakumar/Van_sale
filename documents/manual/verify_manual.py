"""
Verify the generated manual against the measured house style.

    py -3.14 documents/manual/verify_manual.py

Unzips the .docx, asserts every construct, then checks the rendered PDF and
sweeps every artefact for names that must not appear. Prints PASS/FAIL per
check and exits non-zero if anything failed.

Two rules shape how the assertions are written.

First, elements are located by their distinctive *formatting*, never by their
text. Heading wording recurs inside the Quick Reference tables and the callouts,
so a text search finds decoys and reports failures that are not real.

Second, the expected values come from `SPEC` in build_manual.py rather than
being retyped here. A checker with its own copy of the numbers passes happily
while the generator drifts away from the spec underneath it.
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

import fitz  # PyMuPDF - stands in for pdftotext, which is not on this machine
from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_manual import SPEC, BRAND, PRODUCT  # noqa: E402

HERE = Path(__file__).resolve().parent
MD = HERE / "van-sale-user-manual.md"
PY = HERE / "build_manual.py"
PS1 = HERE / "build-manual.ps1"
DOCX = HERE / "van-sale-user-manual.docx"
PDF = HERE / "van-sale-user-manual.pdf"
MANIFEST = HERE / "screenshots" / "manifest.json"

BANNED = ["Golden Spoon Vegetables", "Hilal Khamis Najan"]

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
EMU_PER_INCH = 914400

results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, detail: str = "") -> bool:
    results.append((bool(ok), name, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {detail}" if detail else ""))
    return bool(ok)


def section(title: str) -> None:
    print(f"\n{title}\n{'-' * len(title)}")


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def load_docx():
    zf = zipfile.ZipFile(DOCX)
    parts = {n: zf.read(n) for n in zf.namelist()}
    doc = etree.fromstring(parts["word/document.xml"])
    rels = etree.fromstring(parts["word/_rels/document.xml.rels"])
    rel_map = {r.get("Id"): r.get("Target") for r in rels}
    return parts, doc, rel_map


def attr(el, name: str):
    return el.get(W + name) if el is not None else None


def ppr(p):
    return p.find(W + "pPr")


def fill_of(el) -> str | None:
    """Background fill on a paragraph, cell or run properties element."""
    if el is None:
        return None
    shd = el.find(W + "shd")
    return attr(shd, "fill") if shd is not None else None


def para_fill(p) -> str | None:
    return fill_of(ppr(p))


def text_of(el) -> str:
    return "".join(el.itertext())


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


# --------------------------------------------------------------------------
# Locators - each returns the elements matching one construct's fingerprint
# --------------------------------------------------------------------------

def find_banners(body):
    """The part banner is the only thing filled with the banner colour."""
    return [p for p in body.iter(W + "p") if para_fill(p) == SPEC["banner_fill"]]


def find_step_badges(body):
    """The badge is the only run carrying character shading."""
    out = []
    for r in body.iter(W + "r"):
        rPr = r.find(W + "rPr")
        if rPr is not None and fill_of(rPr) == SPEC["accent"]:
            out.append(r)
    return out


def find_heading2(body):
    out = []
    for p in body.iter(W + "p"):
        pr = ppr(p)
        if pr is None:
            continue
        st = pr.find(W + "pStyle")
        sp = pr.find(W + "spacing")
        if attr(st, "val") == "Heading2" and attr(sp, "before") == "280":
            out.append(p)
    return out


def tbl_cell_borders(tbl):
    """Border sides declared on the single cell of a one-by-one table."""
    tc = tbl.find(f"{W}tr/{W}tc")
    if tc is None:
        return None, None
    tcPr = tc.find(W + "tcPr")
    if tcPr is None:
        return None, None
    b = tcPr.find(W + "tcBorders")
    sides = {etree.QName(c).localname: c for c in b} if b is not None else {}
    return sides, fill_of(tcPr)


def classify_tables(body):
    """Split every table into callouts, closing banners, figures and data tables."""
    callouts, banners, figures, data = [], [], [], []
    for tbl in body.iter(W + "tbl"):
        sides, fill = tbl_cell_borders(tbl)
        grid = [int(g.get(W + "w")) for g in tbl.findall(f"{W}tblGrid/{W}gridCol")]
        has_img = tbl.find(f".//{WP}extent") is not None
        is_plate = len(grid) == 1 and grid[0] == SPEC["fig_cell_w"]

        if is_plate:
            figures.append(tbl)
        elif sides and set(sides) == {"left"} and fill == SPEC["callout_fill"]:
            callouts.append(tbl)
        elif sides and set(sides) == {"left"} and fill == SPEC["tbl_head_fill"]:
            banners.append(tbl)
        else:
            data.append(tbl)
    return callouts, banners, figures, data


def find_bullets(body):
    out = []
    for p in body.iter(W + "p"):
        pr = ppr(p)
        if pr is None:
            continue
        ind = pr.find(W + "ind")
        # python-docx writes the hanging indent as a negative first-line indent.
        if ind is not None and attr(ind, "firstLine") is None:
            hanging = attr(ind, "hanging")
            if hanging == str(SPEC["bullet_hanging"]):
                out.append(p)
    return out


# --------------------------------------------------------------------------
# Counting the source, so the document can be checked against its own content
# --------------------------------------------------------------------------

def md_counts():
    text = MD.read_text(encoding="utf-8")
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)   # drop the dialect note
    lines = [ln.strip() for ln in text.splitlines()]
    figure = re.compile(r"^\|\s*IMAGE\s+\d+\s*\|")
    return {
        "books": sum(1 for ln in lines if ln.startswith("%% BOOK:")),
        "parts": sum(1 for ln in lines if ln.startswith("# ")),
        "h2": sum(1 for ln in lines if ln.startswith("## ")),
        "steps": sum(1 for ln in lines if ln.startswith("### ")),
        "bullets": sum(1 for ln in lines if ln.startswith("- ")),
        "callouts": sum(1 for ln in lines if ln.startswith("> ")),
        "figures": sum(1 for ln in lines if figure.match(ln)),
        "closing_banners": sum(1 for ln in lines if ln.startswith("=== ")),
        "step_titles": [
            re.sub(r"^Step\s+\d+\s+", "", ln[4:].strip())
            for ln in lines if ln.startswith("### ")
        ],
    }


# --------------------------------------------------------------------------
# The checks
# --------------------------------------------------------------------------

def verify_docx(parts, doc, rel_map, md):
    body = doc.find(W + "body")
    sect_prs = list(body.iter(W + "sectPr"))

    section("Page geometry")
    ok_geom = True
    for i, sp in enumerate(sect_prs):
        sz, mar = sp.find(W + "pgSz"), sp.find(W + "pgMar")
        good = (
            attr(sz, "w") == str(SPEC["page_w"]) and attr(sz, "h") == str(SPEC["page_h"])
            and all(attr(mar, s) == str(SPEC["margin"]) for s in ("top", "right", "bottom", "left"))
            and attr(mar, "header") == str(SPEC["hf_distance"])
            and attr(mar, "footer") == str(SPEC["hf_distance"])
        )
        ok_geom &= good
    check(ok_geom, "every section is Letter with 1in margins and 0.5in header/footer reserve",
          f"{len(sect_prs)} sections")
    check(len(sect_prs) == 2 * md["books"], "two sections per book (bare cover, then body)",
          f"{len(sect_prs)} sections for {md['books']} books")

    section("Header and footer")
    # Sections alternate cover, body, cover, body. Covers must carry neither.
    cover_clean, body_chrome = True, True
    for i, sp in enumerate(sect_prs):
        texts = {}
        for kind in ("headerReference", "footerReference"):
            ref = sp.find(W + kind)
            if ref is None:
                texts[kind] = ""
                continue
            target = rel_map.get(ref.get(R + "id"), "")
            blob = parts.get(f"word/{target}")
            texts[kind] = norm(text_of(etree.fromstring(blob))) if blob else ""
        if i % 2 == 0:
            cover_clean &= (texts["headerReference"] == "" and texts["footerReference"] == "")
        else:
            body_chrome &= (PRODUCT in texts["headerReference"] and BRAND in texts["headerReference"]
                            and BRAND in texts["footerReference"])
    check(cover_clean, "cover sections carry no header and no footer")
    check(body_chrome, "body sections carry the product/brand header and the brand footer")

    hdrs = [n for n in parts if re.match(r"word/header\d+\.xml", n)]
    ftrs = [n for n in parts if re.match(r"word/footer\d+\.xml", n)]

    hdr_ok = False
    for n in hdrs:
        root = etree.fromstring(parts[n])
        for p in root.iter(W + "p"):
            pr = ppr(p)
            bdr = pr.find(W + "pBdr") if pr is not None else None
            bot = bdr.find(W + "bottom") if bdr is not None else None
            if attr(bot, "color") == SPEC["rule"]:
                hdr_ok = True
    check(hdr_ok, "running header has the accent rule beneath it")

    ftr_ok = False
    for n in ftrs:
        root = etree.fromstring(parts[n])
        paras = root.findall(W + "p")
        instr = " ".join(t.text or "" for t in root.iter(W + "instrText"))
        bdr_top = any(
            attr((ppr(p).find(W + "pBdr") if ppr(p) is not None else None), "x") is None
            and ppr(p) is not None
            and ppr(p).find(W + "pBdr") is not None
            and attr(ppr(p).find(W + "pBdr").find(W + "top"), "color") == SPEC["rule"]
            for p in paras
        )
        if len(paras) == 2 and "PAGE" in instr and "NUMPAGES" in instr and bdr_top:
            ftr_ok = True
    check(ftr_ok, "footer is two paragraphs with a rule, a PAGE field and a NUMPAGES field")

    section("Headings")
    banners = find_banners(body)
    good = all(
        attr(ppr(p).find(W + "ind"), "left") == str(SPEC["banner_indent"])
        and attr(ppr(p).find(W + "pStyle"), "val") == "Heading1"
        and any(attr(r.find(f"{W}rPr/{W}color"), "val") == "FFFFFF" for r in p.iter(W + "r"))
        for p in banners
    )
    check(banners and good, "part banners: filled, negative-indented, reversed out, Heading 1",
          f"{len(banners)} found")
    check(len(banners) == md["parts"], "every PART in the source became a banner",
          f"{len(banners)} of {md['parts']}")

    badges = find_step_badges(body)
    shaped = [b for b in badges if re.fullmatch(r" Step \d+ ", text_of(b))]
    check(len(shaped) == len(badges) and badges, "step badges are run-shaded chips reading ' Step n '",
          f"{len(shaped)} found")
    check(len(badges) == md["steps"], "every step in the source got a badge",
          f"{len(badges)} of {md['steps']}")

    h2 = find_heading2(body)
    check(len(h2) == md["h2"], "every '##' became a Heading 2", f"{len(h2)} of {md['h2']}")

    section("Boxes and tables")
    callouts, cbanners, figures, data = classify_tables(body)

    callout_ok = True
    for t in callouts:
        sides, _ = tbl_cell_borders(t)
        callout_ok &= attr(sides["left"], "sz") == str(SPEC["callout_border_sz"]) \
            and attr(sides["left"], "color") == SPEC["callout_border"]
    check(callouts and callout_ok, "callouts: left rule only, amber, on the amber fill",
          f"{len(callouts)} found")
    check(len(callouts) == md["callouts"], "every callout in the source is present",
          f"{len(callouts)} of {md['callouts']}")

    banner_ok = all(attr(tbl_cell_borders(t)[0]["left"], "color") == SPEC["accent"] for t in cbanners)
    check(cbanners and banner_ok, "closing banners: left rule in accent, on the pale fill",
          f"{len(cbanners)} found")
    check(len(cbanners) == md["closing_banners"], "one closing banner per book",
          f"{len(cbanners)} of {md['closing_banners']}")

    data_ok, header_rows, grids_ok = True, True, True
    for t in data:
        tblPr = t.find(W + "tblPr")
        b = tblPr.find(W + "tblBorders") if tblPr is not None else None
        data_ok &= b is not None and all(
            attr(b.find(W + s), "color") == SPEC["tbl_border"]
            for s in ("top", "left", "bottom", "right", "insideH", "insideV")
        )
        first = t.find(W + "tr")
        header_rows &= first is not None and first.find(f"{W}trPr/{W}tblHeader") is not None
        grid = [int(g.get(W + "w")) for g in t.findall(f"{W}tblGrid/{W}gridCol")]
        grids_ok &= sum(grid) == SPEC["content_w"]
    check(data and data_ok, "data tables are ruled in the table-border colour", f"{len(data)} found")
    check(header_rows, "every data table repeats its header row across pages")
    check(grids_ok, f"every data table grid sums to the {SPEC['content_w']}-twip content width")

    section("Figures")
    fig_ok, fit_ok = True, True
    for t in figures:
        sides, fill = tbl_cell_borders(t)
        fig_ok &= fill == SPEC["fig_fill"] and set(sides) == {"top", "left", "bottom", "right"} \
            and all(attr(s, "color") == SPEC["fig_border"] for s in sides.values())
        for ext in t.iter(WP + "extent"):
            w = int(ext.get("cx")) / EMU_PER_INCH
            h = int(ext.get("cy")) / EMU_PER_INCH
            fit_ok &= w <= SPEC["fig_max_w_in"] + 0.01 and h <= SPEC["fig_max_h_in"] + 0.01
    check(figures and fig_ok, "figure plates: bordered all round, on the pale-blue fill",
          f"{len(figures)} found")
    check(len(figures) == md["figures"], "every IMAGE slot in the source became a plate",
          f"{len(figures)} of {md['figures']}")
    check(fit_ok, f"every embedded image fits the {SPEC['fig_max_w_in']}x{SPEC['fig_max_h_in']}in plate")

    section("Bullets")
    bullets = find_bullets(body)
    glyph_ok = all(text_of(p).lstrip().startswith(SPEC["bullet_glyph"]) for p in bullets)
    check(bullets and glyph_ok, "bullets are hanging-indent paragraphs led by the bullet glyph",
          f"{len(bullets)} found")
    check(len(bullets) == md["bullets"], "every bullet in the source is present",
          f"{len(bullets)} of {md['bullets']}")

    section("Cover")
    covers = [
        p for p in body.iter(W + "p")
        if any(r.find(f"{W}rPr/{W}caps") is not None for r in p.iter(W + "r"))
    ]
    cover_ok = all(
        any(attr(r.find(f"{W}rPr/{W}color"), "val") == SPEC["navy"]
            and attr(r.find(f"{W}rPr/{W}sz"), "val") == str(SPEC["sz_title"])
            for r in p.iter(W + "r"))
        for p in covers
    )
    check(len(covers) == md["books"] and cover_ok,
          "one all-caps navy title per book at the cover size", f"{len(covers)} found")

    rules = [
        p for p in body.iter(W + "p")
        if ppr(p) is not None and ppr(p).find(W + "pBdr") is not None
        and attr(ppr(p).find(W + "pBdr").find(W + "bottom"), "color") == SPEC["rule"]
    ]
    check(len(rules) == 2 * md["books"], "two accent rules on each cover", f"{len(rules)} found")

    section("Styled-run hygiene")
    # On a *run*, val="0" does not mean "not bold" - it actively cancels the
    # bold that Heading 1/2/3 supplies, silently un-bolding every heading. So
    # this is scoped to the content parts, where runs live.
    #
    # It deliberately does not cover styles.xml: a style definition saying "this
    # band is not bold" is a legitimate declaration, and python-docx's stock
    # template ships a dozen unused table styles that do exactly that. Failing
    # on those would be a false alarm about a part of the file we never author.
    content = [n for n in parts if re.match(r"word/(document|header\d+|footer\d+)\.xml$", n)]
    offenders = []
    for name in content:
        blob = parts[name].decode("utf-8", "replace")
        for tag in ("b", "i", "u"):
            if re.search(rf'<w:{tag} w:val="(0|false|none)"', blob):
                offenders.append(f"{name}:{tag}")
    check(not offenders, "no run in the document, headers or footers cancels bold/italic/underline",
          ", ".join(offenders) if offenders else f"{len(content)} content parts clean")

    # The other half of the same concern, asserted positively: the bold supply
    # those runs must not cancel has to actually be there in the first place.
    styles = etree.fromstring(parts["word/styles.xml"])
    bold_ok = True
    for sid in ("Heading1", "Heading2", "Heading3"):
        st = next((s for s in styles.findall(W + "style") if s.get(W + "styleId") == sid), None)
        b = st.find(f"{W}rPr/{W}b") if st is not None else None
        bold_ok &= b is not None and attr(b, "val") not in ("0", "false", "none")
    check(bold_ok, "Heading 1/2/3 still supply bold to the banners, sections and steps")


def verify_pdf(md):
    section("Rendered PDF")
    doc = fitz.open(PDF)
    check(doc.page_count > 0, "PDF has pages", f"{doc.page_count} pages")

    outline = doc.get_toc()
    titles = [t[1] for t in outline]
    parts = [t for t in titles if t.strip().upper().startswith("PART")]
    steps = [t for t in titles if re.match(r"^\s*Step\s+\d+", t.strip())]
    check(bool(outline), "PDF carries a navigation outline", f"{len(outline)} entries")
    check(len(parts) >= 2, "outline shows the PART level", f"{len(parts)} PART entries")
    check(len(steps) >= 2, "outline shows the Step level", f"{len(steps)} Step entries")

    text = norm("\n".join(page.get_text() for page in doc))
    missing = [t for t in md["step_titles"] if norm(t) not in text]
    check(not missing, "every step heading survived into the PDF",
          f"{len(missing)} missing: {missing[:3]}" if missing else f"{len(md['step_titles'])} checked")
    doc.close()
    return text


def verify_names(parts, pdf_text):
    section("Banned-name sweep")
    sources = {
        MD.name: MD.read_text(encoding="utf-8"),
        PY.name: PY.read_text(encoding="utf-8"),
        PS1.name: PS1.read_text(encoding="utf-8"),
        MANIFEST.name: MANIFEST.read_text(encoding="utf-8"),
        "docx xml": "\n".join(
            b.decode("utf-8", "replace") for n, b in parts.items() if n.endswith(".xml")
        ),
        "docx media names": "\n".join(parts),
        "pdf text": pdf_text,
    }
    for banned in BANNED:
        # Match the name however it is punctuated - spaced, hyphenated, or run
        # together as it would be inside an identifier.
        pattern = re.compile(r"[\s\-_.]*".join(map(re.escape, banned.split())), re.I)
        hits = [where for where, blob in sources.items() if pattern.search(blob)]
        check(not hits, f'"{banned}" appears nowhere',
              "found in " + ", ".join(hits) if hits else "md, py, ps1, manifest, docx, pdf all clean")


def main():
    for f in (MD, PY, PS1, DOCX, PDF):
        if not f.exists():
            sys.exit(f"Missing {f} - run build-manual.ps1 first")

    print(f"Verifying {DOCX.name} and {PDF.name}")
    md = md_counts()
    parts, doc, rel_map = load_docx()

    verify_docx(parts, doc, rel_map, md)
    pdf_text = verify_pdf(md)
    verify_names(parts, pdf_text)

    failed = [r for r in results if not r[0]]
    print(f"\n{'=' * 60}")
    print(f"{len(results) - len(failed)} passed, {len(failed)} failed")
    if failed:
        for _, name, detail in failed:
            print(f"  FAILED: {name}" + (f"  -- {detail}" if detail else ""))
        sys.exit(1)
    print("All checks green.")


if __name__ == "__main__":
    main()
