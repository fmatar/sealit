---
id: ADR-003
title: Shell-Free Command Execution, Least-Privilege Self-Hosted CI, and Bundled Config Schema
status: accepted
scope: technical
ticket: #105
supersedes: 
createdAt: 2026-11-12T18:08:28.446Z
---

# ADR-003: Shell-Free Command Execution, Least-Privilege Self-Hosted CI, and Bundled Config Schema

- **Status**: `accepted`
- **Blast Radius / Scope**: `technical`
- **Triggered By Ticket**: #105
- **Supersedes / Amends**: None

## 1. Context & Spec Drift Trigger
Configured commands previously executed via /bin/sh, GitHub Actions workflows lacked explicit least-privilege permissions and self-hosted runner isolation, and package.json omitted .agent/schemas.

## 2. Decision
Execute configured commands strictly via execFileSync (parseCommandArgv/runConfiguredCommand), enforce permissions: contents: read and mktemp/repo-local git config on workflows, and include .agent/schemas in package.json files.

## 3. Consequences & Downstream Impact
Zero shell injection surface in sdlc-config.json, safe execution on persistent local-archlens self-hosted runners, and valid local schema resolution in npm tarballs.
