#!/usr/bin/env python3
"""Generate an eikon starter portrait via Anima (ComfyUI API).

  gen_starter.py <name> <prompt> [--seed N] [--size 512] [--n 1]

Writes faces/<name>-512.png (+ _<i> variants for --n>1) and copies
into ComfyUI/input/. Frees VRAM first (model-family swap from Wan).
"""
import argparse, json, random, shutil, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path

HOST = "http://127.0.0.1:8188"
COMFY = Path.home() / "Dev/comfy/ComfyUI"
FACES = Path(__file__).resolve().parents[1] / "faces"

# Composition is fixed across all eikon starters: the JRPG dialogue-
# portrait crop (think SNES RPG bust / fighting-game VS screen) — subject
# fills the frame, shoulders meet the bottom edge, crown grazes the top.
# Per-avatar prompts describe ONLY the subject; FRAME and STYLE are
# appended here so framing doesn't drift per author.
FRAME = ("JRPG dialogue portrait composition, tight bust crop, head and "
         "shoulders only, subject fills 90% of the frame, top of head "
         "nearly touches top edge, shoulders meet bottom edge, centered, "
         "profile facing left")
STYLE = ("monochrome manga ink illustration, black and white, seinen "
         "linework, bold hatching, hard shadows, high contrast, pure "
         "black background")
NEG = ("worst quality, low quality, score_1, score_2, score_3, blurry, "
       "jpeg artifacts, signature, watermark, text, logo, color, "
       "colorful, vibrant, saturated, border, frame, vignette, cropped, "
       "out of frame, full body, hands, fingers, extra limbs, deformed, "
       "pixel art, 8-bit, 16-bit, sprite, pixelated, dithering, "
       "white background, grey background, soft shading, gradient")


def http(method, path, data=None, timeout=60):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"{HOST}{path}", data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else {}


def build(prompt: str, neg: str, seed: int, w: int, h: int, prefix: str) -> dict:
    return {
        "44": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "anima-preview3-base.safetensors",
            "weight_dtype": "default"}},
        "45": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": "qwen_3_06b_base.safetensors",
            "type": "stable_diffusion", "device": "default"}},
        "15": {"class_type": "VAELoader", "inputs": {
            "vae_name": "qwen_image_vae.safetensors"}},
        "11": {"class_type": "CLIPTextEncode", "inputs": {
            "clip": ["45", 0], "text": prompt}},
        "12": {"class_type": "CLIPTextEncode", "inputs": {
            "clip": ["45", 0], "text": neg}},
        "28": {"class_type": "EmptyLatentImage", "inputs": {
            "width": w, "height": h, "batch_size": 1}},
        "19": {"class_type": "KSampler", "inputs": {
            "model": ["44", 0], "positive": ["11", 0],
            "negative": ["12", 0], "latent_image": ["28", 0],
            "seed": seed, "steps": 30, "cfg": 4.0,
            "sampler_name": "er_sde", "scheduler": "simple",
            "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {
            "samples": ["19", 0], "vae": ["15", 0]}},
        "46": {"class_type": "SaveImage", "inputs": {
            "images": ["8", 0], "filename_prefix": prefix}},
    }


def run(prompt_graph, label, timeout_s=300):
    try:
        r = http("POST", "/prompt", {"prompt": prompt_graph})
    except urllib.error.HTTPError as e:
        print(f"[{label}] SUBMIT {e.code}: {e.read().decode()[:800]}",
              file=sys.stderr)
        return None
    pid = r.get("prompt_id")
    if not pid:
        print(f"[{label}] SUBMIT FAILED: {json.dumps(r)[:400]}",
              file=sys.stderr)
        return None
    print(f"[{label}] queued {pid}", flush=True)
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            h = http("GET", f"/history/{pid}")
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"[{label}] poll err ({e}); retry", file=sys.stderr)
            time.sleep(3); continue
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("completed"):
                for o in h[pid].get("outputs", {}).values():
                    for im in o.get("images", []):
                        return COMFY / "output" / im["subfolder"] / im["filename"]
            if st.get("status_str") == "error":
                print(f"[{label}] ERROR {json.dumps(st)[:400]}",
                      file=sys.stderr)
                return None
        time.sleep(2)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("prompt")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--size", type=int, default=512,
                    help="final square edge length")
    ap.add_argument("--ar", type=float, default=1.0,
                    help="gen aspect h/w; >1 = portrait")
    ap.add_argument("--top-crop", action="store_true",
                    help="crop top size×size from portrait gen")
    ap.add_argument("--neg", default="",
                    help="extra negative tokens, appended to NEG")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--raw", action="store_true",
                    help="skip FRAME+STYLE suffix; prompt is used verbatim")
    ap.add_argument("--no-free", action="store_true")
    a = ap.parse_args()

    if not a.no_free:
        http("POST", "/free", {"unload_models": True, "free_memory": True})
        print("freed VRAM (Wan→Anima swap)", flush=True)

    FACES.mkdir(exist_ok=True)
    head = "masterpiece, best quality, score_7, safe,\n"
    full = (head + a.prompt if a.raw
            else f"{head}{a.prompt}. {FRAME}. {STYLE}.")
    neg = f"{NEG}, {a.neg}" if a.neg else NEG
    w = a.size
    h = (int(a.size * a.ar) + 7) & ~7  # VAE stride 8
    outs = []
    for i in range(a.n):
        seed = a.seed if (a.seed and a.n == 1) else random.randrange(1, 2**48)
        label = f"{a.name}#{i}" if a.n > 1 else a.name
        out = run(build(full, neg, seed, w, h, f"eikon/starter-{a.name}"),
                  label)
        if not out:
            continue
        suffix = f"_{i}" if a.n > 1 else ""
        dst = FACES / f"{a.name}-{a.size}{suffix}.png"
        if a.top_crop and h > w:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(out),
                            "-vf", f"crop={w}:{w}:0:0", str(dst)], check=True)
        else:
            shutil.copy2(out, dst)
        shutil.copy2(dst, COMFY / "input" / dst.name)
        print(f"[{label}] seed={seed} → {dst}")
        outs.append(str(dst))
    print(json.dumps({"name": a.name, "outputs": outs}))


if __name__ == "__main__":
    main()
