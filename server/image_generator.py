import os
import time
import uuid
import base64
import concurrent.futures
import cv2
import numpy as np
from io import BytesIO
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from flask_socketio import SocketIO
from PIL import Image, ImageChops
import requests
from google import genai
from werkzeug.utils import secure_filename
import json
load_dotenv()

app = Flask(__name__)
CORS(app) 
socketio = SocketIO(app, cors_allowed_origins="*")  

# Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
VM_KEY = os.getenv("VM_IP_ADDRESS")

client = genai.Client(api_key=GEMINI_API_KEY)

def extract_text_from_response(response):
    """Return only the non-thought text parts from a Gemini response."""
    text = ""
    for part in response.candidates[0].content.parts:
        if getattr(part, "thought", False):
            continue  # skip thinking / thought_signature parts
        if getattr(part, "text", None):
            text += part.text
    return text



def call_gemini(prompt, image_filename=None, model="gemini-2.5-flash-image"):
    try:
        from google.genai import types
        contents = []


        if image_filename:
            image_path = os.path.join("generated_images", image_filename)
            if not os.path.exists(image_path):
                raise FileNotFoundError(f"Image file {image_path} not found")


            image = Image.open(image_path)
            buffer = BytesIO()
            image.save(buffer, format="PNG")
            buffer.seek(0)


            image_part = types.Part.from_bytes(
                data=buffer.getvalue(),
                mime_type="image/png",
            )
            contents.append(image_part)


        contents.append(prompt)


        config = types.GenerateContentConfig(
                response_modalities=["Text", "Image"],
                candidate_count=1,
        )
        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )


        text_response = extract_text_from_response(response)
        image_bytes = None

        for part in response.candidates[0].content.parts:
            if getattr(part, "thought", False):
                continue
            if hasattr(part, "inline_data") and part.inline_data:
                image_bytes = part.inline_data.data


        if not image_bytes:
            raise Exception("No image data found in response")


        return {"image_bytes": image_bytes, "text_response": text_response}


    except Exception as e:
        app.logger.error(f"Gemini generation error: {e}", exc_info=True)
        raise


@app.route('/classify_intent', methods=['POST'])
def classify_intent():
    """
    Classifies user prompt as GENERATE or EDIT intent.
    """
    data = request.json
    user_prompt = data.get('prompt')
    if not user_prompt: 
        return jsonify({'error': 'No prompt'}), 400

    try:
        system_instruction = """
                You are an intent classifier for an image editing assistant.

                Classify the user's prompt into exactly one of two intents:

                1. **EDIT** — Spatial or geometric changes only, with no content modification.
                    - Position: move, shift, pan, place, center, align, nudge, drag
                    - Rotation: rotate, turn, spin, flip, tilt, angle
                    - Scale: zoom, resize, make bigger/smaller, enlarge, shrink, scale up/down
                    - Examples: "Move Mario to the right", "Rotate it 90 degrees", "Make him bigger", "Flip horizontally"

                2. **GENERATE** — Anything that creates, modifies, or changes the content or appearance of an image.
                    - New image: "A cat on a rooftop", "Mario playing tennis"
                    - Style changes: "Make it look like a painting", "Add a watercolor effect"
                    - Element changes: "Give him a hat", "Remove the tree", "Change his shirt to red"
                    - Examples: "Turn Mario into a zombie", "Draw a dragon", "Make the sky purple"

                Rules:
                - If the prompt involves ONLY position, rotation, or scale → EDIT.
                - If there is any content, style, or subject change — even alongside a spatial change → GENERATE.
                - When in doubt, prefer GENERATE.

                Return ONLY valid JSON with no explanation:
                {"intent": "EDIT"} or {"intent": "GENERATE"}
        """
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=[f"Prompt: {user_prompt}"],
            config={
                "response_mime_type": "application/json", 
                "system_instruction": system_instruction
            }
        )
        resp_text = extract_text_from_response(response)
        result = json.loads(resp_text) if resp_text else {"intent": "GENERATE"}
        print(f"[Intent Classification] Prompt: '{user_prompt}'  Intent: {result.get('intent')}")
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"Intent Error: {e}")
        return jsonify({'intent': 'GENERATE'})


def _interpret_3d_command(command):
    """
    Converts a natural language 3D command string to structured JSON.
    Used by the prepare stage.
    """
    system_instruction = """
        Translate natural language 3D transformation commands into structured JSON.

        ## Coordinate System
        - X axis: Left (−) / Right (+)
        - Y axis: Down (−) / Up (+)
        - Z axis: Back (−) / Forward (+)

        ## Rotation Conventions
        - Rotate around Y → Yaw   (turning left/right)
        - Rotate around X → Pitch (tilting up/down)
        - Rotate around Z → Roll  (leaning/banking)

        ## Output Schema
        Return a JSON object with a `transformations` array. Each element represents one
        discrete operation. For uniform scale, omit `axis` and set `uniform: true`.

        {
        "transformations": [
            {
            "action":         "rotate" | "pan" | "scale" | "reset",
            "axis":           "x" | "y" | "z",        // omit if uniform scale
            "uniform":        boolean,                 // true = scale all axes equally
            "value":          float,
                                // rotate  → degrees (positive = right/up/clockwise per axis)
                                // pan     → world units
                                // scale   → multiplier (e.g. 2.0 = double, 0.5 = half)
            "relative":       boolean,
                                // true  = add delta to current transform
                                // false = set absolute value, ignoring current state
            "confidence":     "high" | "medium" | "low",
                                // high   → command was fully explicit
                                // medium → magnitude or direction inferred from qualifier table
                                // low    → both axis and magnitude were inferred
            "interpretation": string  // human-readable explanation of any inference made;
                                        // omit if confidence is "high"
            }
        ],
        "summary": {
            "position": { "x": float | null, "y": float | null, "z": float | null },
            "rotation": { "x": float | null, "y": float | null, "z": float | null },
            "scale":    { "x": float | null, "y": float | null, "z": float | null }
        }
        }

        ## Rules
        - `summary` reflects the net result AFTER applying all transformations in order.
        - If the current state is unknown, set summary values to `null`.
        - Relative scale is always a multiplier applied to the CURRENT scale, not an additive offset.
        - Absolute scale (`relative: false`) sets the scale factor directly (1.0 = original size).
        - When a reset is issued, all summary values return to their identity state:
        position (0, 0, 0), rotation (0, 0, 0), scale (1, 1, 1).

        ## Ambiguous Magnitude Qualifiers
        When no explicit numeric value is given, map descriptive qualifiers to defaults:

        | Qualifier                         | Pan (units) | Rotate (degrees) | Scale (multiplier) |
        |-----------------------------------|-------------|------------------|--------------------|
        | "slightly", "a bit", "a little"   | 0.25        | 15               | 1.2                |
        | (no qualifier / neutral)          | 1.0         | 45               | 1.5                |
        | "a lot", "much", "significantly"  | 2.0         | 90               | 3.0                |
        | "hugely", "massively", "extremely"| 5.0         | 180              | 4.0                |

        ## Ambiguous Direction Defaults
        When axis or direction is unspecified, apply these fallbacks:

        | Command phrasing          | Assumed axis | Assumed direction                        |
        |---------------------------|--------------|------------------------------------------|
        | "make it bigger/larger"   | uniform      | + (scale up)                             |
        | "make it smaller"         | uniform      | − (reciprocal of equivalent scale-up)    |
        | "move it" (no direction)  | y            | + (up)                                   |
        | "rotate it" (no axis)     | y            | + (yaw right)                            |

        ## Examples

        "Rotate right 30 degrees"
        → {
            "transformations": [
            { "action": "rotate", "axis": "y", "value": 30, "relative": true, "confidence": "high" }
            ],
            "summary": { "position": null, "rotation": { "x": null, "y": 30, "z": null }, "scale": null }
        }

        "Turn left 45"
        → {
            "transformations": [
            { "action": "rotate", "axis": "y", "value": -45, "relative": true, "confidence": "high" }
            ],
            "summary": { "position": null, "rotation": { "x": null, "y": -45, "z": null }, "scale": null }
        }

        "Tilt up 20 degrees"
        → {
            "transformations": [
            { "action": "rotate", "axis": "x", "value": 20, "relative": true, "confidence": "high" }
            ],
            "summary": { "position": null, "rotation": { "x": 20, "y": null, "z": null }, "scale": null }
        }

        "Move forward and to the right"
        → {
            "transformations": [
            { "action": "pan", "axis": "z", "value": 1.0, "relative": true, "confidence": "high" },
            { "action": "pan", "axis": "x", "value": 1.0, "relative": true, "confidence": "high" }
            ],
            "summary": { "position": { "x": 1.0, "y": null, "z": 1.0 }, "rotation": null, "scale": null }
        }

        "Move it slightly to the left"
        → {
            "transformations": [
            { "action": "pan", "axis": "x", "value": -0.25, "relative": true,
                "confidence": "medium", "interpretation": "'slightly' mapped to 0.25 units" }
            ],
            "summary": { "position": { "x": -0.25, "y": null, "z": null }, "rotation": null, "scale": null }
        }

        "Make it twice as big"
        → {
            "transformations": [
            { "action": "scale", "uniform": true, "value": 2.0, "relative": true, "confidence": "high" }
            ],
            "summary": { "position": null, "rotation": null, "scale": { "x": 2.0, "y": 2.0, "z": 2.0 } }
        }

        "Make it bigger"
        → {
            "transformations": [
            { "action": "scale", "uniform": true, "value": 1.5, "relative": true,
                "confidence": "medium", "interpretation": "No magnitude given; defaulted to 1.5× uniform scale" }
            ],
            "summary": { "position": null, "rotation": null, "scale": { "x": 1.5, "y": 1.5, "z": 1.5 } }
        }

        "Make it a lot bigger"
        → {
            "transformations": [
            { "action": "scale", "uniform": true, "value": 2.0, "relative": true,
                "confidence": "medium", "interpretation": "'a lot' mapped to 2.0× multiplier" }
            ],
            "summary": { "position": null, "rotation": null, "scale": { "x": 2.0, "y": 2.0, "z": 2.0 } }
        }

        "Stretch along the X axis by 50%"
        → {
            "transformations": [
            { "action": "scale", "axis": "x", "uniform": false, "value": 1.5, "relative": true, "confidence": "high" }
            ],
            "summary": { "position": null, "rotation": null, "scale": { "x": 1.5, "y": null, "z": null } }
        }

        "Move it"
        → {
            "transformations": [
            { "action": "pan", "axis": "y", "value": 1.0, "relative": true,
                "confidence": "low", "interpretation": "No axis or magnitude specified; defaulted to Y+1.0" }
            ],
            "summary": { "position": { "x": null, "y": 1.0, "z": null }, "rotation": null, "scale": null }
        }

        "Reset everything"
        → {
            "transformations": [
            { "action": "reset", "relative": false, "value": 0, "confidence": "high" }
            ],
            "summary": {
            "position": { "x": 0, "y": 0, "z": 0 },
            "rotation": { "x": 0, "y": 0, "z": 0 },
            "scale":    { "x": 1, "y": 1, "z": 1 }
            }
        }
        """
    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[f"Command: {command}"],
        config={
            "response_mime_type": "application/json",
            "system_instruction": system_instruction
        }
    )
    resp_text = extract_text_from_response(response)
    result = json.loads(resp_text)
    print(f"[3D Command] Input: '{command}'  Output: {result}")
    return result


# PREPARE STAGE: Parse & Segment
@app.route('/api/edit/prepare', methods=['POST'])
def edit_prepare():
    try:
        data = request.json
        image_url = data.get('image_url')
        user_prompt = data.get('prompt')

        if not image_url or not user_prompt:
            return jsonify({'error': 'Missing image_url or prompt'}), 400

        #Parse Prompt
        parsing_prompt = f"""
        Analyze request: "{user_prompt}".
        Output JSON: {{"subject": "object to segment", "action": "movement command"}}
        """
        parse_resp = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=[parsing_prompt],
            config={"response_mime_type": "application/json"}
        )
        resp_text = extract_text_from_response(parse_resp)
        try:
            parsed = json.loads(resp_text)
        except (json.JSONDecodeError, ValueError):
            parsed = {}
        subject_prompt = parsed.get("subject", "main object")
        action_prompt = parsed.get("action", user_prompt)

        #Segment with SAM3
        image_filename = os.path.basename(image_url)
        image_path = os.path.join('generated_images', image_filename)
        
        with open(image_path, 'rb') as f:
            image_b64 = base64.b64encode(f.read()).decode('utf-8')

        sam_response = requests.post(
            f"{SAMVMURL}/segment", 
            json={'image_url': f"data:image/png;base64,{image_b64}", 'text_prompt': subject_prompt}, 
            timeout=300
        )
        
        if sam_response.status_code != 200:
            return jsonify({'error': 'Segmentation failed', 'details': sam_response.text}), 500

        masks = sam_response.json().get('masks', [])
        if not masks:
            return jsonify({'error': 'SAM returned no masks'}), 500
        best_mask = max(masks, key=lambda x: x.get('score', 0))

        # Generate AI Command using the shared interpreter (new transformations[] format)
        ai_command_data = _interpret_3d_command(action_prompt)

        return jsonify({
            'status': 'success',
            'mask_data': best_mask.get('mask'),
            'bbox': best_mask.get('bbox'),
            'segmentation_mask': f"data:image/jpeg;base64,{best_mask.get('visualization')}",
            'ai_command': {
                'id': time.time(),
                'data': ai_command_data
            }
        })

    except Exception as e:
        app.logger.error(f"Error in edit_prepare: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


#INPAINT STAGE: Background Removal
@app.route('/api/edit/inpaint', methods=['POST'])
def edit_inpaint():
    try:
        data = request.json
        image_url = data.get('image_url')
        mask_data = data.get('mask_data')

        image_filename = os.path.basename(image_url)
        image_path = os.path.join('generated_images', image_filename)
        with open(image_path, 'rb') as f:
            image_b64 = base64.b64encode(f.read()).decode('utf-8')

        # Dilate mask for better inpainting
        mask_bytes = base64.b64decode(mask_data.split(',')[1] if 'base64,' in mask_data else mask_data)
        mask_array = np.frombuffer(mask_bytes, dtype=np.uint8)
        mask_img = cv2.imdecode(mask_array, cv2.IMREAD_GRAYSCALE)
        
        kernel = np.ones((15, 15), np.uint8)
        dilated_mask = cv2.dilate(mask_img, kernel, iterations=1)
        
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 80] 
        _, mask_buffer = cv2.imencode('.jpg', dilated_mask, encode_param)
        dilated_mask_b64 = base64.b64encode(mask_buffer).decode('utf-8')

        lama_response = requests.post(
            f"{VM_LAMA_SERVER_URL}/inpaint",
            json={'image': f"data:image/png;base64,{image_b64}", 'mask': f"data:image/jpeg;base64,{dilated_mask_b64}", 'refine': True},
            timeout=300
        )

        return jsonify({'inpainted_image': lama_response.json().get('inpainted_image')})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


#3D STAGE: Model Generation
@app.route('/api/edit/generate_3d', methods=['POST'])
def edit_generate_3d():
    try:
        data = request.json
        image_url = data.get('image_url')
        mask_data = data.get('mask_data')

        image_filename = os.path.basename(image_url)
        image_path = os.path.join('generated_images', image_filename)
        with open(image_path, 'rb') as f:
            image_b64 = base64.b64encode(f.read()).decode('utf-8')

        final_mask_for_3d = prepare_mask_rgb_image(image_url, mask_data)
        mask_for_refinement = prepare_mask_rgb_image(image_url, mask_data, background=(255, 255, 255, 255))
      
        infer_response = requests.post(
            f"{VM_3D_SERVER_URL}/process",
            json={"image": f"data:image/png;base64,{image_b64}", "mask": final_mask_for_3d}, 
            timeout=300
        )

        infer_json = infer_response.json()

        return jsonify({
            'ply_data': infer_json.get('ply_data'),
            'rotation': infer_json.get('rotation'),
            'translation': infer_json.get('translation'),
            'scale': infer_json.get('scale'),
            'final_mask_url': mask_for_refinement
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


SAMVMURL = f"http://{VM_KEY}:5007"
VM_3D_SERVER_URL = f"http://{VM_KEY}:5001"
VM_LAMA_SERVER_URL = f"http://{VM_KEY}:5002" 
VM_CANNY_SERVER_URL = f"http://{VM_KEY}:5003"


@app.route('/save_final_merged_image', methods=['POST'])
def save_final_merged_image():
    try:
        data = request.json
        image_b64 = data.get('image_base64')
        prompt = data.get('prompt', 'final_scene')

        if not image_b64:
            return jsonify({'error': 'No image data'}), 400

        save_path = save_base64_image(image_b64, "generated_images", prompt)
        if not save_path:
            raise Exception("Failed to save image locally")

        filename = os.path.basename(save_path)
        return jsonify({
            'success': True,
            'url': f"/generated_images/{filename}",
            'filename': filename
        })
    except Exception as e:
        app.logger.error(f"Error saving merged image: {e}")
        return jsonify({'error': str(e)}), 500


        
def save_base64_image(b64_data, folder, base_filename):
    """
    Decodes a base64 string and saves it as a PNG image in the specified folder.
    """
    try:
        os.makedirs(folder, exist_ok=True)
        
        if 'base64,' in b64_data:
            b64_data = b64_data.split(',', 1)[1]
        
        # 1. Decode the base64 string
        image_bytes = base64.b64decode(b64_data)
        image = Image.open(BytesIO(image_bytes))
        
        safe_name = "".join(c for c in base_filename if c.isalnum() or c in (' ', '_')).rstrip()
        safe_name = safe_name[:50].replace(" ", "_")
        
        filename = f"{safe_name}__{int(time.time())}_{uuid.uuid4().hex[:6]}.png"
        save_path = os.path.join(folder, filename)
        
        image.save(save_path, format="PNG")
        return save_path
    except Exception as e:
        app.logger.error(f"Failed to save base64 image: {e}")
        return None


def prepare_mask_rgb_image(image_url, mask_data, background=(0, 0, 0, 0)):
    """
    Prepare a full-size RGBA image where only the area defined by `mask_data`
    contains pixels from the original image; the rest of the image is filled
    with the provided `background` color. 
    Returns a data URL string: 'data:image/png;base64,...'
    """
    # Resolve image path
    image_filename = os.path.basename(image_url)
    image_path = os.path.join('generated_images', image_filename)

    if not os.path.exists(image_path):
        raise FileNotFoundError('Image file not found for mask preparation')

    # Load original image
    with open(image_path, 'rb') as f:
        original_image = Image.open(f).convert('RGBA')

    # Normalize mask base64
    if ',' in mask_data:
        mask_b64 = mask_data.split(',', 1)[1]
    else:
        mask_b64 = mask_data

    # Decode mask and convert to single-channel (L)
    mask_bytes = base64.b64decode(mask_b64)
    mask_image = Image.open(BytesIO(mask_bytes)).convert('L')

    # Resize mask if necessary to match original image size
    if mask_image.size != original_image.size:
        mask_image = mask_image.resize(original_image.size, Image.LANCZOS)

    # Prepare RGBA canvas with background (default transparent)
    canvas = Image.new('RGBA', original_image.size, background)

    # Ensure original is RGBA so we preserve alpha if any
    original_rgba = original_image.convert('RGBA')

    # Paste original RGBA pixels onto the canvas using the mask so that only
    # masked areas are copied over. The mask controls where the paste occurs.
    canvas.paste(original_rgba, (0, 0), mask_image)
    # Encode to base64 PNG
    buffer = BytesIO()
    canvas.save(buffer, format='PNG', optimize=True)
    b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

    app.logger.info(f'Prepared mask RGB image for {image_filename} (size={original_image.size})')
    return f"data:image/png;base64,{b64}"


@app.route('/transform_to_3d_alive', methods=['POST'])
def transform_to_3d_alive():
    """
    Orchestrates the synchronous inpainting (LaMa) and 3D generation.
    Returns the inpainted image (Image B) and the 3D model (3D_Cat) together.
    Returns: inpainted_image, ply_data, detailed_prompt
    """
    try:
        data = request.json
        image_url = data['image_url']
        raw_mask_data = data['mask_data']
        # takes the list and combine it into one master mask
        if isinstance(raw_mask_data, list):
            mask_data_list = raw_mask_data
        else:
            mask_data_list = [raw_mask_data]

        combined_mask = None
        for mask_str in mask_data_list:
            if ',' in mask_str:
                mask_str = mask_str.split(',')[-1]

            temp_bytes = base64.b64decode(mask_str)
            temp_image = Image.open(BytesIO(temp_bytes)).convert('L')

            if combined_mask is None:
                combined_mask = temp_image
            else:
                combined_mask = ImageChops.lighter(combined_mask, temp_image)

        # Convert the combined mask back into a single base64 string
        buf = BytesIO()
        combined_mask.save(buf, format='PNG')
        combined_mask_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')

        mask_data = f"data:image/png;base64,{combined_mask_b64}"

        # Retrieve and Encode Original Image
        image_filename = os.path.basename(image_url)
        image_path = os.path.join('generated_images', image_filename)
        if not os.path.exists(image_path):
            return jsonify({'error': 'Image file not found for transformation'}), 404

        # Read the original image file and convert to Base64 for the LaMa API call
        with open(image_path, 'rb') as f:
            original_image_base64 = base64.b64encode(f.read()).decode('utf-8')

        # PROCESS AND DILATE THE MASK
        if 'base64,' in mask_data:
            mask_header, mask_b64 = mask_data.split(',', 1)
        else:
            mask_header = 'data:image/png;base64'
            mask_b64 = mask_data

        mask_bytes = base64.b64decode(mask_b64)
       
        np_arr = np.frombuffer(mask_bytes, np.uint8)
        mask_image_cv = cv2.imdecode(np_arr, cv2.IMREAD_UNCHANGED)

        if len(mask_image_cv.shape) > 2 and mask_image_cv.shape[2] == 4:
            mask_gray = mask_image_cv[:, :, 3]
        elif len(mask_image_cv.shape) > 2:
            mask_gray = cv2.cvtColor(mask_image_cv, cv2.COLOR_BGR2GRAY)
        else:
            mask_gray = mask_image_cv

        _, binary_mask = cv2.threshold(mask_gray, 1, 255, cv2.THRESH_BINARY)
        
        # Define a 15x15 kernel (the structure used to enlarge the mask)
        kernel = np.ones((15, 15), np.uint8)
        dilated_mask = cv2.dilate(binary_mask, kernel, iterations=1)
        
        _, buffer = cv2.imencode('.png', dilated_mask)
        refined_mask_b64 = base64.b64encode(buffer).decode('utf-8')
        refined_mask_data_url = f"{mask_header},{refined_mask_b64}"
      
        # CALL LAMA INPAINTING SERVICE
        print(f"Starting Inpainting on {VM_LAMA_SERVER_URL}/inpaint")
        lama_response = requests.post(
            f"{VM_LAMA_SERVER_URL}/inpaint",
            json={
                "image": f"data:image/png;base64,{original_image_base64}",
                "mask": refined_mask_data_url,
                "refine": True
            },
            timeout=300 
        )

        # Handle LaMa API errors
        if lama_response.status_code != 200:
            return jsonify({
                'error': 'LaMa inpainting failed',
                'details': lama_response.text
            }), 500

        # Extract the Base64 inpainted image from the LaMa response
        inpainted_image_data = lama_response.json().get('inpainted_image')

        print(f"Starting 3D generation on {VM_3D_SERVER_URL}/process")
        final_mask_base64_data_url = prepare_mask_rgb_image(image_url, mask_data)
        #Return the mask aka the 2d object with white background so it can be use during the refinement process
        mask_for_refinement = prepare_mask_rgb_image(image_url, mask_data, background=(255, 255, 255, 255))
        infer_response = requests.post(
            f"{VM_3D_SERVER_URL}/process",
            json={
                "image": f"data:image/png;base64,{original_image_base64}",
                "mask": final_mask_base64_data_url,
            },
            timeout=300
        )

        # Handle 3D generation API errors
        if infer_response.status_code != 200:
            return jsonify({
                'error': '3D generation failed',
                'details': infer_response.text
            }), 500

        # Extract the 3D model data and any transform metadata from the VM response
        try:
            infer_json = infer_response.json()
        except Exception:
            infer_json = {}

        ply_data = infer_json.get('ply_data')
        # Some VM backends may return rotation/translation/scale; provide safe defaults
        rot_list = infer_json.get('rotation')
        trans_list = infer_json.get('translation')
        scale_val = infer_json.get('scale')

        if ply_data:
            try:
                # Define a directory to save your PLY files
                save_dir = 'generated_plys'
                os.makedirs(save_dir, exist_ok=True)
                
                # Create a unique filename
                filename = f"model_{int(time.time())}.ply"
                save_path = os.path.join(save_dir, filename)

                # Decode the Base64 data
                # Handle if it has a data URL prefix
                if 'base64,' in ply_data:
                    _, ply_b64_data = ply_data.split(',', 1)
                else:
                    ply_b64_data = ply_data # Assume it's raw Base64

                ply_bytes = base64.b64decode(ply_b64_data)
                
                # Write the bytes to a file
                with open(save_path, 'wb') as f:
                    f.write(ply_bytes)
                app.logger.info(f"Successfully saved 3D model to {save_path}")

            except Exception as save_e:
                app.logger.error(f"Failed to save PLY file: {save_e}")
        
    
        return jsonify({
            'status': 'success',
            'inpainted_image': inpainted_image_data,
            'final_mask_url': mask_for_refinement, 
            'ply_data': ply_data,
            'rotation': rot_list,
            'translation': trans_list,
            'scale': scale_val,
        })

    except Exception as e:
        app.logger.error(f"Error in transform_to_3d_alive: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/refine_with_gemini', methods=['POST'])
def refine_with_gemini():
    try:
        data = request.json
        mode = data.get('mode', 'refine')  # 'refine' or 'harmonize'
        structure_b64 = data.get('image_base64')
        if not structure_b64:
            return jsonify({'error': 'image_base64 is required'}), 400

        clean_structure = structure_b64.split(',', 1)[1] if ',' in structure_b64 else structure_b64
        structure_bytes = base64.b64decode(clean_structure)
        structure_img = Image.open(BytesIO(structure_bytes)).convert("RGBA")

        # Load reference image into memory if provided
        reference_bytes = None
        reference_b64 = data.get('reference_image')
        if reference_b64:
            if reference_b64.startswith('/generated_images/'):
                ref_path = os.path.join('generated_images', os.path.basename(reference_b64))
                if os.path.exists(ref_path):
                    with open(ref_path, 'rb') as f:
                        reference_bytes = f.read()
            else:
                clean_ref = reference_b64.split(',', 1)[1] if ',' in reference_b64 else reference_b64
                reference_bytes = base64.b64decode(clean_ref)

        # Load composite image (background + 3D render) if provided
        composite_bytes = None
        composite_b64 = data.get('composite_image')
        if composite_b64:
            clean_composite = composite_b64.split(',', 1)[1] if ',' in composite_b64 else composite_b64
            composite_bytes = base64.b64decode(clean_composite)
            app.logger.debug(f"[refine] Composite image received ({len(composite_bytes)} bytes)")

        if structure_img:
            img_w, img_h = structure_img.size
        elif composite_bytes:
            composite_img = Image.open(BytesIO(composite_bytes))
            img_w, img_h = composite_img.size
        else:
            img_w, img_h = 1024, 1024

        if composite_bytes:
            REFINE_PROMPT = (
                f"This image shows a 3D rendered object composited onto a background scene. "
                f"Harmonize the object so it looks like it naturally belongs in the scene: "
                f"adjust its lighting, shadows, color grading, and edge blending to match the background. "
                f"CRITICAL — do NOT change the shape, silhouette, contour, rotation, scale, or position of the object in any way. "
                f"Only adjust appearance (lighting, color, shadows) to make the object blend seamlessly with the scene. "
                f"The output must be {img_w}x{img_h} pixels, no text."
            )
        else:
            REFINE_PROMPT = (
                f"The first image is a 3D render of an object on a white background. "
                f"The second image is a reference photo of the same object. "
                f"Make the first image look photorealistic by adding realistic textures, materials, shading, and lighting inspired by the second image. "
                f"CRITICAL — GEOMETRY MUST BE PRESERVED EXACTLY: "
                f"The contour, silhouette, rotation, scale, and position of every part of the object in the output must be pixel-for-pixel identical to the first image (the 3D render). "
                f"The object must start and end at the exact same pixels as in the first image (the 3D render) — do not shift, resize, rotate, or reshape it in any way. "
                f"Use the second image ONLY as a texture and material reference. Ignore its geometry entirely. "
                f"The output must be {img_w}x{img_h} pixels, plain white background, no text."
            )

        structure_np = np.array(structure_img)
        sr, sg, sb, sa = structure_np[:, :, 0], structure_np[:, :, 1], structure_np[:, :, 2], structure_np[:, :, 3]
        hard_mask = (~((sr > 240) & (sg > 240) & (sb > 240))).astype(np.uint8) * 255
        hard_mask[sa < 128] = 0
        kernel = np.ones((3, 3), np.uint8)
        eroded_mask = cv2.erode(hard_mask, kernel, iterations=2)
        soft_mask = cv2.GaussianBlur(eroded_mask, (3, 3), sigmaX=1).astype(np.uint8)

        def apply_structure_mask(image_bytes):
            img = Image.open(BytesIO(image_bytes)).convert("RGBA")
            img = img.resize((img_w, img_h), Image.LANCZOS)
            data = np.array(img)
            data[:, :, 3] = soft_mask
            result_img = Image.fromarray(data)
            buf = BytesIO()
            result_img.save(buf, format="PNG")
            return buf.getvalue()

        def load_image_part(img_bytes):
            from google.genai import types
            img = Image.open(BytesIO(img_bytes)).convert("RGB")
            buf = BytesIO()
            img.save(buf, format="PNG")
            return types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png")

        def call_once(index):
            from google.genai import types
            time.sleep(3 * index)
            contents = []
            if composite_bytes:
                contents.append(load_image_part(composite_bytes))
                app.logger.debug(f"[call_once#{index}] sending composite image ({len(composite_bytes)} bytes)")
            else:
                contents.append(load_image_part(structure_bytes))
                app.logger.debug(f"[call_once#{index}] image1=3D_render ({len(structure_bytes)} bytes)")
                if reference_bytes:
                    contents.append(load_image_part(reference_bytes))
                    app.logger.debug(f"[call_once#{index}] image2=reference_photo ({len(reference_bytes)} bytes)")
                else:
                    app.logger.debug(f"[call_once#{index}] NO reference image")
            app.logger.debug(f"[call_once#{index}] total images: {len(contents)}")
            contents.append(REFINE_PROMPT)
            config = types.GenerateContentConfig(
                response_modalities=["Text", "Image"],
                candidate_count=1,
            )
            response = client.models.generate_content(
                model="gemini-3-pro-image",
                contents=contents,
                config=config,
            )
            image_bytes = None
            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    image_bytes = part.inline_data.data
                    break
            if not image_bytes:
                raise Exception("No image returned from Gemini")
            if mode == 'harmonize':
                # Return raw output — no mask applied, composite already has the full scene
                return "data:image/png;base64," + base64.b64encode(image_bytes).decode('utf-8')
            masked_bytes = apply_structure_mask(image_bytes)
            return "data:image/png;base64," + base64.b64encode(masked_bytes).decode('utf-8')

        image_options = None

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            futures = [executor.submit(call_once, i) for i in range(3)]
            results = []
            try:
                for fut in concurrent.futures.as_completed(futures, timeout=420):
                    try:
                        result = fut.result()
                        results.append(result)
                        socketio.emit('refine_option', {'image': result, 'index': len(results) - 1})
                    except Exception as e:
                        app.logger.warning(f"gemini-3-pro-image call failed: {e}")
                        continue
            except concurrent.futures.TimeoutError:
                app.logger.warning("gemini-3-pro-image timed out, falling back to rerender_depthmap VM")
            if results:
                image_options = results

        if image_options is None:
            print("[refine] All Gemini calls failed — falling back to rerender_depthmap VM")
            # Fallback: call VM rerender_depthmap (IP-Adapter + ControlNet depth)
            ref_b64_for_vm = None
            if reference_bytes:
                ref_b64_for_vm = base64.b64encode(reference_bytes).decode('utf-8')
            elif reference_b64:
                ref_b64_for_vm = reference_b64.split(',', 1)[1] if ',' in reference_b64 else reference_b64

            if not ref_b64_for_vm:
                return jsonify({'error': 'Gemini timed out and no reference image available for fallback'}), 500

            vm_resp = requests.post(
                f"{VM_CANNY_SERVER_URL}/rerender_depthmap",
                json={
                    "image_base64": ref_b64_for_vm,
                    "threed_image_base64": clean_structure,
                },
                timeout=300,
            )
            vm_data = vm_resp.json()
            if 'image_options' not in vm_data:
                return jsonify({'error': f"Fallback rerender failed: {vm_data.get('error', 'unknown')}"}), 500
            image_options = vm_data['image_options']

        return jsonify({'image_options': image_options})

    except Exception as e:
        app.logger.error(f"Error in refine_with_gemini: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


#SAM Endpoint
@app.route('/segment_with_sam', methods=['POST'])
def segment_with_sam():
    try:
        data = request.json
        
        image_path = os.path.join('generated_images', os.path.basename(data['image_url']))
        
        if not os.path.exists(image_path):
            return jsonify({'error': 'Image file not found'}), 404

        # Convert image to base64 for transmission to SAM VM
        with open(image_path, 'rb') as img_file:
            image_bytes = img_file.read()
            image_base64 = base64.b64encode(image_bytes).decode('utf-8')

        # Prepare payload for SAM3
        payload = {
            'image_url': f"data:image/png;base64,{image_base64}"
        }

        # SAM3 supports two modes:
        # 1. Text prompts (new SAM3 feature)
        if 'text_prompt' in data and data['text_prompt']:
            payload['text_prompt'] = data['text_prompt']
            print(f"[SAM3] Text prompt: {data['text_prompt']}")
        elif 'input_boxes' in data:
            payload['input_boxes'] = data['input_boxes']
        # 2.box prompts 
        elif 'input_points' in data and 'input_labels' in data:
            payload['input_points'] = data['input_points']
            payload['input_labels'] = data['input_labels']
            print(f"[SAM3] Point prompts: {data['input_points']}")
        
        else:
            return jsonify({
                'error': 'Either text_prompt or input_points/input_labels required',
                'type': 'ValueError'
            }), 400

        print(f"Forwarding request to {SAMVMURL}/segment")
        response = requests.post(
            f"{SAMVMURL}/segment",
            json=payload,
            timeout=300
        )

        if response.status_code != 200:
            error_data = {
                'error': 'SAM processing failed',
                'details': response.text,
                'status_code': response.status_code
            }
            print(f" Error: {error_data}")
            return jsonify(error_data), 500

        print(f"Success!")
        return jsonify(response.json())

    except requests.exceptions.Timeout:
        return jsonify({
            'error': 'SAM VM request timed out',
            'type': 'TimeoutError'
        }), 504
    
    except requests.exceptions.ConnectionError:
        return jsonify({
            'error': 'Cannot connect to SAM VM',
            'details': f'Make sure SAM server is running at {SAMVMURL}',
            'type': 'ConnectionError'
        }), 503
    
    except Exception as e:
        import traceback
        print(f"[SAM3] Exception: {traceback.format_exc()}")
        return jsonify({
            'error': str(e),
            'type': type(e).__name__
        }), 500
    
# OPENAI
@app.route('/openai', methods=['POST'])
def generate_openai():
    if not request.is_json:
        return jsonify({'error': 'Request must be JSON'}), 400

    data = request.json
    prompt = data.get('prompt')
    raw_model = data.get('model', 'gpt-image-2')
    
    # Map input model  gpt-image-1 or gpt-image-2
    search_model = raw_model.lower()
    if '1' in search_model and 'gpt' in search_model:
        api_model = 'gpt-image-1'
    else:
        api_model = 'gpt-image-2'

    if not prompt:
        return jsonify({'error': 'Prompt required'}), 400

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return jsonify({'error': 'OpenAI API key missing on server'}), 500

    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": api_model,
            "prompt": prompt,
            "n": 1,
            "size": "1024x1024"
        }
        
        response = requests.post("https://api.openai.com/v1/images/generations", headers=headers, json=payload)
        
        # Catch OpenAI API errors 
        if response.status_code == 400 and 'error' in response.json():
            err_data = response.json()['error']
            if err_data.get('code') == 'moderation_blocked' or 'safety system' in err_data.get('message', '').lower():
                return jsonify({'error': 'Prompt blocked by OpenAI safety filters. Please try rephrasing your request.'}), 400
            return jsonify({'error': f"OpenAI Error: {err_data.get('message')}"}), 400
            
        response.raise_for_status()
        resp_data = response.json()
        
        # Extract the base64 string
        image_b64 = resp_data["data"][0]["b64_json"]
        
        # Decode base64 and save locally
        image_data = base64.b64decode(image_b64)
        image = Image.open(BytesIO(image_data)).convert("RGB")
        
        os.makedirs("generated_images", exist_ok=True)
        timestamp = int(time.time())
        safe_prompt = "".join(c for c in prompt if c.isalnum() or c in (' ', '_')).rstrip()[:50].replace(" ", "_")
        filename = f"{safe_prompt}__{timestamp}_{uuid.uuid4().hex[:4]}.png"
        image_path = os.path.join("generated_images", filename)
        image.save(image_path)
        
        result_data = {
            'id': filename.split('.')[0],
            'url': f"/generated_images/{filename}",
            'prompt': prompt,
            'timestamp': timestamp * 1000,
            'model': raw_model,
            'provider': 'openai'
        }
        
        socketio.emit('new_image', result_data)
        return jsonify(result_data)

    except Exception as e:
        app.logger.error(f"OpenAI generation error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
        


# GOOGLE — Nano Banana (Gemini native image generation)
@app.route('/gemini', methods=['POST'])
def generate_gemini():
    if not request.is_json:
        return jsonify({'error': 'Request must be JSON'}), 400

    data = request.json
    prompt = data.get('prompt')
    image_filename = data.get('image_filename')
    model = data.get('model', 'gemini-2.5-flash-image')

    if not prompt:
        return jsonify({'error': 'Prompt required'}), 400

    try:
        result = call_gemini(prompt, image_filename=image_filename, model=model)
        image = Image.open(BytesIO(result['image_bytes'])).convert("RGB")

        os.makedirs("generated_images", exist_ok=True)
        timestamp = int(time.time())
        safe_prompt = "".join(c for c in prompt if c.isalnum() or c in (' ', '_')).rstrip()
        safe_prompt = safe_prompt[:50].replace(" ", "_")
        filename = f"{safe_prompt}__{timestamp}_{uuid.uuid4().hex[:4]}.png"
        image_path = f"generated_images/{filename}"
        image.save(image_path)

        result_data = {
            'id': filename.split('.')[0],
            'url': f"/generated_images/{filename}",
            'prompt': prompt,
            'description': result.get('text_response', ''),
            'timestamp': timestamp * 1000,
            'model': model
        }

        socketio.emit('new_image', result_data)
        return jsonify(result_data)

    except Exception as e:
        app.logger.error(f"Gemini generation error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/generated_images/<path:filename>')
def serve_image(filename):
    return send_from_directory("generated_images", filename)




@app.route('/Thumbnails', methods=['GET'])
def list_thumbnails():
    image_dir = "generated_images"
    os.makedirs(image_dir, exist_ok=True)
    image_list = []
    
    # Get all files with creation time
    files_with_time = []
    for filename in os.listdir(image_dir):
        if filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
            filepath = os.path.join(image_dir, filename)
            ctime = os.path.getctime(filepath)
            files_with_time.append((filename, ctime))
    
    # Sort by creation time (newest first)
    files_with_time.sort(key=lambda x: x[1], reverse=True)
    
    for filename, timestamp in files_with_time:
        prompt = "N/A"
        if "__" in filename:
            try:
                prompt = filename.split("__")[0].replace("_", " ")
            except:
                pass
                
        image_list.append({
            "id": filename.split(".")[0],
            "url": f"/generated_images/{filename}",
            "prompt": prompt,
            "timestamp": int(timestamp * 1000),  
        })

    return jsonify(image_list)





@app.route('/star_image', methods=['POST'])
def star_image():
    try:
        data = request.json
        image_url = data.get('image_url')  # e.g. /generated_images/foo__uuid.png
        if not image_url:
            return jsonify({'error': 'image_url required'}), 400

        filename = os.path.basename(image_url)
        old_path = os.path.join('generated_images', filename)
        if not os.path.exists(old_path):
            return jsonify({'error': 'File not found'}), 404

        # Already starred — return as-is
        if '__starred_' in filename:
            return jsonify({'url': image_url, 'already_starred': True})

        starred_ts = int(time.time() * 1000)
        name, ext = os.path.splitext(filename)
        new_filename = f"{name}__starred_{starred_ts}{ext}"
        new_path = os.path.join('generated_images', new_filename)
        os.rename(old_path, new_path)

        return jsonify({'url': f'/generated_images/{new_filename}', 'starred_at': starred_ts})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/save_session', methods=['POST'])
def save_session():
    try:
        participant_id = request.form.get('participant_id', '').strip()
        session_data_raw = request.form.get('session_data', '{}')
        session_data = json.loads(session_data_raw)

        if not participant_id:
            return jsonify({'error': 'participant_id is required'}), 400

        # Sanitize participant ID for use as folder name
        safe_id = "".join(c for c in participant_id if c.isalnum() or c in ('-', '_')).strip()
        if not safe_id:
            return jsonify({'error': 'Invalid participant_id'}), 400

        session_dir = os.path.join('sessions', safe_id)
        os.makedirs(session_dir, exist_ok=True)

        # Save submitted images
        for key, filename in request.form.items():
            if key.startswith('image_name_'):
                step_key = key[len('image_name_'):]
                file = request.files.get(f'image_file_{step_key}')
                filename = secure_filename(filename)
                if file and filename:
                    file.save(os.path.join(session_dir, filename))
                    # Update session_data with saved filename
                    for step in session_data.get('steps', []):
                        if step.get('key') == step_key:
                            step['submitted_image'] = filename

        # Save session JSON named by task to avoid overwriting across tasks
        task_id = session_data.get('task_id', 'unknown')
        json_filename = f'task{task_id}_session.json'
        with open(os.path.join(session_dir, json_filename), 'w') as f:
            json.dump(session_data, f, indent=2)

        return jsonify({'success': True, 'folder': session_dir})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)