#!/bin/bash
set -e

echo "=== agentops-console dev pod init ==="

# Install Node.js 22 if not present
if ! command -v node &>/dev/null; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Install dev tools
echo "Installing dev tools..."
apt-get update -qq && apt-get install -y -qq \
  curl git make vim jq \
  && rm -rf /var/lib/apt/lists/*

# Mark hostPath as safe for git
git config --global --add safe.directory /workspace/agentops-console

echo "=== Dev pod ready ==="
echo "Go:      $(go version)"
echo "Node:    $(node --version)"
echo "npm:     $(npm --version)"

# Install npm deps
echo ""
echo "Installing npm dependencies..."
cd /workspace/agentops-console/web
npm install

# Build and start Go BFF in background (binary, not go run — avoids orphan child processes)
echo ""
echo "Building Go BFF..."
cd /workspace/agentops-console
go build -o /tmp/bff ./cmd/console/
echo "Starting Go BFF on :8080..."
/tmp/bff --dev --namespace agents > /tmp/bff.log 2>&1 &
BFF_PID=$!
echo "$BFF_PID" > /tmp/bff.pid
echo "Go BFF PID: $BFF_PID"

# Wait a moment for BFF to be ready
sleep 3

# Start Vite dev server (foreground — keeps the container alive)
echo "Starting Vite dev server on :5173..."
cd /workspace/agentops-console/web
exec npx vite --host 0.0.0.0
