#!/bin/bash
set -e

echo "=== agentops-core operator dev pod init ==="

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

# Install kubectl if not present
if ! command -v kubectl &>/dev/null; then
  echo "Installing kubectl..."
  curl -fsSL "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl
  chmod +x /usr/local/bin/kubectl
fi

# Mark hostPath as safe for git
git config --global --add safe.directory /workspace/agentops-core

echo "=== Dev pod ready ==="
echo "Go:      $(go version)"
echo "Node:    $(node --version)"
echo "npm:     $(npm --version)"
echo "kubectl: $(kubectl version --client --short 2>/dev/null || kubectl version --client)"
echo ""
echo "Source code at /workspace/agentops-core"
echo "Run: make generate && make manifests && make install"
echo "Run: go build -o /tmp/manager ./cmd/main.go && /tmp/manager"

# Keep the pod alive
exec sleep infinity
