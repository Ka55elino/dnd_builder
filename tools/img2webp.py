#!/usr/bin/env python3
"""
Built-in images (assets/images) PNG/JPEG → WebP, and the "/img/…" URLs in the data updated.

    python3 tools/img2webp.py --dry-run          # what it would do: sizes before / after, nothing written
    python3 tools/img2webp.py                    # convert, update the URLs, delete the originals
    python3 tools/img2webp.py --keep             # … but keep the PNG/JPEG files
    python3 tools/img2webp.py --quality 85       # WebP quality (default 82; transparency is kept)
    python3 tools/img2webp.py --max-size 512     # also downscale anything larger (longest side)
    python3 tools/img2webp.py assets/images/classes   # only a part of assets/images

Why: a 512×512 PNG is ~450 KB; the same picture as WebP is several times smaller. Big
bodies through the webview's asset scheme are what sometimes arrived cut short (see images.go).

URLs: every "/img/<file>.png|.jpg|.jpeg" in assets/data (JSON) and frontend/src (JS/Svelte)
whose file was converted becomes "/img/<file>.webp". Records already saved in a database
(a production DB keeps its rows) don't need it: the server falls back from a missing .png
to the .webp with the same name (images.go).

Run from the project root. Requires Pillow with WebP (pip3 install pillow).
"""
import argparse
import re
import sys
from pathlib import Path

try:
    from PIL import Image, features
except ImportError:
    sys.exit("Pillow is not installed: pip3 install pillow")

ROOT = Path.cwd()
IMAGES = ROOT / "assets" / "images"
TEXT_DIRS = [(ROOT / "assets" / "data", {".json"}), (ROOT / "frontend" / "src", {".js", ".svelte"})]
SOURCE_EXT = {".png", ".jpg", ".jpeg"}
URL_RE = re.compile(r"/img/([^\"'\s)]+?)\.(png|jpe?g)\b", re.IGNORECASE)


def human(n):
    return f"{n / 1024 / 1024:.1f} MB" if n >= 1024 * 1024 else f"{n / 1024:.0f} KB"


def convert(src, quality, max_size, dry_run):
    """→ (size before, size after, the .webp path)."""
    dst = src.with_suffix(".webp")
    with Image.open(src) as im:
        im.load()
        if max_size and max(im.size) > max_size:
            im.thumbnail((max_size, max_size), Image.LANCZOS)
        has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        im = im.convert("RGBA" if has_alpha else "RGB")
        if dry_run:
            from io import BytesIO

            buf = BytesIO()
            im.save(buf, "WEBP", quality=quality, method=4)
            after = buf.tell()
        else:
            im.save(dst, "WEBP", quality=quality, method=4)
            after = dst.stat().st_size
    return src.stat().st_size, after, dst


def rewrite_urls(converted, dry_run):
    """converted — set of "<path under assets/images without the extension>". → files changed."""
    changed = 0
    for base, exts in TEXT_DIRS:
        if not base.exists():
            continue
        for f in base.rglob("*"):
            if f.suffix not in exts or "node_modules" in f.parts:
                continue
            text = f.read_text(encoding="utf-8")
            new = URL_RE.sub(lambda m: f"/img/{m.group(1)}.webp" if m.group(1) in converted else m.group(0), text)
            if new != text:
                changed += 1
                if not dry_run:
                    f.write_text(new, encoding="utf-8")
    return changed


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("paths", nargs="*", type=Path, help="folders/files under assets/images (default: all of it)")
    p.add_argument("--quality", type=int, default=82, help="WebP quality 0–100 (default 82)")
    p.add_argument("--max-size", type=int, default=0, help="downscale the longest side to N px (default: keep)")
    p.add_argument("--keep", action="store_true", help="keep the PNG/JPEG originals")
    p.add_argument("--dry-run", action="store_true", help="only report, write nothing")
    args = p.parse_args()

    if not IMAGES.exists():
        sys.exit("Run from the project root (assets/images not found).")
    if not features.check("webp"):
        sys.exit("This Pillow has no WebP support.")

    roots = [r.resolve() for r in args.paths] or [IMAGES]
    files = sorted({f for r in roots for f in ([r] if r.is_file() else r.rglob("*")) if f.suffix.lower() in SOURCE_EXT})
    if not files:
        sys.exit("No PNG/JPEG files found.")

    total_before = total_after = 0
    converted = set()
    for i, src in enumerate(files, 1):
        try:
            before, after, dst = convert(src, args.quality, args.max_size, args.dry_run)
        except Exception as e:  # a broken file: report, keep going
            print(f"  ! {src.relative_to(ROOT)}: {e}", file=sys.stderr)
            continue
        total_before += before
        total_after += after
        converted.add(src.relative_to(IMAGES).with_suffix("").as_posix())
        if not args.dry_run and not args.keep:
            src.unlink()
        if i % 50 == 0 or i == len(files):
            print(f"  {i}/{len(files)}…", file=sys.stderr)

    changed = rewrite_urls(converted, args.dry_run)

    verb = "would be" if args.dry_run else "were"
    print(f"{len(converted)} images: {human(total_before)} → {human(total_after)} "
          f"({100 - total_after * 100 // max(total_before, 1)}% smaller)")
    print(f"{changed} data/source files {verb} updated (.png/.jpg → .webp URLs)")
    if args.dry_run:
        print("Dry run: nothing was written.")
    elif args.keep:
        print("Originals kept (--keep): delete them when you're happy with the WebP.")


if __name__ == "__main__":
    main()
