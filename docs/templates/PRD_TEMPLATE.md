# Product Requirements Document (PRD)

## 1. Meta & Traceability
- **Title**: [Feature/Project Name]
- **Constitutional Source**: [`PRODUCT.md`](../PRODUCT.md)
- **Companion System Spec**: [`docs/SRS.md`](./SRS.md)
- **Author(s)**: [Name / Agent]
- **Status**: [Draft / In Review / Approved / Shipped]
- **Target Release**: [Version / Date]

## 2. Problem Alignment
- **Problem Statement**: What specific engineering or user problem does this solve?
- **Target Audience**: Who uses this product?
- **Value Proposition**: How does this improve reliability, speed, or clarity?

## 3. Scope & Capabilities
### In Scope
- [Capability 1]
- [Capability 2]

### Out of Scope (Non-Goals)
- [Explicitly state what is excluded from this release]

## 4. Core User Flows
- **Onboarding Flow**: How a new developer or repository adopts the tool.
- **Daily Delivery Flow**: Step-by-step usage from branch creation to verified merge.
- **Failure Modes**: Expected diagnostics when checks fail.

## 5. Quality & Guardrail Metrics
- **Verification Thresholds**: Diff coverage and mutation score floors in `.agent/sdlc-config.json`.
- **Architectural Boundaries**: Concentric Clean Architecture policy in `.archlens/policy.json`.

## 6. Open Questions
- [Question 1]
