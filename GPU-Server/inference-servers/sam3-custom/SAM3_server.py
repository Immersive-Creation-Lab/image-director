from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import cv2
import numpy as np
import torch
from io import BytesIO
import base64
import requests
import os
import time
import uuid

# Import BOTH sets of models
from transformers import Sam3TrackerProcessor, Sam3TrackerModel # For Points
from transformers import Sam3Processor, Sam3Model               # For Text

app = Flask(__name__)
CORS(app)


device = "cuda" if torch.cuda.is_available() else "cpu"

print("----------------------------------------------------------------")
print(f" Initializing SAM3 Hybrid Server on {device}...")

# 1. Load Point/Tracker Model
print("1/2 Loading Point Model (Sam3Tracker)...")
try:
    model_points = Sam3TrackerModel.from_pretrained("facebook/sam3").to(device)
    processor_points = Sam3TrackerProcessor.from_pretrained("facebook/sam3")
    print("    Point Model Loaded.")
except Exception as e:
    print(f"    Failed to load Point Model: {e}")

# 2. Load Text Model
print("2/2 Loading Text Model (Sam3Base)...")
try:
    model_text = Sam3Model.from_pretrained("facebook/sam3").to(device)
    processor_text = Sam3Processor.from_pretrained("facebook/sam3")
    print("    Text Model Loaded.")
except Exception as e:
    print(f"    Failed to load Text Model: {e}")

print("----------------------------------------------------------------")

def encode_visuals(img_np, bin_mask, points=[], prefix="vis"):
    """
    1. Generates the Green Mask + Red Dot visualization.
    2. SAVES it to disk.
    3. Returns base64 strings for the response.
    """
    height, width = img_np.shape[:2]
    
    # --- Visualization Logic ---
    #visualization = img_np.copy()
    #color_mask = np.zeros_like(visualization)
    #color_mask[bin_mask == 1] = [0, 255, 0] # Green
    #visualization = cv2.addWeighted(visualization, 0.5, color_mask, 0.5, 0)
    visualization = np.zeros((height, width, 4), dtype=np.uint8)
    
    visualization[bin_mask == 1] = [0, 255, 0, 128]

    # for px, py in points:
    #     # Outline ring so the green mask shows through the center
    #     cv2.circle(visualization, (int(px), int(py)), 8, (255, 255, 255), 2)
    

    # --- Prepare Response Data ---
    # Calculate BBox
    ys, xs = np.where(bin_mask == 1)
    bbox = None
    if len(xs) > 0 and len(ys) > 0:
        bbox = {
            "minX": float(xs.min()) / width,
            "minY": float(ys.min()) / height,
            "maxX": float(xs.max()) / width,
            "maxY": float(ys.max()) / height
        }

    # Encode Visualization to Base64
    buf = BytesIO()
    Image.fromarray(visualization).save(buf, format="PNG")
    vis_b64 = base64.b64encode(buf.getvalue()).decode()

    # Encode Mask to Base64
    buf2 = BytesIO()
    Image.fromarray((bin_mask * 255).astype(np.uint8)).save(buf2, format="PNG")
    mask_b64 = base64.b64encode(buf2.getvalue()).decode()
    
    return vis_b64, mask_b64, bbox

@app.route('/segment', methods=['POST'])
def segment():
    try:
        data = request.json
        if not data: return jsonify({"error": "Invalid JSON"}), 400

        image_url = data.get("image_url")
        raw_points = data.get("input_points", []) 
        raw_labels = data.get("input_labels", [])
        text_prompt = data.get("text_prompt", None)

        # -------------------------------------------------------
        # 1. Load Image 
        # -------------------------------------------------------
        if not image_url: return jsonify({"error": "image_url required"}), 400

        if image_url.startswith("data:image"):
            img = Image.open(BytesIO(base64.b64decode(image_url.split(",")[1]))).convert("RGB")
        else:
            img = Image.open(BytesIO(requests.get(image_url).content)).convert("RGB")
        
        img_np = np.array(img)
        height, width = img_np.shape[:2]
        
        out_results = []

        # =======================================================
        #  TEXT PROMPT (Using Sam3Base)
        # =======================================================
        if text_prompt and (not raw_points or len(raw_points) == 0):
            print(f" Text Mode: Processing prompt '{text_prompt}'")
            
            inputs = processor_text(images=img, text=text_prompt, return_tensors="pt").to(device)
            
            with torch.no_grad():
                outputs = model_text(**inputs)
            
            target_sizes = inputs["original_sizes"].cpu().tolist()

            results = processor_text.post_process_instance_segmentation(
                outputs, 
                threshold=0.5, 
                mask_threshold=0.5, 
                target_sizes=target_sizes
            )[0]
            
            masks = results["masks"].cpu().numpy() # (N, H, W)
            scores = results["scores"].cpu().numpy()
            
            for i, mask in enumerate(masks):
                bin_mask = (mask > 0).astype(np.uint8)
                score = float(scores[i])
                
                vis_b64, mask_b64, bbox = encode_visuals(img_np, bin_mask, points=[], prefix="text")
                
                out_results.append({
                    "score": score,
                    "mask": mask_b64,
                    "visualization": vis_b64,
                    "bbox": bbox
                })

        # =======================================================
        #  POINTS / CLICKS (Using Sam3Tracker)
        elif raw_points and len(raw_points) > 0:
            print(f" Point Mode: Processing {len(raw_points)} input groups")
            
            # Formatting Logic
            objects_points = []
            objects_labels = []
            pixel_point_list = []

            is_multi_object = (isinstance(raw_points[0], list) and len(raw_points[0]) > 0 and isinstance(raw_points[0][0], list))
            
            if not is_multi_object:
                # Single Obj
                current_obj_pts = []
                current_obj_lbls = []
                source_labels = raw_labels if len(raw_labels) > 0 else [1] * len(raw_points)
                for i, pt in enumerate(raw_points):
                    x, y = pt[:2]
                    px, py = (int(x * width), int(y * height)) if (0 <= x <= 1 and 0 <= y <= 1) else (int(x), int(y))
                    current_obj_pts.append([px, py])
                    current_obj_lbls.append(int(source_labels[i]) if i < len(source_labels) else 1)
                    pixel_point_list.append((px, py))
                objects_points.append(current_obj_pts)
                objects_labels.append(current_obj_lbls)
            else:
                # Multi Obj
                for obj_idx, obj_pts in enumerate(raw_points):
                    current_obj_pts = []
                    current_obj_lbls = []
                    obj_lbl_source = raw_labels[obj_idx] if (len(raw_labels) > obj_idx and isinstance(raw_labels[obj_idx], list)) else [1] * len(obj_pts)
                    for i, pt in enumerate(obj_pts):
                        x, y = pt[:2]
                        px, py = (int(x * width), int(y * height)) if (0 <= x <= 1 and 0 <= y <= 1) else (int(x), int(y))
                        current_obj_pts.append([px, py])
                        current_obj_lbls.append(int(obj_lbl_source[i]) if i < len(obj_lbl_source) else 1)
                        pixel_point_list.append((px, py))
                    objects_points.append(current_obj_pts)
                    objects_labels.append(current_obj_lbls)

            # Inference
            process_args = { "images": img, "return_tensors": "pt", "input_points": [objects_points], "input_labels": [objects_labels] }
            inputs = processor_points(**process_args).to(device)

            with torch.no_grad():
                outputs = model_points(**inputs)

            if "reshaped_input_sizes" in inputs:
                reshaped_input_sizes = inputs["reshaped_input_sizes"].cpu().tolist()
            else:
                h, w = inputs["pixel_values"].shape[-2:]
                reshaped_input_sizes = [[h, w]]
            
            original_sizes = inputs["original_sizes"].cpu().tolist()

            # Post-processing
            masks_result = processor_points.post_process_masks(
                outputs.pred_masks.cpu(),
                original_sizes,
            )[0]

            scores_result = outputs.iou_scores.cpu().numpy()[0]

            for obj_i in range(masks_result.shape[0]):
                best_idx = np.argmax(scores_result[obj_i])
                score = float(scores_result[obj_i][best_idx])
                mask_np = masks_result[obj_i, best_idx, :, :].numpy()
                bin_mask = (mask_np > 0.0).astype(np.uint8)

                vis_b64, mask_b64, bbox = encode_visuals(img_np, bin_mask, points=pixel_point_list, prefix="point")

                out_results.append({
                    "score": score,
                    "mask": mask_b64,
                    "visualization": vis_b64,
                    "bbox": bbox
                })
        else:
            return jsonify({"error": "Please provide either 'input_points' or 'text_prompt'"}), 400

        # Return Result
        return jsonify({
            "status": "success",
            "masks": out_results,
            "debug": {
                "mode": "text" if text_prompt and not raw_points else "points",
                "count": len(out_results)
            }
        })


    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e), "type": type(e).__name__}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5007, threaded=True)
