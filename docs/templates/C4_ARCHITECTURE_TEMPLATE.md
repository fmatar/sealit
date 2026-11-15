# C4 Architecture Model Template

*Based on Simon Brown's C4 Model for Visualizing Software Architecture. Use Mermaid.js for diagrams.*

## 1. System Context (Level 1)
**Purpose**: Shows the software system you are building and how it fits into the world in terms of the people who use it and the other software systems it interacts with.

```mermaid
flowchart TD
    user["User (Actor)"] -->|"Uses"| system["[System Name] (Core System)"]
    system -->|"Gets data from (HTTPS)"| external["External System"]
```

## 2. Container (Level 2)
**Purpose**: Zooms into the software system, showing the high-level technical building blocks (containers) and how they interact. A "container" is a web application, mobile app, database, file system, etc.

```mermaid
flowchart TD
    user["User (Actor)"] -->|"Visits (HTTPS)"| webapp["Web Application"]
    subgraph SystemBoundary["[System Name]"]
        webapp -->|"Makes API calls to (JSON/HTTPS)"| api["API Server (Node.js, Express)"]
        api -->|"Reads from and writes to (SQL)"| db[("Database (PostgreSQL)")]
    end
```

## 3. Component (Level 3)
**Purpose**: Zooms into an individual container to show the components inside it.

```mermaid
flowchart TD
    spa["Single Page App (Svelte)"] -->|"Makes requests to (JSON/HTTPS)"| auth["Auth Controller (Express Middleware)"]
    subgraph ApiBoundary["API Application"]
        auth -->|"Authorizes and passes to"| feature["Feature Service (TypeScript Class)"]
        feature -->|"Uses for data access"| repo["Data Repository (TypeORM)"]
    end
```

## 4. Code / Data flow (Level 4 - Optional)
**Purpose**: Zooms into an individual component to show how it works (e.g., Sequence diagrams, class diagrams, state machines).

```mermaid
sequenceDiagram
    participant U as User
    participant C as Component
    participant S as Service
    
    U->>C: Action
    C->>S: Request Data
    S-->>C: Return Data
    C-->>U: Update UI
```
