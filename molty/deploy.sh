#!/usr/bin/env bash
#
# deploy.sh — Deploy Molty skills + workspace files to the OpenClaw EC2 server
#
# Usage:
#   ./deploy.sh <EC2_IP> <PEM_FILE_PATH>
#
# Example:
#   ./deploy.sh 54.123.45.67 ~/.ssh/molty-key.pem
#

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────────

if [ $# -lt 2 ]; then
  echo "Usage: ./deploy.sh <EC2_IP> <PEM_FILE_PATH>"
  echo ""
  echo "Example:"
  echo "  ./deploy.sh 54.123.45.67 ~/.ssh/molty-key.pem"
  exit 1
fi

EC2_IP="$1"
PEM_FILE="$2"
SSH_USER="admin"
LOCAL_SKILLS_DIR="$(cd "$(dirname "$0")" && pwd)/skills"
LOCAL_WORKSPACE_DIR="$(cd "$(dirname "$0")" && pwd)/workspace"

# ── Validate ──────────────────────────────────────────────────────────────────

if [ ! -f "$PEM_FILE" ]; then
  echo "Error: PEM file not found: $PEM_FILE"
  exit 1
fi

if [ ! -d "$LOCAL_SKILLS_DIR" ]; then
  echo "Error: skills/ directory not found at $LOCAL_SKILLS_DIR"
  exit 1
fi

# Fix PEM file permissions if needed
chmod 400 "$PEM_FILE" 2>/dev/null || true

SSH_OPTS="-i $PEM_FILE -o StrictHostKeyChecking=no -o ConnectTimeout=10"

# Resolve remote paths (scp doesn't expand $HOME, so we need the real path)
REMOTE_SKILLS_DIR="$(ssh $SSH_OPTS "$SSH_USER@$EC2_IP" 'echo $HOME/.openclaw/skills')"
REMOTE_WORKSPACE_DIR="$(ssh $SSH_OPTS "$SSH_USER@$EC2_IP" 'echo $HOME/.openclaw/workspace')"

echo "================================================"
echo "  Deploying Molty Skills + Workspace to EC2"
echo "================================================"
echo ""
echo "  Server:     $SSH_USER@$EC2_IP"
echo "  PEM:        $PEM_FILE"
echo "  Skills:     $LOCAL_SKILLS_DIR"
echo "  Workspace:  $LOCAL_WORKSPACE_DIR"
echo "  Remote:     $REMOTE_SKILLS_DIR"
echo "              $REMOTE_WORKSPACE_DIR"
echo ""

# ── Step 1: Ensure remote directories exist ───────────────────────────────────

echo "[1/5] Creating remote directories..."
ssh $SSH_OPTS "$SSH_USER@$EC2_IP" "mkdir -p $REMOTE_SKILLS_DIR $REMOTE_WORKSPACE_DIR"
echo "  Done."

# ── Step 2: Upload skills ─────────────────────────────────────────────────────

echo "[2/5] Uploading skills..."
for skill_dir in "$LOCAL_SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_dir")
  echo "  -> $skill_name/"
  scp $SSH_OPTS -r "$skill_dir" "$SSH_USER@$EC2_IP:$REMOTE_SKILLS_DIR/$skill_name"
done
echo "  Done."

# ── Step 3: Upload workspace files (SOUL.md, AGENTS.md) ──────────────────────

echo "[3/5] Uploading workspace files..."
if [ -d "$LOCAL_WORKSPACE_DIR" ]; then
  for ws_file in "$LOCAL_WORKSPACE_DIR"/*.md; do
    if [ -f "$ws_file" ]; then
      ws_name=$(basename "$ws_file")
      echo "  -> $ws_name"
      scp $SSH_OPTS "$ws_file" "$SSH_USER@$EC2_IP:$REMOTE_WORKSPACE_DIR/$ws_name"
    fi
  done
  echo "  Done."
else
  echo "  Skipped (no workspace/ directory found)."
fi

# ── Step 4: Verify on remote ─────────────────────────────────────────────────

echo "[4/5] Verifying deployment..."
ssh $SSH_OPTS "$SSH_USER@$EC2_IP" "echo '  Skills:' && ls -la $REMOTE_SKILLS_DIR/ && echo '' && echo '  Workspace:' && ls -la $REMOTE_WORKSPACE_DIR/"
echo "  Done."

# ── Step 5: Restart OpenClaw ──────────────────────────────────────────────────

echo "[5/5] Restarting OpenClaw..."
ssh $SSH_OPTS "$SSH_USER@$EC2_IP" "
  if command -v openclaw &>/dev/null; then
    openclaw restart 2>/dev/null && echo '  OpenClaw restarted.' || echo '  openclaw restart failed, trying stop+start...' && openclaw stop 2>/dev/null; sleep 2; openclaw start 2>/dev/null && echo '  OpenClaw started.'
  elif systemctl is-active --quiet openclaw 2>/dev/null; then
    systemctl restart openclaw && echo '  OpenClaw service restarted.'
  elif [ -f \$HOME/.openclaw/pid ]; then
    kill \$(cat \$HOME/.openclaw/pid) 2>/dev/null || true
    sleep 2
    echo '  Killed old process. You may need to start OpenClaw manually.'
  else
    echo '  Could not find OpenClaw process. Please restart it manually.'
  fi
"

echo ""
echo "================================================"
echo "  Deployment complete!"
echo "================================================"
echo ""
echo "Skills deployed:"
for skill_dir in "$LOCAL_SKILLS_DIR"/*/; do
  echo "  - $(basename "$skill_dir")"
done
echo ""
echo "Workspace files deployed:"
if [ -d "$LOCAL_WORKSPACE_DIR" ]; then
  for ws_file in "$LOCAL_WORKSPACE_DIR"/*.md; do
    if [ -f "$ws_file" ]; then
      echo "  - $(basename "$ws_file")"
    fi
  done
fi
echo ""
echo "Test it: say 'Hey Molty' from the kiosk app."
