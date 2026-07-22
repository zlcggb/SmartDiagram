# Unified AI Project Intake Implementation Plan

> **Goal:** Replace the theme-first, two-entry homepage with one consultant-style intake that accepts a topic and optional reference material, then moves visual selection after requirements are understood.

## Product flow

1. The homepage opens on one primary AI composer.
2. Users can describe a topic, paste reference material, or attach supported text files.
3. The first submission creates a project, stores any reference material, and opens one consultant questionnaire.
4. After the brief is confirmed, the product recommends three visual directions while still allowing all themes or an AI-selected default.
5. Research, fact extraction, outline generation, sticky-note planning, design, and export continue in the existing workspace.

## Task 1: Unified homepage intake

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/styles.css`

- Replace the large hero, theme grid, and separate topic/paste cards with one focused glass composer.
- Add an optional reference-material panel and real client-side text-file reading for TXT, Markdown, CSV, JSON, HTML, XML, and RTF.
- Keep recent projects as a compact secondary section.
- Create all new projects with an internal topic workflow and save reference text before navigation.

## Task 2: Consultant brief and visual direction

**Files:**
- Modify: `apps/web/src/pages/BriefPage.tsx`

- Start consultant questions automatically for a fresh project.
- Surface whether reference material has been attached.
- Split continuation into two explicit stages: confirm requirements, then choose visual direction.
- Recommend themes deterministically from the confirmed topic/report context, with AI-auto and full-theme controls.
- Extract facts when reference material exists, then run research and generate the outline.

## Task 3: Unified workspace semantics

**Files:**
- Modify: `apps/web/src/components/ProjectShell.tsx`
- Modify: `apps/web/src/components/ProjectSwitcher.tsx`
- Modify: `apps/web/src/store/workbenchStore.ts`
- Modify: `apps/api/src/routes/projects.ts`

- Show both Requirements and Materials as capabilities rather than mutually exclusive flows.
- Replace topic/paste mode labels with a unified consultant-workspace label.
- Preserve a project's internal mode during brief calls instead of rewriting it as a side effect.

## Task 4: Verification

- Run web/API/shared type checks and the production web build.
- Verify the homepage and consultant flow at desktop, tablet, and mobile widths.
- Confirm that topic-only and reference-assisted submissions both persist and reach the same brief page.
