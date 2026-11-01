import logging
import os
import sys
import traceback
import base64
from io import BytesIO
import time # Added for unique filename generation

# --- Set up Environment and Paths ---

# 1. Define LAMA_ROOT_DIR (one level above bin/)
LAMA_BIN_DIR = os.path.dirname(os.path.abspath(__file__))
LAMA_ROOT_DIR = os.path.abspath(os.path.join(LAMA_BIN_DIR, '..'))

# 2. CRITICAL: Add the project root to sys.path for LaMa's internal imports (saicinpainting.*)
sys.path.insert(0, LAMA_ROOT_DIR)

# Suppress warnings and set environment variables
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'
os.environ['VECLIB_MAXIMUM_THREADS'] = '1'
os.environ['NUMEXPR_NUM_THREADS'] = '1'

import cv2
import hydra
import numpy as np
import torch
import yaml
import torch.nn.functional as F
from omegaconf import OmegaConf
from PIL import Image
from flask import Flask, request, jsonify
from flask_cors import CORS

from saicinpainting.evaluation.utils import move_to_device
from saicinpainting.evaluation.refinement import refine_predict
from saicinpainting.training.trainers import load_checkpoint

LOGGER = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global variables to store the loaded model and config
LAMA_MODEL = None
TRAIN_CONFIG = None
PREDICT_CONFIG = None
# Set device (CPU as a fallback, but CUDA is likely needed for speed)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Define the debug/output directory
DEBUG_OUTPUT_DIR = os.path.join(LAMA_ROOT_DIR, 'lama_debug_outputs')
# Ensure the directory exists
os.makedirs(DEBUG_OUTPUT_DIR, exist_ok=True)

# --- Utility Functions for Image Conversion ---

def decode_image_from_base64(b64_string):
    """Decodes a base64 string (PNG format) into a PIL Image."""
    if 'base64,' in b64_string:
        b64_string = b64_string.split('base64,')[1]
    image_bytes = base64.b64decode(b64_string)
    return Image.open(BytesIO(image_bytes))

def encode_image_to_base64(image_np):
    """Encodes a HxWxC numpy array (uint8, RGB) into a Base64 PNG data URL."""
    img_pil = Image.fromarray(image_np, 'RGB')
    buffer = BytesIO()
    img_pil.save(buffer, format='PNG')
    img_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return f"data:image/png;base64,{img_b64}"

# --- Model Loading (Run once on startup) ---

def load_lama_model():
    """Loads the LaMa model into the global variable by manually loading configs."""
    global LAMA_MODEL, TRAIN_CONFIG, PREDICT_CONFIG

    # Path to the prediction config file relative to LAMA_ROOT_DIR
    PREDICT_CONFIG_PATH = os.path.join(LAMA_ROOT_DIR, 'configs', 'prediction', 'default.yaml')

    try:
        PREDICT_CONFIG = OmegaConf.load(PREDICT_CONFIG_PATH)
        PREDICT_CONFIG.dataset.res = 8    
        CHECKPOINT_FOLDER_NAME = 'big-lama' 
        PREDICT_CONFIG.model.path = CHECKPOINT_FOLDER_NAME
        
        model_root_path = os.path.join(LAMA_ROOT_DIR, PREDICT_CONFIG.model.path)
        
        train_config_path = os.path.join(model_root_path, 'config.yaml')
        with open(train_config_path, 'r') as f:
            TRAIN_CONFIG = OmegaConf.create(yaml.safe_load(f))
        
        TRAIN_CONFIG.training_model.predict_only = True
        TRAIN_CONFIG.visualizer.kind = 'noop'

        # 4. Load the checkpoint file
        checkpoint_path = os.path.join(model_root_path, 
                                       'models', 
                                       PREDICT_CONFIG.model.checkpoint)
        
        # 5. Load the model and move it to the device
        model = load_checkpoint(TRAIN_CONFIG, checkpoint_path, strict=False, map_location=DEVICE)
        model.freeze()
        if not PREDICT_CONFIG.get('refine', False):
            model.to(DEVICE)
        LAMA_MODEL = model
        LOGGER.info(f"LaMa model loaded successfully on {DEVICE}")

    except Exception as e:
        LOGGER.error(f"Failed to load LaMa model from {LAMA_ROOT_DIR}: {e}", exc_info=True)
        # Re-raise the error so the main block catches it and LAMA_MODEL remains None
        raise e

def pad_batch(batch, pad_mod=8):
    """
    Pads a batch of images and masks so that their height and width are a multiple of pad_mod.
    """
    # Get image tensor from the batch dictionary
    image = batch['image']

    # Image shape is (Batch, Channels, Height, Width)
    B, C, H, W = image.shape

    # Calculate how much padding is needed for height and width
    pad_h = (pad_mod - H % pad_mod) % pad_mod
    pad_w = (pad_mod - W % pad_mod) % pad_mod

    # Apply padding. The padding tuple is (pad_left, pad_right, pad_top, pad_bottom).
    # We only pad the right and bottom edges.
    padded_image = F.pad(image, (0, pad_w, 0, pad_h), 'reflect')

    # Update the batch with the new padded image
    batch['image'] = padded_image

    # Also pad the mask if it exists in the batch
    if 'mask' in batch:
        mask = batch['mask']
        # Use 'constant' padding for the mask, filling with 0
        padded_mask = F.pad(mask, (0, pad_w, 0, pad_h), 'constant', 0)
        batch['mask'] = padded_mask

    return batch
# --- Preprocessing Logic (basedon predict.py logic) ---

def preprocess_for_lama(image_pil, mask_pil, config):
    """
    Handles the required preprocessing for LaMa model input, including
    converting, normalizing, and most importantly, padding the image.
    """

    # 1. Convert PIL to NumPy
    image_np = np.array(image_pil.convert('RGB'))
    mask_np = np.array(mask_pil.convert('L'))

    # 2. Save original size for unpadding
    H, W = image_np.shape[:2]

    # 3. Binarize mask (0 or 1 float)
    # Note: Binarization should be before padding
    mask_np = (mask_np > 127).astype(np.float32)

    # 4. Normalization and Tensor Conversion
    # Tensors must be: [1, C, H, W]
    image_tensor = torch.from_numpy(image_np / 255.0).permute(2, 0, 1).unsqueeze(0).float()
    mask_tensor = torch.from_numpy(mask_np).unsqueeze(0).unsqueeze(0).float()

    batch = {
        'image': image_tensor,
        'mask': mask_tensor,
        'unpad_to_size': (H, W) # Original size before padding/resizing
    }

    batch = pad_batch(batch, config.dataset.res)

    return batch
# --- Flask Endpoint ---

@app.route('/inpaint', methods=['POST'])
def inpaint_api():
    # Return 503 if the model failed to load at startup
    if LAMA_MODEL is None:
        return jsonify({'error': 'LaMa model not loaded'}), 503

    data = request.json

    # Generate a unique ID for this request for filenames
    timestamp = int(time.time() * 1000)
    request_id = f"req_{timestamp}"

    try:
        # 1. Decode inputs
        original_image_pil = decode_image_from_base64(data['image'])
        mask_image_pil = decode_image_from_base64(data['mask'])

        # --- NEW CODE: Save input images for debug/storage ---
        try:
            input_image_path = os.path.join(DEBUG_OUTPUT_DIR, f'input_image_{request_id}.png')
            input_mask_path = os.path.join(DEBUG_OUTPUT_DIR, f'input_mask_{request_id}.png')
            original_image_pil.save(input_image_path)
            mask_image_pil.save(input_mask_path)
            LOGGER.info(f"Saved input image to {input_image_path}")
        except Exception as file_save_error:
            # Log the error but continue, as saving is secondary to the main task
            LOGGER.warning(f"Could not save input images: {file_save_error}")


        # 2. Preprocess
        batch = preprocess_for_lama(original_image_pil, mask_image_pil, PREDICT_CONFIG)

        unpad_to_size = batch.pop('unpad_to_size') # Extract and remove the tuple of ints
        batch = move_to_device(batch, DEVICE)     # Move only Tensors
        h, w = unpad_to_size
        batch['unpad_to_size'] = (torch.tensor([h]), torch.tensor([w]))



        # 3. Core LaMa Inference Logic (from predict.py)
        with torch.no_grad():
            #batch['mask'] = (batch['mask'] > 0) * 1
            batch['mask'] = (batch['mask'] > 0).float()
            if PREDICT_CONFIG.get('refine', False):
                # Refinement path (complex, uses unpad_to_size implicitly)
                with torch.enable_grad():
                    cur_res_tensor = refine_predict(batch, LAMA_MODEL, **PREDICT_CONFIG.refiner)
                cur_res_tensor = cur_res_tensor[0].permute(1,2,0).detach().cpu().numpy()
                print(" Using REFINEMENT ")

            else:
                # Standard path
                batch = LAMA_MODEL(batch)
                cur_res_tensor = batch[PREDICT_CONFIG.out_key][0].permute(1, 2, 0).detach().cpu().numpy()

            # Unpadding logic (copied from predict.py)
            unpad_to_size = batch.get('unpad_to_size', None)
            if unpad_to_size is not None:
                orig_height, orig_width = unpad_to_size
                cur_res_tensor = cur_res_tensor[:orig_height, :orig_width]

        # 4. Convert float result (0-1) to uint8 (0-255)
        cur_res_np = np.clip(cur_res_tensor * 255, 0, 255).astype('uint8')

        try:
            output_image_path = os.path.join(DEBUG_OUTPUT_DIR, f'output_inpainted_{request_id}.png')
            Image.fromarray(cur_res_np, 'RGB').save(output_image_path)
            LOGGER.info(f"Saved output image to {output_image_path}")
        except Exception as file_save_error:
            LOGGER.warning(f"Could not save output image: {file_save_error}")

        # 5. Encode and return
        inpainted_b64_data_url = encode_image_to_base64(cur_res_np)

        return jsonify({
            'status': 'success',
            'inpainted_image': inpainted_b64_data_url
        })

    except Exception as e:
        LOGGER.error(f"Inpainting API failed: {e}", exc_info=True)
        return jsonify({'error': f'Internal server error during inference: {str(e)}'}), 500


# --- Main Execution ---

if __name__ == '__main__':
    # 1. Load the model once at startup
    try:
        load_lama_model()
    except Exception:
        # The model failed to load, LAMA_MODEL remains None. 
        # The /inpaint endpoint will correctly return 503.
        pass 
    
    # 2. Run Flask app on port 5002
    app.run(host='0.0.0.0', port=5002, debug=False)
