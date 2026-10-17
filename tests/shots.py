#!/usr/bin/env python3
"""Screenshots of 單字卡 in named UI states, for visual review.

Usage (run from PowerShell or cmd; headless Edge does not start from Git Bash here):
    python tests/shots.py                    # every shot
    python tests/shots.py home flash-back     # only these
    python tests/shots.py --list

Each shot loads tests/shot.html?s=<scenario>&w=<w>&h=<h>, which runs the real app in a
w x h iframe and drives it into the scenario's state. Headless Edge cannot make a window
narrower than ~500 px, so the window is made larger and the PNG is cropped to the iframe.
Output: tests/shots/<name>.png at device scale factor 2 (390 x 844 -> 780 x 1688 px).
A full run (no names given) also deletes PNGs in tests/shots/ that no shot produces any more.
"""

import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_tests import find_edge, kill_tree, remove_dir, start_server  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "shots"
SCALE = 2
VIRTUAL_TIME_BUDGET = 15000  # ms; scenarios finish in ~2 s of virtual time
TIMEOUT = 180  # seconds of real time per shot
# Each headless Edge runs ~20 processes; more than a few at once starves the CPU.
# VC_SHOT_WORKERS overrides the number of Edge instances run at the same time (default: up to 2).
WORKERS = int(os.environ.get("VC_SHOT_WORKERS", "0")) or max(1, min(2, (os.cpu_count() or 4) // 3))

PHONE = (390, 844)
SMALL = (360, 740)       # small Android phone
SE = (375, 548)          # iPhone SE in Safari (browser bars take the rest)
KEYBOARD = (390, 500)    # a 390 x 844 phone with the on-screen keyboard up
LANDSCAPE = (844, 390)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
TOUCH = {"touch": "1"}

# (file name, scenario in shot.html, (width, height), extra query parameters)
SHOTS = [
    # Home
    ("home-empty", "home-empty", PHONE, {}),
    ("home-empty-dark", "home-empty-dark", PHONE, {}),
    ("home-empty-ios", "home-empty-ios", PHONE, {}),
    ("home", "home", PHONE, {}),
    ("home-dark", "home-dark", PHONE, {}),
    ("home-ios-tip", "home-ios-tip", PHONE, {}),
    ("home-safe", "home", PHONE, {"safe": "1"}),
    ("home-tablet", "home", TABLET, {}),
    ("home-desktop", "home", DESKTOP, {}),
    ("deck-menu", "deck-menu", PHONE, {}),
    ("deck-menu-landscape", "deck-menu", (568, 320), TOUCH),
    ("confirm-dialog", "confirm-dialog", PHONE, {}),
    # Folders
    ("home-folders", "home-folders", PHONE, {}),
    ("home-folders-dark", "home-folders-dark", PHONE, {}),
    ("home-folders-360", "home-folders", SMALL, {}),
    ("home-folders-landscape", "home-folders", LANDSCAPE, TOUCH),
    ("home-folders-desktop", "home-folders", DESKTOP, {}),
    ("folder-page", "folder-page", PHONE, {}),
    ("folder-page-dark", "folder-page-dark", PHONE, {}),
    ("folder-page-360", "folder-page", SMALL, {}),
    ("folder-empty", "folder-empty", PHONE, {}),
    ("folder-menu", "folder-menu", PHONE, {}),
    ("move-sheet", "move-sheet", PHONE, {}),
    ("new-folder", "new-folder", PHONE, {}),
    # Deck hub
    ("hub", "hub", PHONE, {}),
    ("hub-dark", "hub-dark", PHONE, {}),
    ("hub-360", "hub", SMALL, {}),
    ("hub-small", "hub-small", PHONE, {}),
    ("hub-nospell", "hub-nospell", PHONE, {}),
    ("hub-examples", "hub-examples", PHONE, {}),
    ("examples-sheet", "examples-sheet", PHONE, {}),
    ("hub-empty", "hub-empty", PHONE, {}),
    ("hub-desktop", "hub", DESKTOP, {}),
    ("deck-settings", "deck-settings", PHONE, {}),
    # Flashcards
    ("flash-front", "flash-front", PHONE, {}),
    ("flash-back", "flash-back", PHONE, {}),
    ("flash-back-dark", "flash-back-dark", PHONE, {}),
    ("flash-back-360", "flash-back", SMALL, {}),
    ("flash-back-landscape", "flash-back", LANDSCAPE, TOUCH),
    ("flash-back-safe", "flash-back", PHONE, {"safe": "1"}),
    ("flash-back-desktop", "flash-back", DESKTOP, {}),
    ("flash-shuffled", "flash-shuffled", PHONE, {}),
    ("flash-zh2en", "flash-zh2en", PHONE, {}),
    ("flash-long", "flash-long", PHONE, {}),
    ("flash-long-se", "flash-long", SE, {}),
    ("flash-end", "flash-end", PHONE, {}),
    ("flash-end-landscape", "flash-end", LANDSCAPE, TOUCH),
    # 選擇題
    ("quiz-choice", "quiz-choice", PHONE, {}),
    ("quiz-choice-correct", "quiz-choice-correct", PHONE, {}),
    ("quiz-choice-wrong", "quiz-choice-wrong", PHONE, {}),
    ("quiz-choice-notes", "quiz-choice-notes", PHONE, {}),
    ("quiz-choice-dark", "quiz-choice-wrong-dark", PHONE, {}),
    ("quiz-choice-360", "quiz-choice", SMALL, {}),
    ("quiz-choice-wrong-se", "quiz-choice-wrong", SE, {}),
    ("quiz-choice-landscape", "quiz-choice", LANDSCAPE, TOUCH),
    ("quiz-choice-desktop", "quiz-choice", DESKTOP, {}),
    ("quiz-quit", "quiz-quit", PHONE, {}),
    # 拼字題
    ("quiz-spell", "quiz-spell", PHONE, {}),
    ("quiz-spell-360", "quiz-spell", SMALL, {}),
    ("quiz-spell-typing", "quiz-spell-typing", KEYBOARD, {}),
    ("quiz-spell-correct", "quiz-spell-correct", PHONE, {}),
    ("quiz-spell-wrong", "quiz-spell-wrong", PHONE, {}),
    ("quiz-spell-wrong-typing", "quiz-spell-wrong", KEYBOARD, {}),
    ("quiz-spell-dark", "quiz-spell-wrong-dark", PHONE, {}),
    # Quiz page
    ("quiz-setup", "quiz-setup", PHONE, {}),
    ("quiz-setup-dark", "quiz-setup-dark", PHONE, {}),
    ("quiz-setup-360", "quiz-setup", SMALL, {}),
    ("quiz-setup-bottom", "quiz-setup-bottom", PHONE, {}),
    ("quiz-setup-spell", "quiz-setup-spell", PHONE, {}),
    ("quiz-setup-partial", "quiz-setup-partial", PHONE, {}),
    ("quiz-setup-none", "quiz-setup-none", PHONE, {}),
    ("quiz-setup-resume", "quiz-setup-resume", PHONE, {}),
    ("quiz-setup-empty", "quiz-setup-empty", PHONE, {}),
    ("quiz-setup-safe", "quiz-setup", PHONE, {"safe": "1"}),
    ("quiz-setup-landscape", "quiz-setup", LANDSCAPE, TOUCH),
    ("quiz-setup-desktop", "quiz-setup", DESKTOP, {}),
    # Results
    ("quiz-results", "quiz-results", PHONE, {}),
    ("quiz-results-dark", "quiz-results-dark", PHONE, {}),
    ("quiz-results-spell", "quiz-results-spell", PHONE, {}),
    ("quiz-results-multi", "quiz-results-multi", PHONE, {}),
    # Browse / edit
    ("browse", "browse", PHONE, {}),
    ("browse-dark", "browse-dark", PHONE, {}),
    ("edit-sheet", "edit-sheet", PHONE, {}),
    ("add-sheet", "add-sheet", PHONE, {}),
    # Import
    ("import", "import", PHONE, {}),
    ("import-preview", "import-preview", PHONE, {}),
    ("import-chat", "import-chat", PHONE, {}),
    ("import-help", "import-help", PHONE, {}),
    ("import-reply-360", "import-reply", SMALL, {}),
    ("import-folder", "import-folder", PHONE, {}),
    ("import-folders-file", "import-folders-file", PHONE, {}),
    # Settings
    ("settings", "settings", PHONE, {}),
    ("settings-bottom", "settings-bottom", PHONE, {}),
    ("settings-dark", "settings-dark", PHONE, {}),
]


def has_error_banner(img):
    """shot.html paints a red banner over the page when the scenario fails."""
    r, g, b = img.convert("RGB").getpixel((4, 4))[:3]
    return r > 150 and g < 40 and b < 60


def take(edge, port, shot, attempts=3):
    """Retry a failed or stuck scenario (a busy machine can make a boot time out)."""
    for attempt in range(1, attempts + 1):
        name, status = take_once(edge, port, shot)
        retry = status.startswith("scenario failed") or status.startswith("timed out")
        if not retry or attempt == attempts:
            return name, status if attempt == 1 else f"{status} (attempt {attempt})"
    return name, status


def take_once(edge, port, shot):
    name, scenario, (width, height), extra = shot
    query = urlencode({"s": scenario, "w": width, "h": height, **extra})
    url = f"http://127.0.0.1:{port}/tests/shot.html?{query}"
    profile = tempfile.mkdtemp(prefix="vocabcards_shot_")
    raw = Path(profile) / "raw.png"
    cmd = [
        edge,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--hide-scrollbars",
        f"--user-data-dir={profile}",
        f"--force-device-scale-factor={SCALE}",
        f"--window-size={max(width + 60, 560)},{height + 140}",
        f"--virtual-time-budget={VIRTUAL_TIME_BUDGET}",
        f"--screenshot={raw}",
        url,
    ]
    started = time.monotonic()
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            proc.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            kill_tree(proc)
            return name, f"timed out after {TIMEOUT}s"
        if not raw.is_file():
            return name, "Edge wrote no screenshot (run this script from PowerShell / cmd)"
        with Image.open(raw) as img:
            if has_error_banner(img):
                img.save(OUT_DIR / f"{name}.png")  # keep it so the error text can be read
                return name, "scenario failed (see the red banner in the PNG)"
            need = (width * SCALE, height * SCALE)
            if img.width < need[0] or img.height < need[1]:
                return name, f"screenshot {img.size} is smaller than the {need} viewport"
            OUT_DIR.mkdir(exist_ok=True)
            img.crop((0, 0) + need).save(OUT_DIR / f"{name}.png", optimize=True)
        return name, f"ok ({time.monotonic() - started:.1f}s)"
    finally:
        remove_dir(profile)


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if "--list" in argv:
        for name, scenario, size, extra in SHOTS:
            print(f"{name:<22} {scenario:<18} {size[0]}x{size[1]} {extra or ''}")
        return 0
    wanted = set(argv)
    shots = [s for s in SHOTS if not wanted or s[0] in wanted]
    unknown = wanted - {s[0] for s in SHOTS}
    if unknown:
        print("unknown shot(s): " + ", ".join(sorted(unknown)) + "  (see --list)")
        return 1
    edge = find_edge()
    if not edge:
        print("Microsoft Edge not found (set EDGE_PATH).")
        return 2

    OUT_DIR.mkdir(exist_ok=True)
    server = start_server()
    port = server.server_address[1]
    failed = False
    try:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for name, status in pool.map(lambda s: take(edge, port, s), shots):
                failed = failed or not status.startswith("ok")
                print(f"{name:<22} {status}")
                sys.stdout.flush()
    finally:
        server.shutdown()
        server.server_close()
    if not wanted:
        names = {f"{s[0]}.png" for s in SHOTS}
        for stale in sorted(p for p in OUT_DIR.glob("*.png") if p.name not in names):
            stale.unlink()
            print(f"{stale.stem:<22} deleted (no shot produces it)")
    print(f"screenshots in {OUT_DIR}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
