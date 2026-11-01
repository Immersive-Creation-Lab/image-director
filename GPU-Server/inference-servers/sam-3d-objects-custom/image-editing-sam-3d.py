import sys
import os
import base64
import tempfile
from io import BytesIO
import json
from typing import Optional

from flask import Flask, request, jsonify
from PIL import Image
import numpy as np

# expose notebook inference utilities
sys.path.append("notebook")
from inference import Inference, make_scene

# try optional background removal
try:
    import rembg
    _REMBG_AVAILABLE = True
    _rembg_session = rembg.new_session()
except Exception:
    _REMBG_AVAILABLE = False
    _rembg_session = None

# load model once on import
TAG = "hf"
CONFIG_PATH = f"checkpoints/{TAG}/pipeline.yaml"
print(f"[INFO] Loading Inference pipeline from {CONFIG_PATH}")
inference = Inference(CONFIG_PATH, compile=False)

app = Flask(__name__)


def _decode_base64_image(data: str) -> Image.Image:
    if data.startswith("data:image"):
        data = data.split(",", 1)[1]
    image_bytes = base64.b64decode(data)
    return Image.open(BytesIO(image_bytes)).convert("RGBA")


def _prepare_image_and_mask(pil_image: Image.Image, mask_b64: Optional[str] = None):
    # ensure RGBA
    image = pil_image.convert("RGBA")
    arr = np.array(image).astype(np.uint8)

    # mask from alpha channel if present (some images may be fully opaque)
    if arr.shape[-1] == 4 and np.any(arr[..., 3] != 255):
        mask = arr[..., 3] > 0
        rgb = arr[..., :3]
        return rgb, mask

    # mask provided explicitly
    if mask_b64 is not None:
        try:
            mask_img = _decode_base64_image(mask_b64)
            mask_arr = np.array(mask_img)[..., 3] if mask_img.mode == "RGBA" else np.array(mask_img)[..., 0]
            mask = mask_arr > 0
            rgb = arr[..., :3]
            return rgb, mask
        except Exception:
            pass

    # try rembg if available to get alpha
    if _REMBG_AVAILABLE:
        try:
            carved = rembg.remove(arr, session=_rembg_session)
            carved = np.array(carved)
            if carved.ndim == 3 and carved.shape[-1] == 4:
                mask = carved[..., 3] > 0
                rgb = carved[..., :3]
                return rgb, mask
        except Exception:
            pass

    # fallback: use full mask (everything)
    rgb = arr[..., :3]
    mask = np.ones(rgb.shape[:2], dtype=bool)
    return rgb, mask


@app.route("/process", methods=["POST"])
def process():
    try:
        data = request.get_json(force=True)
        if not data or "image" not in data:
            return jsonify({"error": "No image provided"}), 400

        img_b64 = data["image"]
        mask_b64 = data.get("mask", None)
        seed = data.get("seed", 42)

        pil_image = _decode_base64_image(img_b64)
        rgb, mask = _prepare_image_and_mask(pil_image, mask_b64)

        # call inference
        outputs = inference(rgb, mask, seed=seed)
        
        # convert tensor/ndarray to plain Python list
        def _to_list(x, first_elem=True):
            """
            Convert torch/numpy/list scalars/arrays to plain Python types.
            If `first_elem` is True and the input has shape (1, N, ...),
            unwrap the leading singleton dimension and return the first element.
            """
            import torch
            import numpy as _np

            if x is None:
                return None

            # Normalize to numpy array where possible
            if isinstance(x, torch.Tensor):
                arr = x.detach().cpu().numpy()
            elif isinstance(x, _np.ndarray):
                arr = x
            elif isinstance(x, (list, tuple)):
                try:
                    arr = _np.array(x)
                except Exception:
                    return list(x)
            else:
                return x

            # Scalars
            if arr.ndim == 0:
                return arr.item()

            # Unwrap leading singleton batch dim: [[...]] -> [...]
            if first_elem and arr.ndim >= 2 and arr.shape[0] == 1:
                arr = arr[0]

            return arr.tolist()

        rot = outputs.get("rotation")
        trans = outputs.get("translation")
        scale = outputs.get("scale")

        rot_list = _to_list(rot) if rot is not None else None
        trans_list = _to_list(trans) if trans is not None else None
        scale_list = _to_list(scale) if scale is not None else None


        posed_scene = make_scene(outputs, in_place=True)

        # save PLY to temp file
        with tempfile.TemporaryDirectory() as tmpdir:
            ply_path = os.path.join(tmpdir, "output.ply")
            # Inference pipeline postprocess sets `gs` key when gaussian present
            if "gs" in outputs:
                outputs["gs"].save_ply(ply_path)
            else:
                return jsonify({"error": "No gaussian output available"}), 500

            with open(ply_path, "rb") as f:
                ply_bytes = f.read()
            ply_b64 = base64.b64encode(ply_bytes).decode("utf-8")

        return jsonify({
            "status": "success", 
            "ply_data": ply_b64, 
            "filename": "output.ply",
            "rotation": rot_list,
            "translation": trans_list,
            "scale": scale_list,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # default port 5001, listen on all interfaces
    app.run(host="0.0.0.0", port=5001)
