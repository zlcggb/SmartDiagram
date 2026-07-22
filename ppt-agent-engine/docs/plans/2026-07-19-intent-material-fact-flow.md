# Intent Material Fact Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the approved topic → dynamic brief → material/fact confirmation → visual template → structure workflow.

**Architecture:** Keep the three existing intent tabs, but make their responsibilities sequential and exclusive. Parse uploaded documents in the browser and keep the existing text persistence boundary; enrich fact extraction on the Node API with topic and brief context. Add explicit brief origin metadata so mock/fallback questions are never presented as AI-generated.

**Tech Stack:** React 18, Zustand, React Router, TypeScript, Fastify, Prisma, Zod, Node test runner, officeparser.

---

### Task 1: Define and test intent-flow rules

**Files:**
- Create: `apps/web/src/components/intent/intentFlow.test.ts`
- Create: `apps/web/src/components/intent/intentFlow.ts`
- Modify: `apps/web/package.json`

**Steps:**
1. Write failing tests for the step order, fact-selection gate, supported material extensions, and material text append behavior.
2. Run `corepack pnpm --filter @ppt-agent/web test:intent`; expect failure because the helper does not exist.
3. Implement the smallest pure helpers required by the tests.
4. Re-run the test command; expect all tests to pass.

### Task 2: Make brief origin explicit and extraction context-aware

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/lib/intentContext.test.ts`
- Create: `apps/api/src/lib/intentContext.ts`
- Modify: `apps/api/src/routes/projects.ts`
- Modify: `apps/api/package.json`
- Modify: `packages/agents/src/studioHelpers.ts`
- Modify: `packages/agents/src/mockGeminiAdapter.ts`
- Modify: `packages/agents/src/realGeminiAdapter.ts`
- Modify: `packages/agents/src/openaiCompatibleAdapter.ts`
- Modify: `packages/agents/src/orchestration/types.ts`

**Steps:**
1. Write failing tests proving extraction context contains topic, confirmed brief summary, and source material without losing source boundaries.
2. Run `corepack pnpm --filter @ppt-agent/api test:intent`; expect failure.
3. Add brief origin metadata (`ai` or `fallback`) to shared schemas and adapter return contracts.
4. Build contextual extraction input in the API route and preserve facts until a successful extraction completes.
5. Re-run API tests and package typechecks.

### Task 3: Add and test document text extraction

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/components/intent/materialFile.ts`
- Create: `apps/web/src/components/intent/materialFile.test.ts`

**Steps:**
1. Write failing tests for plain-text files, office-parser injection, unsupported formats, empty extraction, and maximum file size.
2. Install `officeparser` in the web package.
3. Implement browser-side file parsing through a lazy import, with a 15 MB limit and no OCR/network dependency.
4. Run intent tests and web typecheck.

### Task 4: Rebuild the three intent tabs

**Files:**
- Modify: `apps/web/src/pages/IntentSpace.tsx`
- Modify: `apps/web/src/components/intent/BriefTab.tsx`
- Modify: `apps/web/src/components/intent/SourceTab.tsx`
- Modify: `apps/web/src/components/intent/VisualTab.tsx`
- Modify: `apps/web/src/styles.css`

**Steps:**
1. Change brief confirmation to navigate to `source` and show AI/fallback provenance.
2. Add upload affordance, parsed-file feedback, extraction CTA, editable fact cards, selected count, and a guarded `next visual` CTA.
3. Remove outline generation from the source tab.
4. Remove fact extraction and research from the visual tab; retain only theme persistence and outline generation.
5. Update copy so every CTA describes exactly one transition.
6. Run web tests, typecheck, and production build.

### Task 5: Verify the complete browser journey

**Files:**
- No production files expected.

**Steps:**
1. Start or reuse the local API/Web development services.
2. Create a topic project and verify brief origin messaging.
3. Confirm requirements and verify navigation to materials.
4. Paste/upload material, extract facts, edit/unselect facts, and verify persistence.
5. Enter visual selection, generate structure, and verify navigation to the structure workspace.
6. Capture screenshots at requirements, facts, and visual stages.
7. Run full affected-package typechecks and summarize any unrelated pre-existing failures separately.

### Task 6: Make brief confirmation model-free

**Files:**
- Modify: `apps/api/src/lib/intentContext.test.ts`
- Modify: `apps/api/src/lib/intentContext.ts`
- Modify: `apps/api/src/routes/projects.ts`
- Verify: `apps/web/src/components/intent/BriefTab.tsx`
- Verify: `apps/web/src/components/intent/SourceTab.tsx`
- Verify: `apps/web/src/components/intent/VisualTab.tsx`

**Steps:**
1. Write failing tests for a deterministic brief snapshot that preserves question/answer pairs and does not require an AI adapter.
2. Run `corepack pnpm --filter @ppt-agent/api test:intent`; expect failure because the helper does not exist.
3. Implement a pure brief snapshot builder and replace `adapter.finalizeBrief` in `brief/answer` with it.
4. Preserve the approved UI sequence: brief confirmation navigates to source, source confirmation navigates to visual, and only visual confirmation calls `generate-outline` then navigates to structure.
5. Re-run intent tests, affected-package typechecks, the web production build, and a browser network/AI-counter verification.
