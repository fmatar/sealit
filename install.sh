#!/bin/bash
# NoteZen Agentic SDLC Framework Installer
set -e

# Default to local install
FLAG="--local ."

# Parse args (if --global is passed)
for arg in "$@"; do
    if [ "$arg" == "--global" ] || [ "$arg" == "-g" ]; then
        FLAG="--global"
    fi
done

echo "🚀 Downloading NoteZen SDLC Installer..."

# Create a safe temporary directory to avoid Java class name conflicts
TMP_DIR=$(mktemp -d)
INSTALL_SCRIPT="$TMP_DIR/install.java"

if [ -n "$GITHUB_TOKEN" ]; then
    curl -H "Authorization: token $GITHUB_TOKEN" -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.java" -o "$INSTALL_SCRIPT"
else
    curl -sL "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.java" -o "$INSTALL_SCRIPT"
fi

if ! command -v jbang &> /dev/null; then
    echo "⚠️ JBang is not installed. Installing JBang..."
    curl -sL https://jbang.dev/app/setup | bash
    # Source the env for this session
    export PATH="$HOME/.jbang/bin:$PATH"
fi

echo "⚡ Running JBang Installer with $FLAG..."
jbang "$INSTALL_SCRIPT" $FLAG
