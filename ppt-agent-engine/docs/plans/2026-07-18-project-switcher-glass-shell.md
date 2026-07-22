# Project Switcher Glass Shell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a polished glass-style workspace header with a real recent-project switcher and matching project cards on the home page.

**Architecture:** Add a read-only `GET /api/projects` endpoint returning recently updated `ProjectDto` records. Keep project-list state local to reusable React components so existing workbench loading and generation state remain unchanged. Use one shared visual system in `styles.css` for the shell, project popover, pills, buttons, and responsive behavior.

**Tech Stack:** Fastify, Prisma, shared TypeScript DTOs, React 18, React Router, Tailwind utilities, CSS, Lucide icons.

---

### Task 1: Add the recent-project API

**Files:**
- Modify: `apps/api/src/routes/projects.ts`
- Modify: `apps/web/src/lib/api.ts`

**Steps:**
1. Add `GET /api/projects` before the parameterized project route.
2. Query projects ordered by `updatedAt desc` with a bounded limit.
3. Format every row through `formatProject`.
4. Add a typed `api.listProjects()` client.
5. Run API and web typechecks.

### Task 2: Build the reusable project switcher

**Files:**
- Create: `apps/web/src/components/ProjectSwitcher.tsx`
- Modify: `apps/web/src/components/ProjectShell.tsx`

**Steps:**
1. Build an accessible trigger with current-project name and mode.
2. Fetch recent projects only when needed and provide loading, empty, and failure states.
3. Add client-side search and recent-project links that preserve each project's correct entry route.
4. Close on outside click and Escape; expose a visible “新建项目” action.
5. Replace the loose header title block with the switcher and a compact brand/home control.

### Task 3: Add recent projects to the home page

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx`

**Steps:**
1. Load the same project list on page mount.
2. Render recent project cards with theme indicator, mode, page count, updated time, and a clear open action.
3. Keep project creation forms intact but rebalance the page hierarchy.
4. Verify empty and populated states.

### Task 4: Apply the glass workspace visual system

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/components/ProjectShell.tsx`

**Steps:**
1. Add shared CSS variables for glass surfaces, highlights, borders, radii, and shadows.
2. Restyle the sticky header, navigation rail, usage badge, and action buttons.
3. Add restrained hover/focus/open transitions and responsive behavior.
4. Preserve dense studio canvas space and accessibility contrast.

### Task 5: Verify behavior and visuals

**Steps:**
1. Run shared/API/web typechecks and the web production build.
2. Start the local app with the existing database.
3. Capture home and studio screenshots at desktop width.
4. Verify project switching, current-project highlighting, search, outside-click/Escape dismissal, and mobile wrapping.
5. Run whitespace checks on changed source files.
