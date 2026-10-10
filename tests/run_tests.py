#!/usr/bin/env python3
"""Run the browser test pages of 單字卡 in headless Microsoft Edge.

Usage:
    python tests/run_tests.py              # core.test.html (+ e2e.html when it exists)
    python tests/run_tests.py e2e.html     # only the given page(s), relative to tests/

A local http.server serves the project folder; every page runs in a fresh, throw-away
Edge profile. Each page must write a line "RESULT: PASS <n> FAIL <m>" into its DOM
before the virtual-time budget ends. Failure details are taken from the page text:
lines starting with "FAIL" (plus the indented lines right after them).

Exit code: 0 when every page passes, 1 on any failure / missing RESULT line, 2 when
Edge cannot be found.
"""

import functools
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS_DIR = ROOT / "tests"
EDGE_CANDIDATES = [
    os.environ.get("EDGE_PATH", ""),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
PAGE_TIMEOUT = 90  # seconds per page (real time)
VIRTUAL_TIME_BUDGET = 20000  # ms of virtual time per page
# The end-to-end page drives the real UI (animations, debounced saves, history.back()).
# Virtual time only advances while the page waits, so a big budget costs little real time.
PAGE_BUDGETS = {"e2e.html": 240000}
PAGE_TIMEOUTS = {"e2e.html": 240}
RESULT_RE = re.compile(r"RESULT:\s*PASS\s+(\d+)\s+FAIL\s+(\d+)")
MAX_DETAIL_LINES = 120


class QuietHandler(SimpleHTTPRequestHandler):
    """Static files with explicit UTF-8 types (the Windows registry can map .js to text/plain)."""

    extensions_map = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".txt": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def find_edge():
    for candidate in EDGE_CANDIDATES:
        if candidate and Path(candidate).is_file():
            return candidate
    return shutil.which("msedge")


class QuietServer(ThreadingHTTPServer):
    """A local server for several browsers at once.

    The default listen backlog (5) is too small for two Edge instances that each open many
    connections (page, scripts, icons, the service worker's precache): on Windows the extra
    connections are refused and a page can come up without its scripts. A browser that closes
    a connection early (Edge exiting after a screenshot) is not an error worth a traceback.
    """

    daemon_threads = True
    request_queue_size = 128

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = QuietServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def kill_tree(proc):
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        proc.kill()


def remove_dir(path):
    # Edge may hold profile files for a moment after exiting.
    for _ in range(10):
        shutil.rmtree(path, ignore_errors=True)
        if not os.path.exists(path):
            return
        time.sleep(0.3)


def dom_to_text(dom):
    dom = re.sub(r"(?is)<(script|style)\b.*?</\1\s*>", "", dom)
    dom = re.sub(r"(?i)<br\s*/?>", "\n", dom)
    dom = re.sub(r"(?i)</(p|div|li|h\d|tr|pre)\s*>", "\n", dom)
    return html.unescape(re.sub(r"<[^>]+>", "", dom))


def failure_lines(text):
    lines = text.splitlines()
    picked = []
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("FAIL"):
            picked.append(lines[i])
            i += 1
            while i < len(lines) and lines[i][:1] in (" ", "\t") and lines[i].strip():
                picked.append(lines[i])
                i += 1
        else:
            i += 1
    if not picked:  # unknown page format: show the start of the page text instead
        picked = [line for line in lines if line.strip()][:40]
    return picked[:MAX_DETAIL_LINES]


def run_page(edge, port, page):
    url = f"http://127.0.0.1:{port}/tests/{page}"
    profile = tempfile.mkdtemp(prefix="vocabcards_edge_")
    cmd = [
        edge,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        f"--user-data-dir={profile}",
        f"--virtual-time-budget={PAGE_BUDGETS.get(page, VIRTUAL_TIME_BUDGET)}",
        "--dump-dom",
        url,
    ]
    timeout = PAGE_TIMEOUTS.get(page, PAGE_TIMEOUT)
    started = time.monotonic()
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            out, _err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            kill_tree(proc)
            try:
                proc.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                pass
            return {"page": page, "ok": False, "seconds": time.monotonic() - started,
                    "summary": f"timed out after {timeout}s", "details": []}
    finally:
        remove_dir(profile)

    seconds = time.monotonic() - started
    text = dom_to_text(out.decode("utf-8", errors="replace"))
    m = RESULT_RE.search(text)
    if not m:
        return {"page": page, "ok": False, "seconds": seconds,
                "summary": "no 'RESULT: PASS <n> FAIL <m>' line in the page",
                "details": failure_lines(text) if text.strip() else [
                    "(Edge printed an empty DOM: the page did not load, or Edge cannot start in this",
                    " sandboxed shell — run the script from a normal terminal / PowerShell.)"]}
    passed, failed = int(m.group(1)), int(m.group(2))
    return {"page": page, "ok": failed == 0, "seconds": seconds,
            "summary": f"PASS {passed} FAIL {failed}",
            "details": failure_lines(text) if failed else []}


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    pages = argv or ["core.test.html"] + (["e2e.html"] if (TESTS_DIR / "e2e.html").is_file() else [])
    missing = [p for p in pages if not (TESTS_DIR / p).is_file()]
    if missing:
        print("missing test page(s): " + ", ".join(missing))
        return 1

    edge = find_edge()
    if not edge:
        print("Microsoft Edge not found (set EDGE_PATH).")
        return 2

    server = start_server()
    port = server.server_address[1]
    all_ok = True
    try:
        for page in pages:
            result = run_page(edge, port, page)
            all_ok = all_ok and result["ok"]
            mark = "OK  " if result["ok"] else "FAIL"
            print(f"[{mark}] {page:<18} {result['summary']}  ({result['seconds']:.1f}s)")
            for line in result["details"]:
                print("       " + line)
            sys.stdout.flush()
    finally:
        server.shutdown()
        server.server_close()

    print("ALL TESTS PASSED" if all_ok else "TESTS FAILED")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
