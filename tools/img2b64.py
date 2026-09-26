#!/usr/bin/env python3
"""
Image (JPEG, PNG, WebP…) → PNG → base64 (data URL) for the "image" field in db/data.

Examples:
    python3 tools/img2b64.py sword.jpg                      # base64 to stdout
    python3 tools/img2b64.py sword.jpg --size 512 --copy    # downscale and copy to clipboard (macOS)
    python3 tools/img2b64.py sword.jpg --png out.png        # also save the PNG
    python3 tools/img2b64.py a.jpg b.jpg --json             # {"a.jpg": "data:...", ...}

Remove a dark background (generator images on a black/dark-blue background):
    python3 tools/img2b64.py elf.jpeg --cut --size 512
        busts, figures without glow (threshold 30, gaps inside the figure stay solid)
    python3 tools/img2b64.py red.jpeg --cut glow --size 512
        glow, fire, lightning (wide threshold near the edge, no dark ring around the glow)
    --cut-threshold N / --cut-close N: manual tuning (see --help)

Write straight into a JSON file (the "image" field):
    python3 tools/img2b64.py elf.jpeg --cut --size 512 --into db/data/races/elf/elf.json

Requires Pillow (pip3 install pillow); --cut also needs numpy (pip3 install numpy).
"""
import argparse
import base64
import io
import json
import subprocess
import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Pillow is required: pip3 install pillow")


# ---------------------------------------------------------------------------
# background removal

CUT_PRESETS = {
    # threshold (how far a color may differ from the background), silhouette closing in px (at 1024)
    "solid": (30, 14),  # figures, busts: dark grooves inside stay solid
    "glow": (55, 0),    # glow/fire: wide threshold near the edge, no closing (the gaps between flames are background)
}


def remove_background(im, threshold=30, close=14, holes=0.0, work=1024):
    """
    Removes a solid or smoothly varying dark background around a figure.

    1. the background is the region connected to the image border whose color is
       close to the background (estimated locally, so gradients work too);
    2. transparency is smooth at the figure's edge and the background tint is
       removed (unmultiply), so glow does not turn into a dark halo;
    3. close > 0: narrow gaps and enclosed dark spots inside the figure count as the figure;
    4. holes > 0: enclosed background areas (not touching the border) larger than
       this share of the image (e.g. 0.005 = 0.5%) become transparent too — for
       background seen through an arch or between antlers.
    """
    try:
        import numpy as np
    except ImportError:
        sys.exit("--cut requires numpy: pip3 install numpy")

    def flood(cand):
        H, W = cand.shape
        seen = np.zeros((H, W), bool)
        q = deque()
        for x in range(W):
            for y in (0, H - 1):
                if cand[y, x] and not seen[y, x]:
                    seen[y, x] = True
                    q.append((y, x))
        for y in range(H):
            for x in (0, W - 1):
                if cand[y, x] and not seen[y, x]:
                    seen[y, x] = True
                    q.append((y, x))
        while q:
            y, x = q.popleft()
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < H and 0 <= nx < W and cand[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        return seen

    def box(a, r, axis):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(a, pad, mode="reflect"), axis=axis)
        n = a.shape[axis]
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
        lo = np.take(c, np.arange(0, n), axis=axis)
        return (hi - lo) / (2 * r + 1)

    def blur(arr, r):  # three box passes ≈ Gaussian blur
        a = arr.astype(np.float64)
        k = max(1, int(r / 1.7))
        for _ in range(3):
            a = box(box(a, k, 0), k, 1)
        return a.astype(np.float32)

    size = im.size
    rgb = im.convert("RGB").resize((work, work), Image.LANCZOS)
    a = np.asarray(rgb).astype(np.float32)
    T = float(threshold)

    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    med = np.median(border, axis=0)
    # rough background mask → local background color estimate (for gradients)
    m0 = flood(np.sqrt(((a - med) ** 2).sum(-1)) <= max(T, 35))
    w = blur(m0.astype(np.float32), 48) + 1e-4
    bg = np.dstack([blur(a[..., c] * m0, 48) / w for c in range(3)])
    bg = np.where(w[..., None] > 0.02, bg, med)
    dist = np.sqrt(((a - bg) ** 2).sum(-1))

    # strict mask; the wide threshold applies only in a band around it (removes the dark ring around glow)
    strict = flood(dist <= min(T, 30))
    zone = blur(strict.astype(np.float32), 40) > 0.02
    seen = flood((dist <= T) & zone)

    if close > 0:
        obj = ~seen
        dil = blur(obj.astype(np.float32), close) > 0.02
        closed = blur(dil.astype(np.float32), close) > 0.98
        seen = flood(seen & ~closed)  # gaps and enclosed spots inside the figure are not background

    if holes > 0:
        # large enclosed areas of almost exactly the background color → background as well
        # (a stricter color test than the edge flood, so dark shadows inside the figure survive)
        cand = (dist <= 12) & ~seen
        H, W = cand.shape
        lab = np.zeros((H, W), np.int32)
        n = 0
        min_area = holes * H * W
        for sy, sx in zip(*np.nonzero(cand)):
            if lab[sy, sx]:
                continue
            n += 1
            lab[sy, sx] = n
            comp = [(sy, sx)]
            q = deque(comp)
            while q:
                y, x = q.popleft()
                for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= ny < H and 0 <= nx < W and cand[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n
                        q.append((ny, nx))
                        comp.append((ny, nx))
            if len(comp) >= min_area:
                ys, xs = zip(*comp)
                seen[list(ys), list(xs)] = True

    alpha = np.ones(dist.shape, np.float32)
    ramp = np.clip((dist - T * 0.3) / (T * 0.7), 0, 1)
    alpha[seen] = ramp[seen]
    soft = blur(alpha, 1.0)
    alpha = np.where(seen, np.minimum(alpha, soft), alpha)

    A = alpha[..., None]
    col = np.where(A < 1, (a - bg * (1 - A)) / np.maximum(A, 1e-3), a)
    col = np.clip(col, 0, 255)
    out = Image.fromarray(np.dstack([col, alpha * 255]).astype(np.uint8), "RGBA")
    return out.resize(size, Image.LANCZOS) if size != (work, work) else out


# ---------------------------------------------------------------------------


def to_png_bytes(path, size, cut):
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)  # phone photos: correct orientation
        if cut:
            im = remove_background(im, *cut)
        else:
            im = im.convert("RGBA" if "A" in im.getbands() or im.mode == "P" else "RGB")
        if size and max(im.size) > size:
            im.thumbnail((size, size), Image.LANCZOS)  # only downscale, aspect ratio is preserved
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        return buf.getvalue()


def write_into_json(path, url):
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    data["image"] = url
    indent = 2 if '\n  "' in raw else 4  # keep the file's indentation
    path.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")
    print(f"image → {path} ({len(url) // 1024} KB)", file=sys.stderr)


def main():
    p = argparse.ArgumentParser(description="Image → PNG → base64 (data URL).")
    p.add_argument("files", nargs="+", type=Path, help="input files (.jpg, .jpeg, .png, .webp…)")
    p.add_argument("--size", type=int, help="max size of the longer side, px")
    p.add_argument("--png", type=Path, help="save the PNG (a file, or a folder for several inputs)")
    p.add_argument("--raw", action="store_true", help="without the data:image/png;base64, prefix")
    p.add_argument("--json", action="store_true", help="output JSON {file name: base64}")
    p.add_argument("--copy", action="store_true", help="copy the result to the clipboard (macOS)")
    p.add_argument("--into", type=Path, help="write into the \"image\" field of this JSON file (single input only)")
    p.add_argument("--cut", nargs="?", const="solid", choices=sorted(CUT_PRESETS),
                   help="remove a dark background: solid (default) for figures; glow for glow/fire")
    p.add_argument("--cut-threshold", type=float, help="background similarity threshold (30 = strict, 55 = for glow)")
    p.add_argument("--cut-close", type=float, help="closing of gaps inside the figure, px (0 = off)")
    p.add_argument("--cut-holes", type=float, default=0.0,
                   help="also clear enclosed background areas larger than this share of the image "
                        "(e.g. 0.005 = 0.5%%; 0 = off). Don't use for medallions/frames with a dark inside")
    args = p.parse_args()

    if args.into and len(args.files) != 1:
        sys.exit("--into works with a single input file")

    cut = None
    if args.cut or args.cut_threshold is not None or args.cut_close is not None or args.cut_holes:
        t, c = CUT_PRESETS[args.cut or "solid"]
        cut = (args.cut_threshold if args.cut_threshold is not None else t,
               args.cut_close if args.cut_close is not None else c,
               args.cut_holes)

    results = {}
    for f in args.files:
        if not f.is_file():
            sys.exit(f"File not found: {f}")
        png = to_png_bytes(f, args.size, cut)
        b64 = base64.b64encode(png).decode("ascii")
        results[f.name] = b64 if args.raw else f"data:image/png;base64,{b64}"

        if args.png:
            out = args.png / f"{f.stem}.png" if len(args.files) > 1 or args.png.is_dir() else args.png
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(png)
            print(f"PNG: {out} ({len(png) // 1024} KB)", file=sys.stderr)

    if args.into:
        url = next(iter(results.values()))
        write_into_json(args.into, url if not args.raw else f"data:image/png;base64,{url}")
        return

    text = json.dumps(results, ensure_ascii=False, indent=2) if args.json or len(results) > 1 \
        else next(iter(results.values()))
    print(text)

    if args.copy:
        try:
            subprocess.run(["pbcopy"], input=text.encode(), check=True)
            print("Copied to clipboard.", file=sys.stderr)
        except (FileNotFoundError, subprocess.CalledProcessError):
            print("Could not copy: pbcopy is only available on macOS.", file=sys.stderr)


if __name__ == "__main__":
    main()
