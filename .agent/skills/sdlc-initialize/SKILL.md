---
name: sdlc-initialize
description: Project bootstrap installer that scaffolds new full-stack (Svelte + Quarkus) repositories via dynamic interview and installs 3rd-party skills.
version: 1.0.0
license: Apache 2.0
---

# SDLC Initialization Installer (`sdlc-initialize`)

Use this skill to scaffold a brand new full-stack project or initialize the Agentic SDLC within an existing workspace. This skill conducts an interactive architectural interview before generating code.

## 📋 Core Responsibilities
1. **Interactive Architecture Interview**: Determine target users, full-stack vs backend, OIDC security, and Maven structure.
2. **Dynamic Quarkus Scaffolding**: Generate `pom.xml` with required extensions (e.g. `quarkus-oidc`) and strict static checks (PMD, Checkstyle, Jacoco).
3. **Frontend Svelte Scaffolding**: Scaffold the adjacent Svelte frontend.
4. **Agentic Boilerplate**: Setup `docs/templates/` and `docs/specs/`.
5. **Third-Party Skill Installation**: Download/install external dependencies like `impeccable`, `i-have-adhd`, `ponytail`, and `jvm-skills`.

---

## 🛠️ Execution Workflow

### 1. Interactive Interview
The agent must use the `ask_question` or `/grill-me` tool to ask the user the following questions sequentially:
1. **Scope**: "Are we scaffolding a Full-Stack project (Svelte + Quarkus) or just a Backend (Quarkus)?"
2. **Scale**: "What is the expected target number of users/scale? (Helps determine database sizing and caching extensions)"
3. **Security**: "What are the security requirements? (e.g. OIDC, JWT, Keycloak, or none)"
4. **Architecture**: "Should this be a single module or a Multi-module Maven project (api, core, infrastructure)?"
5. **Quality Checks**: "Confirm enforcement of hardened security, PMD, and Jacoco?"

### 2. Scaffold Quarkus Backend
Based on the interview:
- Run the Quarkus Maven plugin: `npx quarkus create app ...` or `mvn io.quarkus.platform:quarkus-maven-plugin:create ...`
- Add required extensions based on Security answers (`quarkus-oidc`, `quarkus-resteasy-reactive`, etc.)
- Modify `pom.xml` to include Maven Enforcer, PMD, Checkstyle, and Jacoco plugins for strict compliance.

### 3. Scaffold Svelte Frontend
If Full-Stack was selected:
- Run `npx sv create <project-name>-ui` adjacent to the backend.

### 4. Install 3rd-Party Skills
Execute the following to fetch skills into `.agent/skills/`:
- **impeccable**: `npx impeccable install`
- **i-have-adhd**: `curl -sSL https://raw.githubusercontent.com/ayghri/i-have-adhd/main/skills/i-have-adhd/SKILL.md -o .agent/skills/i-have-adhd/SKILL.md`
- **ponytail**: Fetch from `https://github.com/dietrichgebert/ponytail`
- **jvm-skills**: Fetch applicable JVM/Quarkus skills from `jvm-skills.com` or relevant repos.

---

## ⏭️ Next Recommended Step
Once scaffolding is complete, trigger `sdlc-feature-spec` to draft the initial PRD/SRS for the first feature, and run `sdlc-analyze` to establish a baseline compliance score.
