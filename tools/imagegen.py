#!/usr/bin/env python3
"""
Local image generator: Stable Diffusion models through 🤗 diffusers, no API and no key.
Runs on Apple Silicon (MPS), NVIDIA (CUDA) or, slowly, on the CPU.

    pip3 install torch torchvision diffusers transformers accelerate safetensors

Models are downloaded from Hugging Face on the first run and cached
(~/.cache/huggingface). Presets (--model):
    sdxl        stabilityai/stable-diffusion-xl-base-1.0 — best quality, 1024 px, ~7 GB, ~30 steps (default)
    sdxl-turbo  stabilityai/sdxl-turbo — very fast drafts, 512 px, ~7 GB, 1–4 steps
    any other Hugging Face id of a text-to-image pipeline, e.g. --model stabilityai/sdxl-turbo

Examples:
    # a free-form prompt → tools/out/<slug>-1.png
    python3 tools/imagegen.py "ornate plate armor, fantasy inventory icon"

    # the prompt is built from a data record (name, parent class/species, feature names)
    python3 tools/imagegen.py --from assets/data/armor/heavy/plate.json -n 4

    # fast drafts first
    python3 tools/imagegen.py --from "assets/data/armor/heavy/*.json" --model sdxl-turbo -n 4

    # put the chosen variant into the app (background removal + assets/images + the JSON "image")
    python3 tools/img2b64.py tools/out/plate-3.png --cut --size 512 --into assets/data/armor/heavy/plate.json

    # or all in one go: the first variant goes into the app
    python3 tools/imagegen.py --from "assets/data/armor/heavy/*.json" --into

    # match the style of existing icons (IP-Adapter, SDXL only; extra ~3 GB download on first use)
    python3 tools/imagegen.py --from assets/data/classes/rogue/subclasses/thief.json --refs 2

    # only print the prompts, load nothing
    python3 tools/imagegen.py --from "assets/data/armor/heavy/*.json" --dry-run
"""
import argparse
import glob
import json
import re
import sys
import time
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
DATA = ROOT / "assets" / "data"
IMAGES = ROOT / "assets" / "images"

PRESETS = {
    #            model id                                   steps guidance size
    "sdxl":       ("stabilityai/stable-diffusion-xl-base-1.0", 30, 7.0, 1024),
    "sdxl-turbo": ("stabilityai/sdxl-turbo",                   4,  0.0, 512),
}
# SDXL's own VAE overflows in float16 (black or noisy images on MPS/CUDA); this one is fixed
SDXL_FP16_VAE = "madebyollin/sdxl-vae-fp16-fix"

# Stable Diffusion reads only the first 77 tokens: keep the subject first and the style short.
# The background is plain black so img2b64.py --cut removes it cleanly.
EMBLEM_STYLE = (
    "ornate fantasy emblem icon, single medallion crest, centered, symmetrical, "
    "painterly digital art, intricate metal and gemstones, subtle magical glow, rim light, "
    "isolated on plain pure black background"
)
ITEM_STYLE = (
    "fantasy RPG inventory item icon, EXACTLY ONE SINGLE PHYSICAL OBJECT, "
    "one isolated item only, no set, no collection, no variants, "
    "centered composition, whole object fully visible, "
    "large object occupying most of the image, three-quarter view, "
    "painterly digital game art, highly detailed realistic materials, "
    "detailed worn metal and leather, subtle scratches and wear, "
    "soft studio lighting, subtle rim light, "
    "isolated on plain pure black background"
)
NEGATIVE = (
    "multiple objects, multiple items, duplicate objects, duplicated item, "
    "two objects, three objects, several objects, "
    "multiple versions, alternative versions, variations, "
    "item variants, equipment set, collection, lineup, "
    "collage, concept sheet, character sheet, turnaround sheet, "
    "multiple views, side by side, "
    "separate armor pieces, scattered armor pieces, "
    "person, human, character, mannequin, body, hands, "
    "head, face, weapon, shield, helmet, "
    "text, letters, words, watermark, signature, logo, "
    "frame, border, cropped, cut off, "
    "busy background, scenery, floor, environment, "
    "blurry, lowres, jpeg artifacts, deformed"
)
EQUIPMENT = {"weapons", "armor", "items", "packs"}


# ---------------------------------------------------------------------------
# prompts from data records


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def parent_name(path, fallback):
    """Name of the parent class/species (classes/rogue/subclasses/x.json → classes/rogue/rogue.json)."""
    folder = Path(path).resolve().parents[1]
    p = folder / f"{folder.name}.json"
    return load(p).get("name") if p.is_file() else fallback


def describe(path):
    """Record → (prompt, style, output name)."""
    d = load(path)
    rel = Path(path).resolve().relative_to(DATA).parts
    name = d.get("name", d.get("id", Path(path).stem))
    feats = [f.get("name") for f in (d.get("features") or d.get("traits") or []) if isinstance(f, dict)]
    feats = [re.sub(r"^\w+:\s*", "", f) for f in feats if f][:3]  # "Lineage: Darkness" → "Darkness"

    if rel[0] in EQUIPMENT:
        kind = {"armor": "armor", "weapons": "weapon"}.get(rel[0], "")
        cat = d.get("category", "")
        what = " ".join(x for x in (cat if cat != "named" else "", kind) if x)
        prompt = f"{name}" + (f", {what}" if what and what.lower() not in name.lower() else "")
        return prompt, ITEM_STYLE, Path(path).stem

    if rel[0] == "races" and "subraces" in rel:
        subject = f"{name}, {parent_name(path, d.get('race'))} lineage"
    elif rel[0] == "races":
        subject = f"{name} fantasy race"
    elif rel[0] == "classes" and "subclasses" in rel:
        subject = f"{name}, {parent_name(path, d.get('class'))} subclass"
    else:
        subject = f"{name} class"
    prompt = f"emblem of the {subject}, Dungeons and Dragons"
    if feats:
        prompt += ", symbols of " + ", ".join(feats)
    return prompt, EMBLEM_STYLE, Path(path).stem


def sibling_refs(path, n):
    """Style references for IP-Adapter: the parent's image and neighbouring records' PNGs."""
    if n <= 0:
        return []
    rel = Path(path).resolve().relative_to(DATA).with_suffix("")
    folder = IMAGES / rel.parent
    own = folder / f"{rel.name}.png"
    cands = [p for p in sorted(folder.glob("*.png")) if p != own]
    if rel.parent.name in ("subclasses", "subraces"):
        parent = IMAGES / rel.parent.parent / f"{rel.parent.parent.name}.png"
        if parent.is_file():
            cands.insert(0, parent)
    return cands[:n]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "image"


# ---------------------------------------------------------------------------
# the model


def pick_device():
    import torch

    if torch.backends.mps.is_available():
        return "mps", torch.float16
    if torch.cuda.is_available():
        return "cuda", torch.float16
    return "cpu", torch.float32


def load_pipeline(model_id, with_refs):
    import torch
    from diffusers import AutoPipelineForText2Image

    device, dtype = pick_device()
    print(f"loading {model_id} on {device} ({str(dtype).removeprefix('torch.')})…", file=sys.stderr)
    t = time.time()
    kw = {"torch_dtype": dtype, "use_safetensors": True}
    if dtype == torch.float16:
        kw["variant"] = "fp16"
    is_xl = "xl" in model_id.lower()
    if is_xl and dtype == torch.float16:
        from diffusers import AutoencoderKL

        kw["vae"] = AutoencoderKL.from_pretrained(SDXL_FP16_VAE, torch_dtype=dtype)
    try:
        pipe = AutoPipelineForText2Image.from_pretrained(model_id, **kw)
    except (OSError, ValueError):
        kw.pop("variant", None)  # the model has no fp16 files
        pipe = AutoPipelineForText2Image.from_pretrained(model_id, **kw)

    if with_refs:
        if not is_xl:
            sys.exit("--ref/--refs (IP-Adapter) is supported for SDXL models only")
        pipe.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter_sdxl.bin")

    pipe = pipe.to(device)
    if device == "mps":
        pipe.enable_attention_slicing()  # less memory, avoids swapping on 16 GB machines
    pipe.set_progress_bar_config(leave=False)
    print(f"  ready in {time.time() - t:.0f}s", file=sys.stderr)
    return pipe, device


def run(pipe, device, prompt, negative, steps, guidance, size, seed, refs, ref_scale):
    import torch
    from PIL import Image

    gen = torch.Generator("cpu").manual_seed(seed)  # CPU generator: the same seed gives the same image everywhere
    kw = dict(prompt=prompt, num_inference_steps=steps, guidance_scale=guidance,
              width=size, height=size, generator=gen)
    if guidance > 1:  # turbo models ignore the negative prompt (guidance 0)
        kw["negative_prompt"] = negative
    if refs:
        pipe.set_ip_adapter_scale(ref_scale)
        kw["ip_adapter_image"] = [[Image.open(r).convert("RGB") for r in refs]]
    return pipe(**kw).images[0]


# ---------------------------------------------------------------------------


def main():
    p = argparse.ArgumentParser(description="Generate images with a local Stable Diffusion model (diffusers).")
    p.add_argument("prompt", nargs="?", help="free-form prompt (with --from: added to the record's prompt)")
    p.add_argument("--from", dest="src", help="assets/data JSON record(s), a glob is allowed: build the prompt from the record")
    p.add_argument("-n", type=int, default=1, help="variants per record (different seeds)")
    p.add_argument("--model", default="sdxl", help="preset (sdxl, sdxl-turbo) or a Hugging Face model id")
    p.add_argument("--steps", type=int, help="inference steps (default: the preset's)")
    p.add_argument("--guidance", type=float, help="guidance scale (default: the preset's)")
    p.add_argument("--size", type=int, help="width = height in px (default: the preset's)")
    p.add_argument("--seed", type=int, help="first seed (default: random); variant i uses seed + i")
    p.add_argument("--no-style", action="store_true", help="don't append the house style to the prompt")
    p.add_argument("--negative", default=NEGATIVE, help="negative prompt")
    p.add_argument("--ref", action="append", default=[], help="style reference image (IP-Adapter, SDXL), can be repeated")
    p.add_argument("--refs", type=int, default=0, help="with --from: also use N sibling images as style references")
    p.add_argument("--ref-scale", type=float, default=0.5, help="how strongly the references steer the style (0–1)")
    p.add_argument("--out", type=Path, default=TOOLS / "out", help="output folder (default tools/out)")
    p.add_argument("--into", action="store_true", help="with --from: remove the background of the first variant and put it "
                                                        "into the app (assets/images + the record's \"image\")")
    p.add_argument("--cut", default="solid", choices=["solid", "glow"], help="background removal preset for --into")
    p.add_argument("--force", action="store_true", help="with a --from glob: also records that already have a PNG image")
    p.add_argument("--dry-run", action="store_true", help="print the prompts, load no model")
    args = p.parse_args()

    if not args.prompt and not args.src:
        p.error("give a prompt or --from")
    if args.into and not args.src:
        p.error("--into needs --from")

    model_id, steps, guidance, size = PRESETS.get(args.model, (args.model, 30, 7.0, 1024))
    steps = args.steps or steps
    guidance = guidance if args.guidance is None else args.guidance
    size = args.size or size

    jobs = []  # (prompt, style, name, record | None, refs)
    if args.src:
        files = sorted(glob.glob(args.src)) or [args.src]
        for f in files:
            if not Path(f).is_file():
                sys.exit(f"File not found: {f}")
            has_png = (IMAGES / Path(f).resolve().relative_to(DATA).with_suffix(".png")).is_file()
            if len(files) > 1 and has_png and not args.force:
                continue
            prompt, style, name = describe(f)
            if args.prompt:
                prompt += ", " + args.prompt
            jobs.append((prompt, style, name, Path(f), args.ref + sibling_refs(f, args.refs)))
    else:
        jobs.append((args.prompt, EMBLEM_STYLE, slug(args.prompt), None, args.ref))
    if not jobs:
        print("Nothing to do: every record already has a PNG image (use --force).")
        return

    for prompt, style, name, _, refs in jobs:
        full = prompt if args.no_style else f"{prompt}, {style}"
        print(f"# {name}: {full}" + (f"  [refs: {', '.join(Path(r).name for r in refs)}]" if refs else ""))
    if args.dry_run:
        return

    try:
        pipe, device = load_pipeline(model_id, any(j[4] for j in jobs))
    except ImportError as e:
        sys.exit(f"{e}\nInstall: pip3 install torch torchvision diffusers transformers accelerate safetensors")

    import random

    base = args.seed if args.seed is not None else random.randrange(2**31)
    args.out.mkdir(parents=True, exist_ok=True)
    for prompt, style, name, record, refs in jobs:
        full = prompt if args.no_style else f"{prompt}, {style}"
        saved = []
        for i in range(args.n):
            seed = base + i
            t = time.time()
            img = run(pipe, device, full, args.negative, steps, guidance, size, seed, refs, args.ref_scale)
            out = args.out / f"{name}-{i + 1}.png"
            img.save(out)
            saved.append(out)
            print(f"  {out.relative_to(ROOT)}  seed {seed}  {time.time() - t:.0f}s")

        if args.into and record and saved:
            sys.path.insert(0, str(TOOLS))
            import img2b64  # background removal + assets/images + JSON

            t, c = img2b64.CUT_PRESETS[args.cut]
            img2b64.write_into_json(record, img2b64.to_png_bytes(saved[0], 512, (t, c, 0.0)))

    print(f"\nDone. Re-run a variant you like with --seed <its seed> -n 1 (e.g. with more --steps).")


if __name__ == "__main__":
    main()
