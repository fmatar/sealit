---
name: sdlc-initialize
description: Project bootstrap installer that scaffolds new full-stack (Svelte 5 + Quarkus Java 25) repositories via dynamic interview and configures agentic SDLC workflows, Dual-Gate testing, and mutation testing (PITest & Stryker).
version: 3.0.0
license: Apache 2.0
allowed-tools: run_command, view_file, write_to_file
---

# SDLC Initialization Installer (`sdlc-initialize`)

Use this skill to scaffold a brand new full-stack project or initialize the Agentic SDLC framework within an existing workspace. Scaffolds projects ready for Robert C. Martin TDD craftsmanship, F.I.R.S.T. harness isolation, and Dual-Gate mutation defense.

---

## 📋 Core Responsibilities

1. **Interactive Architecture Interview**: Determine stack scope (Full-Stack vs Backend API), authentication requirements (OIDC/Keycloak), database tier, and module structure.
2. **Quarkus Backend Scaffolding**: Scaffold Maven project configured with Java 25, Mutiny reactive extensions, Spotless formatting, JaCoCo, random test port isolation (`quarkus.http.test-port=0`), and **PITest** mutation testing (`org.pitest:pitest-maven` + `pitest-junit5-plugin`).
3. **Svelte 5 Frontend Scaffolding**: Scaffold modern SvelteKit UI with Svelte 5 Runes, Tailwind CSS, Vitest, and **Stryker Mutator** (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`).
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
- Configure **PITest** in `pom.xml`:
  ```xml
  <plugin>
      <groupId>org.pitest</groupId>
      <artifactId>pitest-maven</artifactId>
      <version>1.17.4</version>
      <dependencies>
          <dependency>
              <groupId>org.pitest</groupId>
              <artifactId>pitest-junit5-plugin</artifactId>
              <version>1.2.1</version>
          </dependency>
      </dependencies>
      <configuration>
          <mutationThreshold>80</mutationThreshold>
          <targetClasses>
              <param>com.example.*</param>
          </targetClasses>
      </configuration>
  </plugin>
  ```

### 3. Scaffold Svelte 5 Frontend
If Full-Stack was chosen:
- Scaffold modern Svelte 5 app:
  ```bash
  npx sv create frontend-ui
  ```
- Add **Stryker Mutator** dependencies and configure `stryker.config.json`:
  ```bash
  npm i --save-dev @stryker-mutator/core @stryker-mutator/vitest-runner
  ```
  ```json
  {
    "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
    "testRunner": "vitest",
    "mutate": ["src/lib/**/*.ts", "!src/lib/**/*.test.ts"],
    "thresholds": { "high": 85, "low": 80, "break": 80 }
  }
  ```

### 4. Install Agentic SDLC Skills
- Copy `.agent/skills/` (all 12 skills) and `docs/templates/` into the target workspace.
- Ensure executable permissions on script assets: `chmod +x .agent/skills/sdlc-kanban/scripts/kanban-sync.sh`.
- Initialize `docs/specs/`, `docs/KANBAN.md`, and `CHANGELOG.md` with Keep a Changelog template.

---

## ⏭️ Next Recommended Step

Once initialized, trigger **`sdlc-feature-spec`** to draft the initial PRD/SRS for the first feature, and run **`sdlc-analyze`** to establish a baseline health report.
