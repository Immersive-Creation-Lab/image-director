import torch
import numpy as np
from PIL import Image
from transformers import DPTImageProcessor, DPTForDepthEstimation
from diffusers import ControlNetModel, StableDiffusionControlNetPipeline, AutoencoderKL, DDIMScheduler
from ip_adapter import IPAdapter
from flask import request, jsonify, Flask
import base64
import io
import cv2
import random

base_model_path = "runwayml/stable-diffusion-v1-5"
vae_model_path = "stabilityai/sd-vae-ft-mse"
image_encoder_path = "models/image_encoder/"
ip_ckpt = "models/ip-adapter_sd15.bin"
device = "cuda"

# Generate at a lower native size for cleaner SD1.5 detail, then upscale to 1024 output.
GEN_SIZE = 512
FINAL_SIZE = 1024

# Tuned defaults to reduce glossy artifacts and color drift.
PROMPT = "best quality, detailed, natural diffuse lighting, matte texture, realistic colors"
NEGATIVE_PROMPT = "monochrome, lowres, bad anatomy, worst quality, low quality, glossy, shiny, specular highlights, plastic, metallic, neon, oversaturated"
IP_ADAPTER_SCALE = 1.0
GUIDANCE_SCALE = 8.5
CONTROLNET_SCALE = 1.0

app = Flask(__name__)

# DEPTH ESTIMATOR (MiDaS) 
print("Loading MiDaS Depth Estimator...")
depth_estimator = DPTForDepthEstimation.from_pretrained("Intel/dpt-hybrid-midas").to(device)
feature_extractor = DPTImageProcessor.from_pretrained("Intel/dpt-hybrid-midas")

def get_depth_map(pil_image, target_size=GEN_SIZE):
    # Prepare image for the depth model
    inputs = feature_extractor(images=pil_image, return_tensors="pt").to(device)
    
    with torch.no_grad():
        outputs = depth_estimator(**inputs)
        predicted_depth = outputs.predicted_depth

    # Resize to match generation resolution 
    depth_map = torch.nn.functional.interpolate(
        predicted_depth.unsqueeze(1),
        size=(target_size, target_size),
        mode="bicubic",
        align_corners=False,
    )
    
    # Normalize depth map to 0-255 range
    depth_min = torch.amin(depth_map, dim=[1, 2, 3], keepdim=True)
    depth_max = torch.amax(depth_map, dim=[1, 2, 3], keepdim=True)
    depth_map = (depth_map - depth_min) / (depth_max - depth_min)
    
    # Convert to 3-channel RGB image for ControlNet
    depth_map = torch.cat([depth_map] * 3, dim=1)
    depth_map = depth_map.permute(0, 2, 3, 1).cpu().numpy()[0]
    depth_map = Image.fromarray((depth_map * 255.0).clip(0, 255).astype(np.uint8))
    return depth_map

#INITIALIZE STABLE DIFFUSION + CONTROLNET 
print("Loading SD Pipeline with Depth ControlNet...")
noise_scheduler = DDIMScheduler(
    num_train_timesteps=1000,
    beta_start=0.00085,
    beta_end=0.012,
    beta_schedule="scaled_linear",
    clip_sample=False,
    set_alpha_to_one=False,
    steps_offset=1,
)

vae = AutoencoderKL.from_pretrained(vae_model_path).to(dtype=torch.float16)
controlnet = ControlNetModel.from_pretrained("lllyasviel/control_v11f1p_sd15_depth", torch_dtype=torch.float16)

pipe = StableDiffusionControlNetPipeline.from_pretrained(
    base_model_path,
    controlnet=controlnet,
    torch_dtype=torch.float16,
    scheduler=noise_scheduler,
    vae=vae,
    feature_extractor=None,
    safety_checker=None
).to(device)

ip_model = IPAdapter(pipe, image_encoder_path, ip_ckpt, device)

# UTILITIES
def base64_to_pil(base64_string):
    if "," in base64_string:
        base64_string = base64_string.split(',')[1]
    return Image.open(io.BytesIO(base64.b64decode(base64_string))).convert("RGB")
def numpy_to_base64(np_array):
    # Helper to convert RGBA numpy array to base64
    if np_array.shape[2] == 4:
        mode = 'RGBA'
    else:
        mode = 'RGB'
    img = Image.fromarray(np_array.astype('uint8'), mode)
    buffered = io.BytesIO()
    img.save(buffered, format="PNG") 
    return "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode('utf-8')

def pil_to_base64(pil_img):
    buffered = io.BytesIO()
    pil_img.save(buffered, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode('utf-8')


def upscale_to_final_size(pil_img, final_size=FINAL_SIZE):
    if pil_img.size == (final_size, final_size):
        return pil_img
    return pil_img.resize((final_size, final_size), Image.LANCZOS)

# ROUTE 
@app.route('/rerender_depthmap', methods=['POST']) 
def rerender_with_depth():
    try:
        data = request.json
        # image_base64 = The 2D Style Reference (Cat Photo)
        # threed_image_base64 = The 3D Structure (Render)
        ref_image = base64_to_pil(data.get('image_base64'))
        threed_render = base64_to_pil(data.get('threed_image_base64'))

        threed_np = np.array(threed_render)
        
        # Check for white pixels (R>240 and G>240 and B>240)
        is_white = np.all(threed_np[:, :, :3] > 240, axis=2)
        
        # Create mask: 255 where object is, 0 where background is
        structure_mask = (~is_white * 255).astype(np.uint8)
        mask_pil = Image.fromarray(structure_mask, mode='L')
        #Generate high-quality Depth Map from the 3D Render
        depth_map = get_depth_map(threed_render, target_size=GEN_SIZE)
        current_seed = random.randint(0, 2**32 - 1)
        print(f"Generating with seed: {current_seed}")
        # Generate with IP-Adapter + ControlNet
        images = ip_model.generate(
            pil_image=ref_image,
            image=depth_map,
            prompt=PROMPT,
            negative_prompt=NEGATIVE_PROMPT,
            scale=IP_ADAPTER_SCALE,
            guidance_scale=GUIDANCE_SCALE,
            width=GEN_SIZE,
            height=GEN_SIZE,
            num_samples=3,
            num_inference_steps=50,
            seed=current_seed,
            controlnet_conditioning_scale=CONTROLNET_SCALE
        )

        final_options = []

        for generated_pil in images:
            generated_pil = upscale_to_final_size(generated_pil, final_size=FINAL_SIZE)
            gen_np = np.array(generated_pil)

            current_mask_pil = mask_pil.resize(generated_pil.size, Image.LANCZOS)
            current_mask_np = np.array(current_mask_pil)

            bg_mask = (current_mask_np < 128).astype(np.uint8) 

            gen_healed = cv2.inpaint(gen_np, bg_mask, 3, cv2.INPAINT_TELEA)

            final_rgba = np.dstack((gen_healed, current_mask_np))

            final_rgba[current_mask_np == 0] = [0, 0, 0, 0]

            final_options.append(numpy_to_base64(final_rgba))
        return jsonify({
            'image_options': final_options,
            'depth_map': pil_to_base64(upscale_to_final_size(depth_map, final_size=FINAL_SIZE))
        })

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5003)
