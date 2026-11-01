# GPU Server Setup

> **Part of ImageDirector** — For the full project documentation, see the [main README](../README.md).

## Overview

This folder contains **custom modifications** for four AI modules. Clone each original repository and merge in the custom files provided here.

---

## Prerequisites

### System Setup (Fresh Machine)

If starting on a fresh Ubuntu/Debian machine, run these first:

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Git
sudo apt install -y git

# Install build tools (needed for compiling PyTorch extensions)
sudo apt install -y build-essential g++

# Install system libraries (needed for OpenCV and media handling)
sudo apt install -y libgl1 libglib2.0-0 libgomp1

# Install HuggingFace CLI
pip install huggingface-hub
```

---

### Environment Prerequisites

Before starting, ensure you have:

### 1. Conda (Miniconda)
All modules use Conda for environment management. If you don't have it installed:

```bash
# Download Miniconda
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh

# Install (will prompt for installation path, accept defaults or choose custom location)
bash Miniconda3-latest-Linux-x86_64.sh

# Initialize conda
conda init bash
source ~/.bashrc
```

Verify installation:
```bash
conda --version
```

### 2. Python 3.9+ Available
Some modules require specific Python versions. Verify your system:
```bash
python3.9 --version
```

### 3. NVIDIA GPU with CUDA Support
Check your GPU and CUDA setup:
```bash
nvidia-smi
```

The NVIDIA driver should support at least CUDA 12.1. (PyTorch in the environments includes its own CUDA libraries.)

**Important:** These modules have been tested and verified to work with **CUDA 12.1** and **CUDA 13.0**. Do **not** use CUDA 13.4 — compatibility issues with GPU kernels may cause processes to hang or fail. If you have CUDA 13.4 installed, downgrade to 13.0.


---

## Installation & Setup

Navigate to the `inference-servers/` folder first:
```bash
cd GPU-Server/inference-servers
```

All cloning and setup should happen inside this folder. Custom files are in `*-custom/` folders.

---

### SAM3 (Segment Anything Model 3)

**Official Repository:** [facebookresearch/sam3](https://github.com/facebookresearch/sam3)

**Custom files location:** `GPU-Server/inference-servers/sam3-custom/`

**File Destinations (copy/merge into `sam3/`):**

| Custom File | Destination in sam3/ | Action |
|---|---|---|
| `SAM3_server.py` | `-` | Add (NEW) |
| `environment.yml` | `environment.yml` | Overwrite (MODIFIED) |
| `assets/bpe_simple_vocab_16e6.txt.gz` | `-` | Add (NEW) |

**Environment:** `sam3_env` (Python 3.10.19, PyTorch 2.5.1 + CUDA 12.1, torchvision 0.20.1, Transformers 5.0.0, numpy 1.26.4, OpenCV 4.10). Every package is pinned in `environment.yml` to versions verified working on an NVIDIA A100.

**Before you start:**
- The SAM3 model weights on Hugging Face are gated. Request access on the [facebook/sam3](https://huggingface.co/facebook/sam3) model page and wait for approval, then create an [access token](https://huggingface.co/settings/tokens).
- The weights are downloaded automatically on the first run and cached by Hugging Face (in `~/.cache/huggingface` by default). 

**Setup (inside inference-servers/):**
1. Clone the repository:
```bash
   git clone https://github.com/facebookresearch/sam3.git sam3
```
2. Copy the custom files into `sam3/`:
```bash
   cp sam3-custom/SAM3_server.py sam3/
   cp sam3-custom/environment.yml sam3/
   mkdir -p sam3/assets
   cp sam3-custom/assets/bpe_simple_vocab_16e6.txt.gz sam3/assets/
```
3. Create the environment (this takes several minutes):
```bash
   cd sam3
   conda env create -f environment.yml
   conda activate sam3_env
```
4. Install SAM3 itself into the environment:
```bash
   pip install -e .
```
5. Log in to Hugging Face (only needed once):
```bash
   hf auth login
```

6. Run the server:
```bash
   python SAM3_server.py
```
   It is ready when it prints `Running on http://...:5007`.



**References:**
- [SAM3 GitHub](https://github.com/facebookresearch/sam3)
- [SAM3 Paper](https://arxiv.org/abs/2511.16719)

---

### LaMa (Large Mask Inpainting)

**Official Repository:** [advimman/lama](https://github.com/advimman/lama)

**Custom files location:** `GPU-Server/inference-servers/lama-custom/`

**File Destinations (copy/merge into `lama/`):**

| Custom File | Destination in lama/ | Action |
|---|---|---|
| `bin/LaMa_server.py` | `bin/-` | Add (NEW) |
| `configs/prediction/default.yaml` | `configs/prediction/default.yaml` | Overwrite (MODIFIED) |
| `requirements.txt` | `requirements.txt` | Overwrite (MODIFIED) |
| `saicinpainting/training/trainers/__init__.py` | `saicinpainting/training/trainers/__init__.py` | Overwrite (MODIFIED) |

**Environment:** `lama_env` — **Conda environment** (Python 3.9, PyTorch 2.8.0 + CUDA 12.8, torchvision 0.23.0, PyTorch Lightning 1.2.9, TensorFlow 2.20.0, numpy 1.26.4, OpenCV 4.10). Every package is pinned in `requirements.txt` to versions verified working on an NVIDIA A100.

**Important:** Use **Conda to install dependencies** — this ensures proper Python 3.9 environment isolation and correct package version resolution. Do not use pip alone.

**Before you start:**
- LaMa requires **Python 3.9** specifically.
- PyTorch 2.8.0 includes its own CUDA 12.8 libraries, so no separate CUDA install is needed, but your **NVIDIA driver must support CUDA 12.8** (check the "CUDA Version" shown by `nvidia-smi`).

**Setup (inside inference-servers/):**
1. Clone the repository:
```bash
   git clone https://github.com/advimman/lama.git lama
```
2. Copy the custom files into `lama/`:
```bash
   cp lama-custom/bin/LaMa_server.py lama/bin/
   cp lama-custom/configs/prediction/default.yaml lama/configs/prediction/
   cp lama-custom/requirements.txt lama/
   cp lama-custom/saicinpainting/training/trainers/__init__.py \
      lama/saicinpainting/training/trainers/__init__.py
```
3. Download the pretrained Big-LaMa model into `lama/`:
```bash
   cd lama
   curl -LJO https://huggingface.co/smartywu/big-lama/resolve/main/big-lama.zip
   unzip big-lama.zip
```
   This creates `lama/big-lama/` containing `config.yaml` and `models/best.ckpt`. The `models/ade20k` and `models/lpips_models` folders already come with the repository.

4. **Create a Conda environment with Python 3.9** (this ensures correct dependency resolution):
```bash
   conda create -n lama_env python=3.9 -y
   conda activate lama_env
```

5. Install the dependencies (this downloads PyTorch and TensorFlow, might take a couple of minutes):
```bash
   pip install -r requirements.txt
   pip check
```
   `pip check` should report `No broken requirements found`.

**PyTorch checkpoint-loading compatibility:** The customized
`saicinpainting/training/trainers/__init__.py` passes `weights_only=False` to
`torch.load()` when loading the LaMa checkpoint. This addresses the PyTorch
2.6+ change to the default `torch.load()` behavior that can otherwise cause
a checkpoint-loading error with this project.


6. Verify the install (while `lama_env` is activated):
```bash
   python -c "import torch, cv2, pytorch_lightning; print('torch', torch.__version__, '| CUDA:', torch.cuda.is_available()); print('LaMa env OK')"
```
   You should see `CUDA: True` and `LaMa env OK`.

7. Run the server (make sure `lama_env` is activated, and run from the `bin/` folder):
```bash
   conda activate lama_env
   cd bin
   python LaMa_server.py
```
   It is ready when it prints `Running on http://...:5002`. Each inpainting request runs a refinement step (15 iterations at up to 3 scales), so a single request can take 10–30 seconds.



**References:**
- [LaMa GitHub](https://github.com/advimman/lama)
- [LaMa Paper](https://arxiv.org/abs/2109.07161)

---

### SAM-3D-Objects

**Official Repository:** [facebookresearch/sam-3d-objects](https://github.com/facebookresearch/sam-3d-objects)
**Official Setup Guide:** [setup.md](https://github.com/facebookresearch/sam-3d-objects/blob/main/doc/setup.md) (for reference only; follow the steps below instead, which include fixes for issues in the official guide)

**Custom files location:** `GPU-Server/inference-servers/sam-3d-objects-custom/`

**File Destinations (copy/merge into `sam-3d-objects/`):**

| Custom File | Destination in sam-3d-objects/ | Action |
|---|---|---|
| `image-editing-sam-3d.py` | `-` | Add (NEW) |
| `notebook/inference.py` | `notebook/inference.py` | Overwrite (MODIFIED) |
| `environment.yml` | `-` | Add (NEW) |
| `setup_sam3d.sh` | `-` | Add (NEW) |

**Environment:** `sam3d-objects` (Python 3.11.0, PyTorch 2.5.1 + CUDA 12.1, PyTorch3D 0.7.8, gsplat, Kaolin 0.17.0, flash-attn 2.8.3, numpy 1.26.4). Every package is pinned to versions verified working on an NVIDIA A100. Installation has two parts: `environment.yml` installs all regular packages, and `setup_sam3d.sh` builds the packages that must be compiled (PyTorch3D, gsplat), then installs flash-attn and SAM-3D-Objects itself.

**Before you start:**
- **GPU:** an NVIDIA GPU with at least **32 GB of VRAM**.
- **Memory for compiling:** the setup script compiles PyTorch3D and gsplat, which needs a machine with plenty of RAM (16 GB+ recommended) and takes roughly **30–60 minutes**. 
- **No system CUDA install is needed.** The environment includes its own CUDA 12.1 compiler.
- **Checkpoints are gated.** Request access on the [facebook/sam-3d-objects](https://huggingface.co/facebook/sam-3d-objects) page and wait for approval, then create an [access token](https://huggingface.co/settings/tokens).

**Setup (inside inference-servers/):**
1. Clone the repository:
```bash
   git clone https://github.com/facebookresearch/sam-3d-objects.git sam-3d-objects
```
2. Copy the custom files into `sam-3d-objects/`:
```bash
   cp sam-3d-objects-custom/image-editing-sam-3d.py sam-3d-objects/
   cp sam-3d-objects-custom/notebook/inference.py sam-3d-objects/notebook/
   cp sam-3d-objects-custom/environment.yml sam-3d-objects/
   cp sam-3d-objects-custom/setup_sam3d.sh sam-3d-objects/
```
3. Create the environment (approximately 200 Conda packages and 450 pip packages will be installed; this may take some time):
```bash
   cd sam-3d-objects
   conda env create -f environment.yml
   conda activate sam3d-objects
```
4. Build and install the compiled packages and SAM-3D-Objects itself:
```bash
   bash setup_sam3d.sh
```
   The script builds for the NVIDIA A100 by default. For a different GPU, set its architecture first. It is finished when it prints `compiled packages OK` and `inference OK`.
5. Log in to Hugging Face and download the checkpoints (about 10 GB+):
```bash
   hf auth login
   TAG=hf
   hf download --repo-type model --local-dir checkpoints/${TAG}-download --max-workers 1 facebook/sam-3d-objects
   mv checkpoints/${TAG}-download/checkpoints checkpoints/${TAG}
   rm -rf checkpoints/${TAG}-download
   ls checkpoints/hf/pipeline.yaml
```
   The last command should list the file without an error.
6. Run the server:
```bash
   python image-editing-sam-3d.py
```
   Loading the checkpoints takes a minute or two. It is ready when it prints `Running on http://...:5001`.


**References:**
- [SAM-3D-Objects GitHub](https://github.com/facebookresearch/sam-3d-objects)
- [Official Setup Guide](https://github.com/facebookresearch/sam-3d-objects/blob/main/doc/setup.md)
- [HuggingFace Checkpoints](https://huggingface.co/facebook/sam-3d-objects)
---

### IP-Adapter (Depth Rendering & Harmonization)

**Official Repository:** [tencent-ailab/IP-Adapter](https://github.com/tencent-ailab/IP-Adapter/tree/main)

**Role in the pipeline:** IP-Adapter is the **fallback for harmonization**. The backend first harmonizes with Gemini 3 Pro Image and only calls this server if all Gemini requests fail or time out.

**Custom files location:** `GPU-Server/inference-servers/IP-Adapter-custom/`

**File Destinations (copy/merge into `IP-Adapter/`):**

| Custom File | Destination in IP-Adapter/ | Action |
|---|---|---|
| `depth_rerender.py` | `-` | Add (NEW) |
| `environment.yml` | `-` | Add (NEW) |

**Environment:** `ip_adapter_env` (Python 3.10.21, PyTorch 2.5.1 + CUDA 12.1, Diffusers 0.22.1, Transformers 4.40.0, numpy 2.2.6, OpenCV 5.0). Every package is pinned in `environment.yml` to versions verified working on an NVIDIA A100, including the `ip-adapter` package itself at the tested commit.

**Before you start:**
- The server needs six models. Two are downloaded manually in step 4 below. The other four are downloaded automatically from Hugging Face on the first run (about 6 GB total, none of them gated, so no login is needed):
  - `runwayml/stable-diffusion-v1-5` (base model; Hugging Face now redirects this to `stable-diffusion-v1-5/stable-diffusion-v1-5` automatically)
  - `stabilityai/sd-vae-ft-mse` (VAE)
  - `lllyasviel/control_v11f1p_sd15_depth` (ControlNet depth model)
  - `Intel/dpt-hybrid-midas` (MiDaS depth estimator)
- These are cached in `~/.cache/huggingface` by default.

**Setup (inside inference-servers/):**
1. Clone the repository:
```bash
   git clone https://github.com/tencent-ailab/IP-Adapter.git IP-Adapter
```
2. Copy the custom files into `IP-Adapter/`:
```bash
   cp IP-Adapter-custom/depth_rerender.py IP-Adapter/
   cp IP-Adapter-custom/environment.yml IP-Adapter/
```
3. Create the environment:
```bash
   cd IP-Adapter
   conda env create -f environment.yml
   conda activate ip_adapter_env
```
4. Download the IP-Adapter weights and image encoder:
```bash
   hf download h94/IP-Adapter --include "models/image_encoder/*" "models/ip-adapter_sd15.bin" --local-dir .
   ls -lh models/image_encoder/ models/ip-adapter_sd15.bin
```
   Check the sizes: `model.safetensors` and `pytorch_model.bin` should each be about 2.4 GB, and `ip-adapter_sd15.bin` about 43 MB. If any of them is only a few hundred bytes, it is a placeholder; delete the `models` folder and run the download again.
5. Run the server:
```bash
   python depth_rerender.py
```
   The first start downloads the four automatic models, so it takes longer. It is ready when it prints `Running on http://...:5003`.



**References:**
- [IP-Adapter GitHub](https://github.com/tencent-ailab/IP-Adapter/tree/main)
- [IP-Adapter Models on Hugging Face](https://huggingface.co/h94/IP-Adapter)
- [Paper](https://arxiv.org/abs/2308.06721)

---

## Running All Servers

Once all four modules are set up:

```bash
cd GPU-Server
bash run_servers.sh
```

This launches all 4 servers in tmux session `image_servers`:
- **Pane 0**: SAM3 (port 5007) → `inference-servers/sam3/`
- **Pane 1**: LaMa (port 5002) → `inference-servers/lama/bin/`
- **Pane 2**: SAM-3D-Objects (port 5001) → `inference-servers/sam-3d-objects/`
- **Pane 3**: IP-Adapter (port 5003) → `inference-servers/IP-Adapter/`

Stop all servers:
```bash
tmux kill-session -t image_servers
```