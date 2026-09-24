#!/bin/bash
# Agentic SDLC Framework Installer
set -e

ORIGINAL_DIR=$(pwd)
FLAG="--local $ORIGINAL_DIR"

# Parse args (if --global is passed)
for arg in "$@"; do
    if [ "$arg" == "--global" ] || [ "$arg" == "-g" ]; then
        FLAG="--global"
    fi
done

echo "🚀 Downloading Agentic SDLC Framework..."
TMP_DIR=$(mktemp -d)

if [ -n "$GITHUB_TOKEN" ]; then
    git clone --quiet --depth 1 "https://x-access-token:$GITHUB_TOKEN@github.com/fmatar/agentic-sdlc-framework.git" "$TMP_DIR/agentic-sdlc-framework"
else
    git clone --quiet --depth 1 "https://github.com/fmatar/agentic-sdlc-framework.git" "$TMP_DIR/agentic-sdlc-framework"
fi

cd "$TMP_DIR/agentic-sdlc-framework"

if ! command -v jbang &> /dev/null; then
    echo "⚠️ JBang is not installed. Installing JBang..."
    curl -sL https://jbang.dev/app/setup | bash
    export PATH="$HOME/.jbang/bin:$PATH"
fi

echo "⚡ Running JBang Installer..."
jbang install.java $FLAG

# Cleanup
rm -rf "$TMP_DIR"
