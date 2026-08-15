# NoteZen Fork-Join Architecture

NoteZen utilizes a highly parallelized "Fork-Join" architecture orchestrated by `sdlc-flow`.

## The Pipeline
1. **Intake**: A GitHub Issue (Bug or Feature) triggers the flow.
2. **Contract (`sdlc-feature-spec`)**: A rigid Product Requirements Document (PRD) and Software Requirements Specification (SRS) is generated.
3. **Fork (Parallel Execution)**:
   - Worker A (`sdlc-tdd-implement`): Writes code.
   - Worker B (`sdlc-test-coverage`): Writes Vitest coverage.
   - Worker C (`sdlc-docs-wiki`): Writes documentation.
4. **Join & Quality Gate (`sdlc-quality-gate`)**: All branches converge and are audited for security, type safety, performance, and accessibility.
5. **Release (`sdlc-release-changelog`)**: Code is merged, tagged with SemVer, Dockerized, and deployed via Helm.
