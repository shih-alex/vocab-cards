"""Build a single self-contained file: dist/單字卡.html

    python build.py

Reads index.html and
  - inlines style.css into <style>
  - inlines core.js, sample.js and app.js into <script> elements, preceded by
    <script>window.VC_SINGLE_FILE=true</script>
  - removes the manifest link (a web app manifest cannot work from a single file)
  - turns the icon / apple-touch-icon links into data: URIs

Tags are matched by their attributes, so attribute order, quoting, extra
whitespace and a "./" prefix don't matter. If an expected tag is missing (or
appears twice) the build stops with an error instead of writing a broken file.
"""

from __future__ import annotations

import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "index.html"
OUT = ROOT / "dist" / "單字卡.html"
SCRIPTS = ["core.js", "sample.js", "app.js"]
SINGLE_FILE_FLAG = "<script>window.VC_SINGLE_FILE=true</script>"
MIME = {".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}

TAG_RE = re.compile(r"<(link|script)\b((?:[^>\"']|\"[^\"]*\"|'[^']*')*)>", re.IGNORECASE)
ATTR_RE = re.compile(r"""([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?""")
SCRIPT_END_RE = re.compile(r"\s*</script\s*>", re.IGNORECASE)


class BuildError(Exception):
    pass


class Tag:
    """One <link> or <script src> tag found in the HTML (span covers the whole element)."""

    def __init__(self, name: str, start: int, end: int, raw: str, attr_text: str, attr_offset: int):
        self.name = name.lower()
        self.start, self.end, self.raw = start, end, raw
        self.attrs: dict[str, str] = {}
        self.attr_spans: dict[str, tuple[int, int]] = {}  # relative to self.start
        for m in ATTR_RE.finditer(attr_text):
            key = m.group(1).lower()
            val = next((g for g in m.group(2, 3, 4) if g is not None), "")
            if key not in self.attrs:
                self.attrs[key] = val
                self.attr_spans[key] = (attr_offset + m.start(), attr_offset + m.end())

    def ref(self, attr: str) -> str:
        """Normalised local path of href/src: no query/fragment, no leading './'."""
        v = self.attrs.get(attr, "").strip()
        v = re.split(r"[?#]", v, maxsplit=1)[0]
        while v.startswith("./"):
            v = v[2:]
        return v

    def rel(self) -> set[str]:
        return set(self.attrs.get("rel", "").lower().split())

    def with_attr(self, attr: str, value: str) -> str:
        """The tag text with one attribute's value replaced."""
        a, b = self.attr_spans[attr]
        return self.raw[:a] + f'{attr}="{value}"' + self.raw[b:]


def find_tags(html: str) -> list[Tag]:
    """All <link> tags and empty <script src> elements, skipping HTML comments and
    the contents of inline <script>/<style> elements."""
    tags = []
    pos = 0
    skip_re = re.compile(r"<!--|<(script|style)\b", re.IGNORECASE)
    while True:
        m = TAG_RE.search(html, pos)
        if not m:
            break
        s = skip_re.search(html, pos, m.start() + 1)
        if s and s.group(0) == "<!--":
            close = html.find("-->", s.end())
            pos = len(html) if close == -1 else close + 3
            continue
        if s and s.group(1) and s.group(1).lower() == "style":
            close = re.compile(r"</style\s*>", re.IGNORECASE).search(html, s.end())
            pos = len(html) if not close else close.end()
            continue

        name, attr_text = m.group(1), m.group(2)
        start, end = m.start(), m.end()
        pos = end
        if name.lower() == "script":
            close = SCRIPT_END_RE.match(html, end)
            if not close:
                # Inline script with content: not ours to touch; skip past its body.
                close = re.compile(r"</script\s*>", re.IGNORECASE).search(html, end)
                pos = len(html) if not close else close.end()
                continue
            end = pos = close.end()
        attr_offset = m.start(2) - m.start()
        tags.append(Tag(name, start, end, html[start:end], attr_text, attr_offset))
    return tags


def find_one(tags: list[Tag], what: str, pred) -> Tag:
    hits = [t for t in tags if pred(t)]
    if len(hits) != 1:
        problem = "not found" if not hits else f"found {len(hits)} times"
        raise BuildError(f"index.html: {what} {problem}")
    return hits[0]


def read_text(name: str) -> str:
    path = ROOT / name
    if not path.is_file():
        raise BuildError(f"missing file: {name}")
    return path.read_text(encoding="utf-8-sig")


def data_uri(name: str) -> str:
    path = ROOT / name
    if not path.is_file():
        raise BuildError(f"missing file: {name}")
    mime = MIME.get(path.suffix.lower())
    if not mime:
        raise BuildError(f"unsupported icon type: {name}")
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def escape_js(js: str) -> str:
    # "</script" would end the inline element early; "<\/script" means the same in JS strings/regexes.
    js = re.sub(r"</(script)", r"<\\/\1", js, flags=re.IGNORECASE)
    # "<!--" (with a later "<script") switches the HTML parser into a state where the real
    # closing tag is not recognised; "\x3C" is "<" in strings, template literals and regexes.
    return js.replace("<!--", "\\x3C!--")


def escape_css(css: str) -> str:
    return re.sub(r"</(style)", r"<\\/\1", css, flags=re.IGNORECASE)


def build() -> Path:
    if not SRC.is_file():
        raise BuildError("index.html not found")
    html = SRC.read_text(encoding="utf-8-sig")
    tags = find_tags(html)
    links = [t for t in tags if t.name == "link"]
    scripts = [t for t in tags if t.name == "script" and "src" in t.attrs]

    # (tag, replacement text) pairs; applied back-to-front so offsets stay valid.
    edits: list[tuple[Tag, str]] = []

    manifest = find_one(links, '<link rel="manifest">', lambda t: "manifest" in t.rel())
    edits.append((manifest, ""))

    icon = find_one(links, '<link rel="icon" href="icons/icon.svg">',
                    lambda t: "icon" in t.rel() and t.ref("href") == "icons/icon.svg")
    edits.append((icon, icon.with_attr("href", data_uri(icon.ref("href")))))

    touch = find_one(links, '<link rel="apple-touch-icon" href="...">',
                     lambda t: "apple-touch-icon" in t.rel() and t.ref("href"))
    edits.append((touch, touch.with_attr("href", data_uri(touch.ref("href")))))

    style = find_one(links, '<link rel="stylesheet" href="style.css">',
                     lambda t: "stylesheet" in t.rel() and t.ref("href") == "style.css")
    edits.append((style, f"<style>\n{escape_css(read_text('style.css')).strip()}\n</style>"))

    found = []
    for name in SCRIPTS:
        tag = find_one(scripts, f'<script src="{name}">', lambda t, n=name: t.ref("src") == n)
        if tag.attrs.get("type", "").lower() == "module":
            raise BuildError(f'{name} is loaded as type="module"; the app must use classic scripts')
        found.append(tag)

    order = [t.ref("src") for t in sorted(found, key=lambda t: t.start)]
    if order != SCRIPTS:
        raise BuildError(f"scripts must appear in the order {SCRIPTS}, found {order}")

    inline = [f"<script>\n{escape_js(read_text(name)).strip()}\n</script>" for name in SCRIPTS]
    if any("defer" in t.attrs or "async" in t.attrs for t in found):
        # defer/async mean nothing for inline scripts; running them at the end of <body>
        # gives the same "after the document is parsed" behaviour.
        body_end = list(re.finditer(r"</body\s*>", html, re.IGNORECASE))
        if not body_end:
            raise BuildError("scripts use defer/async but index.html has no </body>")
        at = body_end[-1].start()
        anchor = Tag("body-end", at, at, "", "", 0)
        for tag in found:
            edits.append((tag, ""))
        edits.append((anchor, "\n".join([SINGLE_FILE_FLAG] + inline) + "\n"))
    else:
        for i, tag in enumerate(found):
            prefix = SINGLE_FILE_FLAG + "\n" if i == 0 else ""
            edits.append((tag, prefix + inline[i]))

    # Sanity: edited spans must not overlap.
    edits.sort(key=lambda e: e[0].start)
    for (a, _), (b, _) in zip(edits, edits[1:]):
        if a.end > b.start:
            raise BuildError("overlapping tags in index.html")

    out = html
    for tag, text in reversed(edits):
        start, end = tag.start, tag.end
        if not text:
            # Drop the whole line when removing a tag that sits on its own line.
            line_start = out.rfind("\n", 0, start) + 1
            line_end = out.find("\n", end)
            line_end = len(out) if line_end == -1 else line_end + 1
            if not out[line_start:start].strip() and not out[end:line_end].strip():
                start, end = line_start, line_end
        out = out[:start] + text + out[end:]

    warn_unresolved(tags, {id(t) for t, _ in edits})
    if not re.search(r"<meta\s[^>]*charset", html, re.IGNORECASE):
        print("warning: index.html has no <meta charset>; the single file may display garbled text")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out, encoding="utf-8", newline="\n")
    return OUT


def warn_unresolved(tags: list[Tag], handled: set[int]) -> None:
    """Point out other local files the page references; they won't exist next to the single file."""
    for t in tags:
        if id(t) in handled:
            continue
        for attr in ("href", "src"):
            v = t.attrs.get(attr, "").strip()
            if v and not re.match(r"^(data:|https?:|//|#|mailto:|blob:|javascript:)", v, re.IGNORECASE):
                print(f"warning: <{t.name} {attr}=\"{v}\"> is not inlined and will not resolve in the single file")


def main() -> int:
    sys.stdout.reconfigure(errors="replace")
    sys.stderr.reconfigure(errors="replace")
    try:
        out = build()
    except BuildError as e:
        print(f"build failed: {e}", file=sys.stderr)
        return 1
    size = out.stat().st_size
    print(f"wrote {out.relative_to(ROOT).as_posix()}  ({size / 1024:.1f} KB, {size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
