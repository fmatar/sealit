---
name: sdlc-initialize
description: Project bootstrap installer that scaffolds new full-stack (Svelte 5 + Quarkus Java 25) repositories via dynamic interview and configures agentic SDLC workflows.
version: 2.0.0
license: Apache 2.0
allowed-tools: run_command, view_file, write_to_file
---

# SDLC Initialization Installer (`sdlc-initialize`)

Use this skill to scaffold a brand new full-stack project or initialize the Agentic SDLC framework within an existing workspace.

---

## 📋 Core Responsibilities

1. **Interactive Architecture Interview**: Determine stack scope (Full-Stack vs Backend API), authentication requirements (OIDC/Keycloak), database tier, and module structure.
2. **Quarkus Backend Scaffolding**: Scaffold Maven project configured with Java 25, Mutiny reactive extensions, Spotless formatting, JaCoCo $\ge$ 90% threshold, and random test port isolation (`quarkus.http.test-port=0`).
3. **Svelte 5 Frontend Scaffolding**: Scaffold modern SvelteKit UI with Svelte 5 Runes, Tailwind CSS, and Vitest.
4. **Agentic Framework Setup**: Copy `.agent/skills/` and `docs/templates/` into the project root.

---

## 🛠️ Execution Workflow

### 1. Interactive Interview
Collect requirements:
1. **Scope**: Full-Stack (Svelte 5 + Quarkus) or Backend API (Quarkus)?
2. **Security**: OIDC / Keycloak, JWT, or none?
3. **Persistence**: PostgreSQL Reactive (Hibernate Reactive Panache), Flyway migrations.
4. **Architecture**: Single module or multi-module Maven project.

### 2. Scaffold Quarkus Backend
- Run Quarkus Maven plugin:
  ```bash
  mvn io.quarkus.platform:quarkus-maven-plugin:create \
      -DprojectGroupId=com.example \
      -DprojectArtifactId=backend-server \
      -Dextensions="resteasy-reactive-jackson,hibernate-reactive-panache,reactive-pg-client"
  ```
- Configure `com.diffplug.spotless:spotless-maven-plugin` in `pom.xml`.
- Configure `quarkus.http.test-port=0` in `application.properties` to avoid parallel test collisions.

### 3. Scaffold Svelte 5 Frontend
If Full-Stack was chosen:
- Scaffold modern Svelte 5 app:
  ```bash
  npx sv create frontend-ui
  ```

### 4. Install Agentic SDLC Skills
- Copy `.agent/skills/` (all 12 skills) and `docs/templates/` into the target workspace.
- Ensure executable permissions on script assets: `chmod +x .agent/skills/sdlc-kanban/scripts/kanban-sync.sh`.
- Initialize `docs/specs/`, `docs/KANBAN.md`, and `CHANGELOG.md` with Keep a Changelog template.

---

## ⏭️ Next Recommended Step

Once initialized, trigger **`sdlc-feature-spec`** to draft the initial PRD/SRS for the first feature, and run **`sdlc-analyze`** to establish a baseline health report.
