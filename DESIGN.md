---
name: Agentic SDLC Framework
description: Double-Entry Clean Architecture Clearinghouse, Causal ADR Lineage & Cryptographic SHA-256 Merkle Audit Ledger
colors:
  primary: "#1e40af"
  primary-hover: "#1d4ed8"
  primary-soft: "#dbeafe"
  seal-pass: "#166534"
  seal-pass-bg: "#dcfce7"
  seal-crimson: "#991b1b"
  seal-crimson-bg: "#fee2e2"
  seal-amber: "#92400e"
  seal-amber-bg: "#fef3c7"
  paper: "#eef2f6"
  folio: "#f8fafc"
  well: "#e2e8f0"
  well-deep: "#cbd5e1"
  ink: "#0f172a"
  ink-secondary: "#334155"
  ink-muted: "#475569"
  rule: "#cbd5e1"
  rule-strong: "#94a3b8"
typography:
  display:
    fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif'
    fontSize: "clamp(1.35rem, 1.1rem + 0.8vw, 1.85rem)"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif'
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.35
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "5px"
  lg: "6px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.folio}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.folio}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-danger:
    backgroundColor: "{colors.seal-crimson-bg}"
    textColor: "{colors.seal-crimson}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  card-folio:
    backgroundColor: "{colors.folio}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
  chip-seal-pass:
    backgroundColor: "{colors.seal-pass-bg}"
    textColor: "{colors.seal-pass}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
---

# Design System: Agentic SDLC Framework

## Overview

**Creative North Star: "The Double-Entry Clearinghouse Ledger"**

The Agentic SDLC Framework governs software engineering through constitutional invariants (`INV-01` through `INV-04`), concentric Clean Architecture rings, causal Architecture Decision Records (`ADR-00X`), and cryptographic SHA-256 Merkle gate receipts. Its visual identity rejects the generic dark-slate developer dashboard of glowing neon cards and raw `<pre>` JSON/Markdown dumps in favor of an authoritative **Double-Entry Mercantile & Central Bank Audit Ledger**. Every commit, ring boundary delta, and ADR adjudication is presented as a balanced, verifiable entry on cool security bond paper with elevated folio sheets and recessed audit wells.

Information density is high, structured, and scannable without visual noise. Typographic hierarchy pairs an engraved editorial serif (`Iowan Old Style` / `Palatino`) for folio mastheads and ledger titles with a crisp workhorse UI sans-serif for prose and tabular-numeral monospace (`tabular-nums`) for SHA-256 Merkle roots, commit SHAs, file paths, and stage counters.

**Key Characteristics:**
- **Double-Entry Balance Sheet Topology:** Side-by-side Debit and Credit folios pairing Concentric Ring Boundary Deltas against Cryptographic SHA-256 Merkle & Mermaid AST Diffs.
- **Archival Security Bond Palette:** Cool security paper (`#eef2f6`), elevated folio sheets (`#f8fafc`), and recessed header wells (`#e2e8f0`) ruled with hairline (`1px`) slate dividers.
- **Cryptographic Seal Semantics:** Dedicated verification green, crimson violation, and clearinghouse cobalt ink seals that communicate constitutional status at a glance.
- **Zero Raw Dumps or Decorative Clutter:** All Markdown tables (`docs/KANBAN.md`, `docs/ARCH_TRACE.md`) and JSON payloads are parsed into semantic, filterable, sticky-header tables and swimlanes with zero emojis or eyebrow kickers.

## Colors

The palette draws from steel-engraved clearinghouse security paper, iron-gall ledger ink, and institutional verification seals.

### Primary
- **Clearinghouse Cobalt** (`#1e40af`): Used for active workspace tabs, primary operator actions (`Approve ADR`, `Resume DAG`), active 8-stage pipeline steps, and interactive focus rings.
- **Active Cobalt Hover** (`#1d4ed8`): Interactive hover state for primary cobalt buttons and links.
- **Soft Cobalt Tint** (`#dbeafe`): Background fill for active pipeline stage cards, selected table rows, and active session badges.

### Secondary
- **Verification Seal Green** (`#166534` on `#dcfce7`): Reserved strictly for verified SHA-256 Merkle chains, zero-violation Clean Architecture ring states, cleared pipeline stages, and accepted ADRs.
- **Crimson Audit Seal** (`#991b1b` on `#fee2e2`): Reserved strictly for concentric ring violations, broken Merkle chains, rejected ADRs, and destructive/halt controls (`Reject ADR`, `Pause DAG`).
- **Amber Review Seal** (`#92400e` on `#fef3c7`): Used for pending ADR proposals and review-stage warnings.

### Neutral
- **Security Bond Paper** (`#eef2f6`): Root page canvas and nested inner folio boxes.
- **Elevated Folio Sheet** (`#f8fafc`): Primary workspace canvas, masthead surface, and table cell backgrounds.
- **Recessed Audit Well** (`#e2e8f0`): Section headers, sticky table headers, workspace navigation rail, and inspector wells.
- **Iron-Gall Ink** (`#0f172a`): Primary heading and data copy (15.8:1 contrast against Folio Sheet).
- **Ledger Slate Ink** (`#334155`): Secondary descriptions, column metadata, and inactive tab labels (9.3:1 contrast).
- **Muted Audit Ink** (`#475569`): De-emphasized notes and empty-state hints (6.8:1 contrast).
- **Hairline & Section Rules** (`#cbd5e1` / `#94a3b8`): `1px solid` cell dividers (`--rule`) and outer folio borders (`--rule-strong`).

### Named Rules
**The Seal Scarcity Rule.** Green, crimson, and cobalt fills appear only on semantic audit seals, active stage pills, and primary interactive controls—never as decorative card backgrounds or side-border stripes.
**The Cool Security Ground Rule.** Page and folio grounds maintain a cool slate-tinted bond paper temperature (`#eef2f6` / `#f8fafc`), avoiding warm cream or beige defaults.

## Typography

**Display & Folio Serif:** `"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`
**Body & Control Sans:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
**Audit Monospace:** `"SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace`

**Character:** Authoritative, editorial, and forensic. Serif headers establish institutional permanence while monospace tabular numerals ensure vertical alignment across SHA-256 hashes, ticket IDs, and delta counts.

### Hierarchy
- **Display** (`700`, `clamp(1.35rem, 1.1rem + 0.8vw, 1.85rem)`, `line-height: 1.25`, `letter-spacing: -0.02em`): Masthead title (`h1`) with `text-wrap: balance`.
- **Headline** (`700`, `16px`, `line-height: 1.35`): Folio box headers (`h2`, `h3`) and workspace titles.
- **Title** (`700`, `13px–14px`, `line-height: 1.4`): Table headers (`thead th`), Kanban column headers, and governance desk titles.
- **Body** (`400–500`, `13px–14px`, `line-height: 1.5`): Descriptions, checkpoint rationales, and ticket titles (constrained to `70ch–72ch` max line width on prose subtitles).
- **Label / Mono** (`600`, `11px–12px`, `line-height: 1.4`, `font-variant-numeric: tabular-nums`): Stage badges, SHA-256 roots, commit SHAs, file paths, and count pills.

### Named Rules
**The Tabular Ledger Rule.** Every numeric counter, timestamp, commit hash, SHA-256 digest, and stage index enforces `font-variant-numeric: tabular-nums`.
**The 11px Floor Rule.** No functional label, badge, or table cell drops below `11px`.
**The Direct Heading Rule.** Every `h1`, `h2`, and `h3` stands directly on its own wording without an uppercase kicker or eyebrow label above it.

## Layout

The workbench uses a **Workspace Shell with Focused Views** inside a `1560px` centered container (`.clearinghouse-shell`) with fluid `clamp(16px, 2vw, 28px)` outer padding:
1. **Top Masthead & Cryptographic Seal Bar:** Displays project identity on the left and live session, ring balance, Merkle chain verification seals, and the `Sync Ledger` trigger on the right.
2. **8-Stage Lifecycle Interlocking Rail:** An 8-column responsive grid (`repeat(8, minmax(110px, 1fr))` on desktop, reflowing to `repeat(4, 1fr)` at `<=1080px` and `repeat(2, 1fr)` at `<=600px`) showing `Cleared`, `Active`, and `Queued` stages.
3. **Workspace Switcher Bar:** Full-width tab strip switching cleanly between 5 operational workspaces (`Clearinghouse Balance Sheet`, `Causal Decision Lineage & ADRs`, `Time-Machine & Product DAG`, `Living Kanban Dashboard`, and `Architectural Trace Ledger`).
4. **Double-Entry Clearinghouse Grid:** Side-by-side responsive grid (`repeat(auto-fit, minmax(min(100%, 420px), 1fr))` with `24px` gap) pairing left and right folios.
5. **Container-Query Responsive Tables:** Every data table sits inside a `.table-wrapper` (`container-type: inline-size; padding: 12px 16px; max-block-size: min(560px, 76dvh)`) with sticky `thead` and sticky `tbody th` headers, collapsing into labeled stacked cards at `@container (width < 600px)`.

## Elevation & Depth

Depth is achieved primarily through **tonal paper layering and crisp hairline rules**, supplemented by a single restrained ambient shadow on outer folio sheets.

### Shadow Vocabulary
- **Folio Sheet Rest** (`box-shadow: 0 2px 8px -2px rgba(20, 24, 31, 0.06)`): Applied to `.masthead`, `.lifecycle-rail`, and `.workspace-canvas` to lift the primary ledger sheets slightly off the `#eef2f6` bond paper canvas.

### Named Rules
**The Hairline Rule.** All internal structure—folio headers, table rows, Kanban swimlanes, and governance desks—is separated by `1px solid` rules (`#cbd5e1` and `#94a3b8`), never by heavy drop shadows or thick colored side borders.

## Shapes

Corners are crisp and mechanical, echoing bound paper folios and punched index cards:
- **Outer Folio Sheets (`.masthead`, `.lifecycle-rail`, `.workspace-canvas`):** `6px` border radius with `1px solid #94a3b8` border.
- **Inner Folio Boxes & Kanban Columns (`.folio-box`, `.board-column`, `.ledger-toolbar`):** `5px` border radius.
- **Buttons, Inputs, Seal Badges & Ticket Cards (`.action-btn`, `.seal-badge`, `.ws-tab`, `.ticket-entry`):** `4px` border radius.

## Components

### Buttons (`.action-btn`)
- **Shape:** Mechanical `4px` radius with `1px solid #94a3b8` border and `6px 12px` padding (`12px` font size, `600` weight).
- **Primary (`.action-btn.primary`):** Clearinghouse Cobalt (`#1e40af`) background with `#f8fafc` text; hovers to `#1d4ed8`.
- **Danger (`.action-btn.danger`):** Soft crimson (`#fee2e2`) background with `#991b1b` text and `#fca5a5` border; hovers to `#fecaca`.
- **Secondary / Default:** Folio (`#f8fafc`) background with `#0f172a` text; hovers to Recessed Well (`#e2e8f0`) with `#1e40af` border.

### Chips / Audit Seals (`.seal-badge`, `.seal-pill`)
- **Style:** Inline-flex pill with `4px` radius, `6px 12px` padding, `12px` `600` weight text, `white-space: nowrap`, and `tabular-nums`.
- **State Variants:** `.pass` (`#dcfce7` bg / `#166534` ink / `#86efac` border), `.fail` (`#fee2e2` bg / `#991b1b` ink / `#fca5a5` border), `.warn` (`#fef3c7` bg / `#92400e` ink / `#fcd34d` border), `.cobalt` (`#dbeafe` bg / `#1e40af` ink / `#93c5fd` border).

### Cards / Folio Boxes (`.folio-box`)
- **Corner Style:** `5px` radius.
- **Background:** `#eef2f6` outer box with `#e2e8f0` `.folio-box-header` and `#f8fafc` `.folio-box-sub`.
- **Border:** `1px solid #94a3b8` (`--rule-strong`).
- **Internal Padding:** `12px 16px` on header, sub-bar, and `.table-wrapper` inset.

### Inputs / Fields (`.filter-input`)
- **Style:** `1px solid #94a3b8` stroke, `#f8fafc` background, `4px` radius, `7px 12px` padding, `13px` font size.
- **Focus:** `2px solid #1e40af` outline with `2px` offset.

### Navigation (`.workspace-nav`, `.ws-tab`)
- **Style:** Horizontal strip in `#e2e8f0` well with `4px`-radius tab buttons (`7px 11px` padding, `12px` `600` weight), inline `1.75px`-stroke SVG icons, and monospace count badges (`.ws-count`).
- **States:** Default transparent with `#334155` text; hover `#f8fafc` fill; active (`aria-selected="true"`) `#1e40af` cobalt fill with `#f8fafc` text.

### Signature Component: Double-Entry Clearinghouse Balance Sheet
Pairs the **Debit Folio (Clean Architecture Ring Diff & AST Inspector)** on the left against the **Credit Folio (Cryptographic Merkle Audit & Mermaid AST Schedule)** on the right. Both folios use sticky-header responsive tables with `tabular-nums` delta counters and semantic audit seals.

## Do's and Don'ts

### Do:
- **Do** parse all Markdown (`docs/KANBAN.md`, `docs/ARCH_TRACE.md`, `PRODUCT.md`) and JSON (`docs/AUDIT_CHAIN.jsonl`) into semantic HTML tables or swimlane cards before rendering.
- **Do** use `container-type: inline-size` on `.table-wrapper` and `content-visibility: auto` on `.board-column` swimlanes to keep layout and rendering work isolated.
- **Do** keep all functional text at or above `11px` and apply `font-variant-numeric: tabular-nums` to all hashes, counts, and timestamps.

### Don't:
- **Don't** render raw JSON (`JSON.stringify(..., null, 2)`) or raw Markdown inside `<pre>` blocks in the operator UI.
- **Don't** use emojis or Unicode icon substitutes anywhere in headings, badges, table cells, or status messages; use crisp `1.75px`-stroke inline SVG icons or typographic seal badges.
- **Don't** place uppercase kicker/eyebrow labels above `h1`, `h2`, or `h3` headings, or apply thick colored `border-left` stripes (`> 1px`) to cards or callouts.
