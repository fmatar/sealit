# Contributing to Agentic SDLC Framework

Thank you for considering contributing to the Agentic SDLC Framework!

## 🤖 Developing with Agents

This repository is designed to be developed **by agents, alongside humans**. When contributing, use the provided `.agent/skills/` to orchestrate your work.

### The Recommended Workflow

1. **Draft a Spec**: Ask your agent to run `sdlc-feature-spec` to generate an ADR or Feature Spec in `docs/templates/` describing what you want to build.
2. **Implementation**: Use `sdlc-tdd-implement` for the code and `sdlc-test-coverage` for the tests. If executing an issue, use `sdlc-flow` to run the 8-stage lifecycle.
3. **Run the Quality Gate**: Before submitting a Pull Request, you or your agent MUST run `sdlc-quality-gate`. This ensures:
   - Spotless / Prettier code formatting.
   - Zero TypeScript errors (`svelte-check`).
   - All tests passing with $\ge$ 90% coverage on modified lines (`vitest`, `jacoco`).
   - No high/critical security vulnerabilities (`npm audit`, dependency check).
   - WCAG 2.1 AA Accessibility compliance.
   - Clean production builds.

## 👨‍💻 Manual Contributions

If you prefer to write code manually without the agentic framework:

1. **Fork and Branch**: Create a new branch for your feature (`feat/your-feature`) or bugfix (`fix/your-bug`).
2. **Test-Driven Development**: We enforce strict TDD. Write failing tests before implementing logic.
3. **Commit Messages**: We use [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: added new provider sync adapter`
   - `fix: resolved race condition in event sync`
   - `docs: updated wiki architecture diagrams`
4. **Open a Pull Request**: Ensure all GitHub Actions CI checks (which run `sdlc-quality-gate`) pass before requesting a review.

## 🐛 Found a Bug?

Please use the **Bug Report** issue template on GitHub. Provide as much context as possible, including steps to reproduce. If using an agent, you can ask the agent to parse the bug report and use `sdlc-flow` to fix it!

## ✨ Feature Requests

Please use the **Feature Request** issue template. We encourage you to provide Acceptance Criteria so our `sdlc-feature-spec` skill can easily ingest it.
