# Unified Brand Icon Source Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the desktop shell, SmartDiagram surfaces, and PPT Agent surfaces consume one shared icon source per product instead of mismatched PNG and Lucide artwork.

**Architecture:** Add framework-native SVG marks in a shared `components/brand` module. Keep the approved desktop SVG as the desktop source, render the shared SmartDiagram and PPT marks directly in shell artwork wrappers, and make the existing PPT `AppLogoMark` API delegate to the shared PPT mark so current callers remain stable.

**Tech Stack:** React 19, TypeScript, inline SVG, Vite, Node test runner, Playwright CLI.

---

### Task 1: Protect the shared-source contract

**Files:**
- Create: `frontend/src/components/brand/brandIconSources.test.ts`

**Step 1: Write the failing test**

Assert that `MacOSIcons.tsx` no longer imports `mindmap-384.png` or `presentation-384.png`, that `AppLogo.tsx` delegates to `PptAgentIconMark`, and that SmartDiagram brand surfaces import `SmartDiagramIconMark`.

**Step 2: Run test to verify it fails**

Run: `cd frontend && node --experimental-strip-types --test src/components/brand/brandIconSources.test.ts`

Expected: FAIL because the shared marks do not exist and the obsolete PNG imports remain.

### Task 2: Add shared SVG marks

**Files:**
- Create: `frontend/src/components/brand/AppIconMarks.tsx`
- Modify: `frontend/src/components/macos/MacOSIcons.tsx`

**Step 1: Implement the shared marks**

Create `SmartDiagramIconMark` from the approved purple pen-nib visual and `PptAgentIconMark` from the existing black P + cyan sparkle visual. Both accept normal SVG props plus an optional numeric `size`.

**Step 2: Replace obsolete shell PNG imports**

Render the two shared marks from `MindmapAppIcon` and `SlidesAppIcon` with the existing `mac-artwork-image` class so Dock, desktop, Spotlight, recent cards, and shell windows keep their sizing contract.

**Step 3: Run the contract test**

Expected: the PNG checks pass; page delegation checks still fail until Task 3.

### Task 3: Make page branding consume the shared marks

**Files:**
- Modify: `frontend/src/components/layout/CanvasPanel.tsx`
- Modify: `frontend/src/components/chat/ChatPanel.tsx`
- Modify: `frontend/src/ppt/components/AppLogo.tsx`
- Modify: `frontend/src/ppt/components/project-shell/ProjectShell.tsx`
- Modify: `frontend/src/ppt/ppt.css`

**Step 1: Replace SmartDiagram brand-only Lucide icons**

Use `SmartDiagramIconMark` in the canvas empty state, chat header, and chat empty state. Keep `Sparkles` where it means an AI action or automatic selection rather than product identity.

**Step 2: Delegate the PPT API**

Keep `AppLogoMark` as a compatibility export, but implement it by returning `PptAgentIconMark`. Remove wrapper backgrounds and sizing rules that would create a second tile behind the shared mark.

**Step 3: Run tests and build**

Run: `cd frontend && npm run test:shell && npm run build`

Expected: PASS.

### Task 4: Visual acceptance

**Files:**
- Create: `output/playwright/unified-brand-icons-final.png`

**Step 1: Open the desktop route**

Confirm Aqua desktop, purple pen, and black P + sparkle appear together in the Dock and desktop shortcuts.

**Step 2: Open SmartDiagram and PPT routes**

Confirm the page header/empty-state marks match their Dock artwork and no legacy blue-node or orange-chart icon remains.

**Step 3: Capture the final desktop screenshot**

Expected: one consistent source per product at menu, card, and Dock sizes; zero browser console errors.

### Task 5: Commit

Stage only the files in this plan and commit after user approval; do not include unrelated dirty-worktree changes.
