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
if [ -n "$GITHUB_TOKEN" ]; then
    curl -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github.v3.raw" -sL "https://api.github.com/repos/fmatar/agentic-sdlc-framework/contents/install.java?ref=main" -o /tmp/notezen-install.java
else
    curl -sL https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.java -o /tmp/notezen-install.java
fi

if ! command -v jbang &> /dev/null; then
    echo "⚠️ JBang is not installed. Installing JBang..."
    curl -sL https://jbang.dev/app/setup | bash
    # Source the env for this session
    export PATH="$HOME/.jbang/bin:$PATH"
fi

echo "⚡ Running JBang Installer with $FLAG..."
jbang /tmp/notezen-install.java $FLAG
