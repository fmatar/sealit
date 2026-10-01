#!/usr/bin/env bash
# ==============================================================================
# Agentic SDLC Framework Universal Installer
# Zero-dependency, ultra-fast installation for macOS & Linux environments.
# ==============================================================================
set -euo pipefail

ORIGINAL_DIR="$(pwd)"
TARGET_DIR="$ORIGINAL_DIR"
MODE="local"
SKIP_DETECT=false
USE_JBANG=false
REPO_URL="https://github.com/fmatar/agentic-sdlc-framework"
ARCHIVE_URL="${REPO_URL}/archive/refs/heads/main.tar.gz"

# --- Argument Parsing ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        -g|--global)
            MODE="global"
            shift
            ;;
        -l|--local)
            MODE="local"
            if [[ -n "${2:-}" && ! "$2" =~ ^- ]]; then
                TARGET_DIR="$2"
                shift 2
            else
                shift
            fi
            ;;
        --skip-detect)
            SKIP_DETECT=true
            shift
            ;;
        --jbang)
            USE_JBANG=true
            shift
            ;;
        -h|--help)
            echo "Agentic SDLC Framework Installer"
            echo "Usage: install.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -l, --local [DIR]   Install locally into target project directory (default: current directory)"
            echo "  -g, --global        Install globally into ~/.gemini/config/skills"
            echo "      --skip-detect   Skip automatic stack detection (sdlc-engine detect)"
            echo "      --jbang         Use JBang install.java instead of native POSIX installer"
            echo "  -h, --help          Show this help message"
            exit 0
            ;;
        *)
            echo "⚠️ Unknown argument: $1 (ignoring)"
            shift
            ;;
    esac
done

# --- JBang Delegation Path (if explicitly requested) ---
if [[ "$USE_JBANG" == true ]]; then
    echo "☕ Delegating to JBang installer (install.java)..."
    if ! command -v jbang &> /dev/null; then
        echo "⚠️ JBang is not installed. Installing JBang..."
        curl -sL https://jbang.dev/app/setup | bash
        export PATH="$HOME/.jbang/bin:$PATH"
    fi
    FLAG="--local $TARGET_DIR"
    if [[ "$MODE" == "global" ]]; then
        FLAG="--global"
    fi
    if [[ "$SKIP_DETECT" == true ]]; then
        FLAG="$FLAG --skip-detect"
    fi
    exec jbang install.java $FLAG
fi

# --- Source Resolution & Extraction ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IN_GIT_REPO=false
if command -v git &>/dev/null && git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
    IN_GIT_REPO=true
fi

echo "⚡ Installing Agentic SDLC Framework ($MODE mode)..."

if [[ "$MODE" == "global" ]]; then
    DEST_SKILLS="$HOME/.gemini/config/skills"
    DEST_SCRIPTS="$HOME/.gemini/config/scripts"
    mkdir -p "$DEST_SKILLS" "$DEST_SCRIPTS"

    if [[ "$IN_GIT_REPO" == true ]]; then
        git -C "$SCRIPT_DIR" archive HEAD .agent/skills/ | tar -x -C "$DEST_SKILLS" --strip-components=2
        git -C "$SCRIPT_DIR" archive HEAD .agent/scripts/ | tar -x -C "$DEST_SCRIPTS" --strip-components=2
    else
        TMP_DIR="$(mktemp -d)"
        trap 'rm -rf "$TMP_DIR"' EXIT
        CURL_HEADERS=()
        [[ -n "${GITHUB_TOKEN:-}" ]] && CURL_HEADERS=(-H "Authorization: token $GITHUB_TOKEN")
        curl -sL "${CURL_HEADERS[@]}" "$ARCHIVE_URL" | tar -xz -C "$TMP_DIR" --strip-components=1
        cp -R "${TMP_DIR}/.agent/skills/." "$DEST_SKILLS/"
        [[ -d "${TMP_DIR}/.agent/scripts" ]] && cp -R "${TMP_DIR}/.agent/scripts/." "$DEST_SCRIPTS/"
    fi

    # Fix POSIX execution permissions
    chmod +x "$DEST_SKILLS"/*/scripts/*.sh 2>/dev/null || true
    chmod +x "$DEST_SCRIPTS"/*.mjs 2>/dev/null || true

    SKILL_COUNT=$(find "$DEST_SKILLS" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
    echo "✅ Global installation complete!"
    echo "   • Skills ($SKILL_COUNT loaded): $DEST_SKILLS"
    echo "   • Engine & Scripts:    $DEST_SCRIPTS"
    echo ""
    echo "💡 All Antigravity agent sessions can now access sdlc-* skills globally."
    exit 0
fi

# --- Local Installation ---
mkdir -p "$TARGET_DIR"
TARGET_ABS="$(cd "$TARGET_DIR" && pwd)"
AGENT_DIR_NAME=".agent"
if [[ -d "${TARGET_ABS}/.agents/skills" ]]; then
    AGENT_DIR_NAME=".agents"
fi

DEST_SKILLS="${TARGET_ABS}/${AGENT_DIR_NAME}/skills"
DEST_SCRIPTS="${TARGET_ABS}/${AGENT_DIR_NAME}/scripts"
DEST_TEMPLATES="${TARGET_ABS}/docs/templates"

mkdir -p "$DEST_SKILLS" "$DEST_SCRIPTS" "$DEST_TEMPLATES"

if [[ "$IN_GIT_REPO" == true ]]; then
    if [[ "$TARGET_ABS" != "$SCRIPT_DIR" ]]; then
        git -C "$SCRIPT_DIR" archive HEAD .agent/skills/ | tar -x -C "$DEST_SKILLS" --strip-components=2
        git -C "$SCRIPT_DIR" archive HEAD .agent/scripts/ | tar -x -C "$DEST_SCRIPTS" --strip-components=2
        git -C "$SCRIPT_DIR" archive HEAD docs/templates/ | tar -x -C "$DEST_TEMPLATES" --strip-components=2
    fi
else
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    CURL_HEADERS=()
    [[ -n "${GITHUB_TOKEN:-}" ]] && CURL_HEADERS=(-H "Authorization: token $GITHUB_TOKEN")
    curl -sL "${CURL_HEADERS[@]}" "$ARCHIVE_URL" | tar -xz -C "$TMP_DIR" --strip-components=1
    cp -R "${TMP_DIR}/.agent/skills/." "$DEST_SKILLS/"
    [[ -d "${TMP_DIR}/.agent/scripts" ]] && cp -R "${TMP_DIR}/.agent/scripts/." "$DEST_SCRIPTS/"
    [[ -d "${TMP_DIR}/docs/templates" ]] && cp -R "${TMP_DIR}/docs/templates/." "$DEST_TEMPLATES/"
fi

# Fix POSIX execution permissions
chmod +x "$DEST_SKILLS"/*/scripts/*.sh 2>/dev/null || true
chmod +x "$DEST_SCRIPTS"/*.mjs 2>/dev/null || true

SKILL_COUNT=$(find "$DEST_SKILLS" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')

echo "✅ Local installation complete in: $TARGET_ABS"
echo "   • Skills ($SKILL_COUNT loaded): ${TARGET_ABS}/${AGENT_DIR_NAME}/skills"
echo "   • Engine & Scripts:    ${TARGET_ABS}/${AGENT_DIR_NAME}/scripts"
echo "   • Specs & Templates:   ${TARGET_ABS}/docs/templates"

# --- Turnkey Stack Probing ---
if [[ "$SKIP_DETECT" == false ]]; then
    if command -v node &> /dev/null && [[ -f "${DEST_SCRIPTS}/sdlc-engine.mjs" ]]; then
        echo ""
        echo "🔍 Running Universal Stack Detection..."
        (cd "$TARGET_ABS" && node "${AGENT_DIR_NAME}/scripts/sdlc-engine.mjs" detect) || echo "⚠️ Stack detection skipped or non-fatal."
    fi
fi

echo ""
echo "🎉 Agentic SDLC Framework is ready!"
echo "👉 Prompt your Antigravity agent: \"Run sdlc-flow for issue #<id>\" or \"Run sdlc-help\""
