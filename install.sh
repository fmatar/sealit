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
USE_SKILLS_CLI=auto
IS_UPDATE=false
WITH_ARCHLENS=false
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
        -u|--update)
            IS_UPDATE=true
            shift
            ;;
        --with-archlens)
            WITH_ARCHLENS=true
            shift
            ;;
        --skip-detect)
            SKIP_DETECT=true
            shift
            ;;
        --skills-cli|--vercel-skills)
            USE_SKILLS_CLI=true
            shift
            ;;
        --no-skills-cli|--legacy)
            USE_SKILLS_CLI=false
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
            echo "  -l, --local [DIR]       Install locally into target project directory (default: current directory)"
            echo "  -g, --global            Install globally into ~/.gemini/config/skills"
            echo "  -u, --update            Update framework skills, scripts, and sync Archlens policies"
            echo "      --skills-cli        Use Vercel Labs skills CLI (npx skills add fmatar/agentic-sdlc-framework)"
            echo "      --no-skills-cli     Bypass skills CLI and use zero-dependency POSIX archive copy"
            echo "      --with-archlens     Configure Archlens Clean Architecture governance & MCP"
            echo "      --skip-detect       Skip automatic stack detection (sdlc-engine detect)"
            echo "      --jbang             Use JBang install.java instead of native POSIX installer"
            echo "  -h, --help              Show this help message"
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
    if [[ -f "install.java" ]]; then
        exec jbang install.java $FLAG
    else
        exec jbang "https://raw.githubusercontent.com/fmatar/agentic-sdlc-framework/main/install.java" $FLAG
    fi
fi

# --- Source Resolution & Extraction ---
SCRIPT_DIR=""
IN_GIT_REPO=false

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if command -v git &>/dev/null && git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
        if [[ -n "$(git -C "$SCRIPT_DIR" ls-tree -d HEAD .agent/skills 2>/dev/null)" ]]; then
            IN_GIT_REPO=true
        fi
    fi
fi

echo "⚡ Installing Agentic SDLC Framework ($MODE mode)..."

DEPRECATED_SDLC_SKILLS=(
    "sdlc-analyze"
    "sdlc-arch-trace"
    "sdlc-docs-wiki"
    "sdlc-feature-spec"
    "sdlc-help"
    "sdlc-initialize"
    "sdlc-kanban"
    "sdlc-peer-review"
    "sdlc-quality-gate"
    "sdlc-release-changelog"
    "sdlc-tdd-implement"
    "sdlc-test-coverage"
)

prune_deprecated_skills() {
    local skills_dir="$1"
    [[ ! -d "$skills_dir" ]] && return 0
    for old_skill in "${DEPRECATED_SDLC_SKILLS[@]}"; do
        if [[ -d "${skills_dir}/${old_skill}" ]]; then
            rm -rf "${skills_dir:?}/${old_skill:?}"
        fi
    done
}

# --- Vercel Labs Skills CLI Integration (https://skills.sh) ---
SKILLS_CLI_SUCCESS=false
if [[ "$USE_SKILLS_CLI" == true ]] || [[ "$USE_SKILLS_CLI" == "auto" && "$IN_GIT_REPO" == false ]]; then
    if command -v npx &>/dev/null; then
        echo "📦 Checking Vercel Labs Skills ecosystem (npx skills)..."
        SKILLS_CLI_ARGS="add fmatar/agentic-sdlc-framework --skill '*' -y --copy"
        if [[ "$MODE" == "global" ]]; then
            SKILLS_CLI_ARGS="$SKILLS_CLI_ARGS --global"
        fi

        # Run skills CLI from target directory (or current directory for global)
        RUN_DIR="$TARGET_DIR"
        [[ "$MODE" == "global" ]] && RUN_DIR="$ORIGINAL_DIR"

        if (cd "$RUN_DIR" && npx --yes skills $SKILLS_CLI_ARGS 2>/dev/null); then
            echo "✅ Skills successfully installed via Vercel Labs skills CLI!"
            SKILLS_CLI_SUCCESS=true
        else
            if [[ "$USE_SKILLS_CLI" == true ]]; then
                echo "❌ Failed to install via skills CLI." >&2
                exit 1
            fi
            echo "ℹ️  Skills CLI unavailable or skipped; proceeding with universal direct installer..."
        fi
    fi
fi

# Download archive if not running from inside the framework repository
if [[ "$IN_GIT_REPO" == false ]]; then
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    AUTH_TOKEN="${GITHUB_TOKEN:-}"
    if [[ -z "$AUTH_TOKEN" ]] && command -v gh &>/dev/null; then
        AUTH_TOKEN="$(gh auth token 2>/dev/null || true)"
    fi

    if [[ -n "$AUTH_TOKEN" ]]; then
        if ! curl -sL -H "Authorization: token $AUTH_TOKEN" "$ARCHIVE_URL" | tar -xz -C "$TMP_DIR" --strip-components=1; then
            echo "❌ Failed to download or unpack repository archive." >&2
            echo "   Please check network connection and verify token permissions." >&2
            exit 1
        fi
    else
        if ! curl -sL "$ARCHIVE_URL" | tar -xz -C "$TMP_DIR" --strip-components=1; then
            echo "❌ Failed to download or unpack repository archive." >&2
            echo "   If this is a private repository, export GITHUB_TOKEN=... or authenticate with 'gh auth login'." >&2
            exit 1
        fi
    fi
fi

if [[ "$MODE" == "global" ]]; then
    DEST_SKILLS="$HOME/.gemini/config/skills"
    DEST_SCRIPTS="$HOME/.gemini/config/scripts"
    mkdir -p "$DEST_SKILLS" "$DEST_SCRIPTS"
    prune_deprecated_skills "$DEST_SKILLS"

    if [[ "$IN_GIT_REPO" == true ]]; then
        cp -R "${SCRIPT_DIR}/.agent/skills/." "$DEST_SKILLS/"
        [[ -d "${SCRIPT_DIR}/.agent/scripts" ]] && cp -R "${SCRIPT_DIR}/.agent/scripts/." "$DEST_SCRIPTS/"
    else
        cp -R "${TMP_DIR}/.agent/skills/." "$DEST_SKILLS/"
        [[ -d "${TMP_DIR}/.agent/scripts" ]] && cp -R "${TMP_DIR}/.agent/scripts/." "$DEST_SCRIPTS/"
    fi

    # Fix POSIX execution permissions
    chmod +x "$DEST_SKILLS"/*/scripts/*.sh 2>/dev/null || true
    chmod +x "$DEST_SCRIPTS"/*.sh 2>/dev/null || true
    chmod +x "$DEST_SCRIPTS"/*.mjs 2>/dev/null || true

    SKILL_COUNT=$(find "$DEST_SKILLS" -mindepth 1 -maxdepth 1 -type d -name "sdlc-*" | wc -l | tr -d ' ')
    echo "✅ Global installation complete!"
    echo "   • SDLC Skills ($SKILL_COUNT loaded): $DEST_SKILLS"
    echo "   • Engine & Scripts:    $DEST_SCRIPTS"
    echo ""
    echo "💡 All Antigravity agent sessions can now access the 6 consolidated sdlc-* skills globally."
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
prune_deprecated_skills "${TARGET_ABS}/.agent/skills"
prune_deprecated_skills "${TARGET_ABS}/.agents/skills"

if [[ "$IN_GIT_REPO" == true ]]; then
    if [[ "$TARGET_ABS" != "$SCRIPT_DIR" ]]; then
        cp -R "${SCRIPT_DIR}/.agent/skills/." "$DEST_SKILLS/"
        [[ -d "${SCRIPT_DIR}/.agent/scripts" ]] && cp -R "${SCRIPT_DIR}/.agent/scripts/." "$DEST_SCRIPTS/"
        [[ -d "${SCRIPT_DIR}/docs/templates" ]] && cp -R "${SCRIPT_DIR}/docs/templates/." "$DEST_TEMPLATES/"
    fi
else
    cp -R "${TMP_DIR}/.agent/skills/." "$DEST_SKILLS/"
    [[ -d "${TMP_DIR}/.agent/scripts" ]] && cp -R "${TMP_DIR}/.agent/scripts/." "$DEST_SCRIPTS/"
    [[ -d "${TMP_DIR}/docs/templates" ]] && cp -R "${TMP_DIR}/docs/templates/." "$DEST_TEMPLATES/"
fi

# Fix POSIX execution permissions
chmod +x "$DEST_SKILLS"/*/scripts/*.sh 2>/dev/null || true
chmod +x "$DEST_SCRIPTS"/*.sh 2>/dev/null || true
chmod +x "$DEST_SCRIPTS"/*.mjs 2>/dev/null || true

SKILL_COUNT=$(find "$DEST_SKILLS" -mindepth 1 -maxdepth 1 -type d -name "sdlc-*" | wc -l | tr -d ' ')

echo "✅ Local installation complete in: $TARGET_ABS"
echo "   • SDLC Skills ($SKILL_COUNT loaded): ${TARGET_ABS}/${AGENT_DIR_NAME}/skills"
echo "   • Engine & Scripts:    ${TARGET_ABS}/${AGENT_DIR_NAME}/scripts"
echo "   • Specs & Templates:   ${TARGET_ABS}/docs/templates"

# --- Archlens Governance Setup (if requested or updating) ---
if [[ "$WITH_ARCHLENS" == true ]] || [[ "$IS_UPDATE" == true && -d "${TARGET_ABS}/.archlens" ]]; then
    if command -v npx &> /dev/null; then
        echo ""
        echo "🏛️ Synchronizing Archlens Clean Architecture Governance..."
        (cd "$TARGET_ABS" && npx -y @fmatar/archlens-skill update --path . 2>/dev/null || npx -y @fmatar/archlens-skill --path . --yes --mcp) || echo "⚠️ Archlens setup skipped or non-fatal."
    fi
fi

# --- Turnkey Stack Probing ---
if [[ "$SKIP_DETECT" == false ]]; then
    if command -v node &> /dev/null && [[ -f "${DEST_SCRIPTS}/sdlc-engine.mjs" ]]; then
        echo ""
        echo "🔍 Running Universal Stack Detection..."
        (cd "$TARGET_ABS" && node "${DEST_SCRIPTS}/sdlc-engine.mjs" detect) || echo "⚠️ Stack detection skipped or non-fatal."
    fi
fi

# --- Multi-Agent Interoperability Rules Sync (Claude Code, Cursor, Windsurf) ---
if command -v node &> /dev/null && [[ -f "${DEST_SCRIPTS}/sdlc-engine.mjs" ]]; then
    echo ""
    (cd "$TARGET_ABS" && node "${DEST_SCRIPTS}/sdlc-engine.mjs" interop export --agent all 2>/dev/null) || true
fi

echo ""
if [[ "$IS_UPDATE" == true ]]; then
    echo "🎉 Agentic SDLC Framework has been updated successfully!"
else
    echo "🎉 Agentic SDLC Framework is ready across all agent runtimes!"
fi
echo "👉 Prompt your Agent (Antigravity, Claude Code, Cursor, Windsurf): \"Run sdlc-flow for issue #<id>\" or \"Run sdlc-init\""
