#!/bin/bash

SESSION_NAME="image_servers"

# Create tmux session with 4 panes
tmux new-session -d -s $SESSION_NAME

# === PANE 0 (Top Left): sam3 ===
# Path: inference-servers/sam3
# Env: ../pyenv
tmux send-keys -t $SESSION_NAME:0.0 "cd inference-servers/sam3" C-m
tmux send-keys -t $SESSION_NAME:0.0 "source ~/.bashrc" C-m
tmux send-keys -t $SESSION_NAME:0.0 "conda activate sam3_env" C-m
tmux send-keys -t $SESSION_NAME:0.0 "python SAM3_server.py" C-m

# === Split panes ===
tmux split-window -v -t $SESSION_NAME:0.0      # Pane 1 (bottom left)
tmux split-window -h -t $SESSION_NAME:0.0      # Pane 2 (top right)
tmux split-window -h -t $SESSION_NAME:0.1      # Pane 3 (bottom right)

# === PANE 1 (Bottom Left): LaMa Inpainting ===
# Path: inference-servers/lama/bin
# Env: conda lama_env
tmux send-keys -t $SESSION_NAME:0.1 "cd inference-servers/lama/bin" C-m
tmux send-keys -t $SESSION_NAME:0.1 "source ~/.bashrc" C-m
tmux send-keys -t $SESSION_NAME:0.1 "conda activate lama_env" C-m
tmux send-keys -t $SESSION_NAME:0.1 "python LaMa_server.py" C-m

# === PANE 2 (Top Right): SAM3D Reconstruction ===
# Path: inference-servers/sam-3d-objects
# Env: conda sam3d-objects
tmux send-keys -t $SESSION_NAME:0.2 "cd inference-servers/sam-3d-objects" C-m
tmux send-keys -t $SESSION_NAME:0.2 "source ~/.bashrc" C-m      
tmux send-keys -t $SESSION_NAME:0.2 "conda activate sam3d-objects" C-m
tmux send-keys -t $SESSION_NAME:0.2 "python image-editing-sam-3d.py" C-m

# === PANE 3 (Bottom Right): ControlNet Rerendering ===
# Path: inference-servers/IP-Adapter/
# Env: conda control
tmux send-keys -t $SESSION_NAME:0.3 "cd inference-servers/IP-Adapter" C-m
tmux send-keys -t $SESSION_NAME:0.3 "source ~/.bashrc" C-m
tmux send-keys -t $SESSION_NAME:0.3 "conda activate ip_adapter_env" C-m
tmux send-keys -t $SESSION_NAME:0.3 "python depth_rerender.py" C-m

# Attach session
tmux attach-session -t $SESSION_NAME

