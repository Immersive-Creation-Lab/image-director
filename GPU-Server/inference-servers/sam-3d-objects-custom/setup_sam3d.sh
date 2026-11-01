#!/bin/bash
# Installs the SAM-3D-Objects packages that can't go in environment.yml because
# they must be compiled against the installed PyTorch (pytorch3d, gsplat, flash-attn),
# then installs sam3d_objects itself and applies the Hydra patch.
#
# Run from inside image-editing/sam-3d-objects/, with the environment active:
#   conda activate sam3d-objects
#   bash setup_sam3d.sh
#
# Needs: internet access, an NVIDIA GPU machine (or any Linux machine with enough RAM),
# and at least ~16 GB of RAM. Compiling takes roughly 30-60 minutes.
#
# GPU architecture: defaults to 8.0 (A100). Override for other GPUs, e.g.
#   TORCH_CUDA_ARCH_LIST="8.6" bash setup_sam3d.sh   # RTX 30-series
#   TORCH_CUDA_ARCH_LIST="8.9" bash setup_sam3d.sh   # RTX 40-series / L40
#   TORCH_CUDA_ARCH_LIST="9.0" bash setup_sam3d.sh   # H100
set -euo pipefail

# --- Safety checks -----------------------------------------------------------
if [[ "${CONDA_DEFAULT_ENV:-}" != *sam3d-objects* ]]; then
  echo "ERROR: activate the environment first:  conda activate sam3d-objects" >&2
  exit 1
fi
if [[ ! -f pyproject.toml || ! -d sam3d_objects ]]; then
  echo "ERROR: run this script from inside the sam-3d-objects repository folder." >&2
  exit 1
fi

# --- Build settings ----------------------------------------------------------
export PYTHONNOUSERSITE=1                       
export FORCE_CUDA=1                             # build GPU kernels even without a visible GPU
export TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST:-8.0}"
export MAX_JOBS="${MAX_JOBS:-4}"                # lower to 2 if the build gets "Killed"
export PIP_EXTRA_INDEX_URL="https://download.pytorch.org/whl/cu121"
export PIP_FIND_LINKS="https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html"
# Use the CUDA compiler installed inside the conda environment
export CUDA_HOME="$CONDA_PREFIX"

echo "== Building for GPU architecture $TORCH_CUDA_ARCH_LIST with $MAX_JOBS parallel jobs"
python -c "import torch; print('torch', torch.__version__, '| CUDA build', torch.version.cuda)"
nvcc --version | tail -1

# --- 1. pytorch3d (v0.7.8) ----------------------------------------------------
echo "== [1/5] Building pytorch3d (this is the slowest step)"
pip install --no-build-isolation --no-deps \
  "git+https://github.com/facebookresearch/pytorch3d.git@75ebeeaea0908c5527e7b1e305fbc7681382db47"

# --- 2. gsplat -------------------------------------------------------------------
echo "== [2/5] Building gsplat"
pip install --no-build-isolation --no-deps \
  "git+https://github.com/nerfstudio-project/gsplat.git@2323de5905d5e90e035f792fe65bad0fedd413e7"

# --- 3. flash-attn (usually downloads a prebuilt wheel) ---------------------------
echo "== [3/5] Installing flash-attn"
pip install --no-build-isolation --no-deps flash-attn==2.8.3

# --- 4. sam3d_objects itself ------------------------------------------------------
echo "== [4/5] Installing sam3d_objects"
pip install --no-deps -e .

# --- 5. Hydra patch ---------------------------------------------------------------
echo "== [5/5] Applying Hydra patch"
chmod +x ./patching/hydra
./patching/hydra

# --- Verify -----------------------------------------------------------------------
echo "== Verifying"
echo "   Expected and harmless in pip check below:"
echo "   - 'sam3d-objects requires nvidia-pyindex': left out on purpose (it only rewrites pip settings)"
echo "   - 'bitsandbytes / bpy / decord is not supported on this platform': a pip check quirk"
pip check || echo "(see the expected messages listed above)"
python -c "import pytorch3d, gsplat, flash_attn, kaolin; print('compiled packages OK')"
python -c "import sys; sys.path.append('notebook'); from inference import Inference; print('inference OK')"
echo "== Done. Next: download the checkpoints (see README), then run: python image-editing-sam-3d.py"
