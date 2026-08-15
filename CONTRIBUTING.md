# Contributing to NoteZen Agentic SDLC

First off, thank you for considering contributing to NoteZen! It's people like you that make this framework kick-ass.

## 🤖 Developing with Agents

This repository is designed to be developed **by agents, alongside humans**. When contributing, you are highly encouraged to use the provided `.agent/skills/` to orchestrate your work.

### The Recommended Workflow

1.  **Draft a Spec**: Ask your agent to run `sdlc-feature-spec` to generate an ADR or Feature Spec in `docs/templates/` describing what you want to build.
2.  **Implementation**: Use `sdlc-tdd-implement` for the code and `sdlc-test-coverage` for the tests. If you're building a large feature, ask the agent to run `sdlc-flow` to fork subagents and handle it all in parallel.
3.  **Run the Quality Gate**: Before submitting a Pull Request, you or your agent MUST run the `sdlc-quality-gate`. This ensures:
    *   No TypeScript errors (`svelte-check`).
    *   No broken tests (`vitest`).
    *   No high/critical security vulnerabilities (`npm audit`).
    *   WCAG 2.1 AA Accessibility compliance.
    *   Clean production builds.

## 👨‍💻 Manual Contributions

If you prefer to write code manually without the agentic framework:

1.  **Fork and Branch**: Create a new branch for your feature (`feat/your-feature`) or bugfix (`fix/your-bug`).
2.  **Test-Driven Development**: We enforce strict TDD. Write failing tests in Vitest before implementing your logic.
3.  **Commit Messages**: We use [Conventional Commits](https://www.conventionalcommits.org/). Your commit messages should look like:
    *   `feat: added new observer pattern`
    *   `fix: resolved race condition in audio node`
    *   `docs: updated wiki architecture diagrams`
4.  **Open a Pull Request**: Use the provided GitHub Pull Request template. Ensure all GitHub Actions CI checks (which run `sdlc-quality-gate`) pass before requesting a review.

## 🐛 Found a Bug?

Please use the **Bug Report** issue template on GitHub. Provide as much context as possible, including steps to reproduce. If you are using an agent, you can ask the agent to parse the bug report and use `sdlc-tdd-implement` to fix it!

## ✨ Feature Requests

Please use the **Feature Request** issue template. We encourage you to provide a rough PRD or Acceptance Criteria so our `sdlc-feature-spec` skill can easily ingest it.
