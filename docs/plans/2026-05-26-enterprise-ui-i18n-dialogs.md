# Enterprise UI Dialogs and i18n Execution Plan

## Goal

Replace browser-native prompts with product-owned dialogs and add a lightweight bilingual i18n foundation for enterprise-facing UI surfaces.

## Scope

- Replace `window.prompt`, `window.confirm`, and frontend `alert()` calls for branch, rollback, export, and canvas notices.
- Add reusable in-app dialog primitives for text input, confirmation, and notices.
- Add Chinese/English translation keys for enterprise panels.
- Consolidate low-frequency header actions into the settings dialog.
- Keep enterprise UI text consistent across history, preferences, export, approval, and ops surfaces.

## Implemented Steps

1. Added frontend i18n foundation.
   - `frontend/src/i18n.ts`
   - Supports `zh` and `en`.
   - Uses browser locale as initial language.
   - Persists the selected language in `localStorage` under `smartdiagram.locale`.
   - Provides `useT()` with interpolation.

2. Added in-app dialog primitives.
   - `frontend/src/components/common/AppDialog.tsx`
   - `TextInputDialog` for branch naming.
   - `ConfirmDialog` for rollback and high-risk export confirmation.
   - `NoticeDialog` for product-owned error display.

3. Replaced native branch and rollback prompts.
   - Historical diagram branch creation now uses `TextInputDialog`.
   - Message version branch creation now uses `TextInputDialog`.
   - Rollback confirmation now uses `ConfirmDialog`.
   - Version and branch failures now use `NoticeDialog`.

4. Replaced high-risk export confirmation and canvas export alerts.
   - PDF/PPTX confirmation now uses `ConfirmDialog`.
   - Export errors now use `NoticeDialog`.
   - React Flow canvas export notices now use `NoticeDialog`.

5. Added bilingual enterprise UI copy.
   - Settings exposes the language toggle and persists the selected locale.
   - History panel, preference panel, export menu, approval card, and Agent Ops dashboard consume i18n keys.
   - Canvas welcome, generating, design-rationale, local-edit, and settings modal copy consume i18n keys.
   - Chat empty state examples, input toolbar, streaming status text, thinking timeline, Knowledge/Consistency cards, and version diff/action labels now consume i18n keys.
   - Export failure messages and the React Flow inline-edit tooltip now consume i18n keys.
   - Draw.io, Mermaid, Charts, Mindmap, and Infographic canvas loading, error, toolbar, theme, zoom, and pagination labels now consume i18n keys.
   - Header subtitle and settings model configuration labels now consume i18n keys.
   - Agent Ops metric labels, audit signal event types, run statuses, phases, engines, approval types, and trace metadata now consume i18n keys while preserving raw audit keys in tooltips.
   - Live Agent timeline cards now use i18n labels for execution plan, short-term memory, long-term preferences, planning, design, repair, consistency, and export.
   - Conversation resume indicators now use i18n labels for canvas-restorable and no-canvas-snapshot states.

6. Consolidated the chat header controls into a settings center.
   - The right sidebar header now keeps only History and Settings as top-level actions.
   - Diagram preferences, Agent Ops, language, theme, and clear conversation are grouped inside `SettingsModal`.
   - Settings now uses a left-navigation settings center with Appearance, Model Config, Diagram Preferences, Agent Ops, and Conversation sections.
   - Diagram Preferences and Agent Ops are embedded inside the settings center instead of opening separate secondary panels.
   - Clear conversation now uses a product-owned confirmation dialog and keeps saved diagram history intact.

7. Refined settings navigation and embedded Agent Ops layout.
   - Removed the redundant General section from the settings sidebar because the remaining sections are already concrete entry points.
   - Settings now opens directly on Appearance.
   - Embedded Agent Ops no longer uses the full-width six-card dashboard layout inside the settings panel.
   - Agent Ops metric tiles now wrap into roomier two/three-column rows in settings, and signal bars are stacked for readability.
   - Embedded Agent Ops uses the parent settings scroll area instead of nesting another cramped full-dashboard viewport.

## Security and UX Rules

- Branch and rollback actions still call the same permission-checked APIs.
- Dialogs do not bypass approval, export confirmation, or audit paths.
- i18n text is presentation-only; permission context and API payloads remain unchanged.
- Browser-native `window.prompt` and `window.confirm` are not used in frontend source.
- Browser-native `alert()` is not used in frontend source.
- Low-frequency actions should stay inside Settings unless they are needed during normal diagram generation.

## Acceptance Checks

```bash
npm run build
rg -n "window\\.prompt|window\\.confirm" frontend/src
rg -n "alert\\(" frontend/src
git diff --check
```

Latest verification:

- `npm run build` passed, with only existing large Vite chunk warnings.
- `npm run build` passed again after adding bilingual live Agent memory and execution cards.
- `npm run build` passed again after adding bilingual conversation resume canvas-state indicators.
- `rg -n "window\\.prompt|window\\.confirm|alert\\(" frontend/src` returned no frontend source matches.
- Targeted checks confirmed migrated settings and canvas copy now only appears in `frontend/src/i18n.ts`.
- Targeted `ChatPanel.tsx` scan now has no user-visible Chinese string literals outside `frontend/src/i18n.ts`; remaining Chinese matches are comments only.
- Targeted `ExportButton.tsx` and `FlowCanvas.tsx` scan now has no user-visible Chinese string literals outside `frontend/src/i18n.ts`; remaining Flow matches are comments only.
- Targeted Draw.io, Mermaid, Charts, Mindmap, and Infographic canvas scans now have no user-visible Chinese string literals outside `frontend/src/i18n.ts`; remaining Chinese matches are comments only.
- Agent Ops signal labels were browser-verified in Chinese; raw audit event keys remain available only as hover titles for debugging.
- Browser verification confirmed Settings left navigation switches Diagram Preferences and Agent Ops inside the same settings panel.
- Header consolidation passed `npm run build` and `git diff --check`.
- Removing the General section and compacting embedded Agent Ops passed `npm run build` and `git diff --check`.

## Follow-Up Candidates

- Continue migrating deeper third-party renderer labels only where the app owns the UI surface.
- Persist language preference through the backend user profile once real authentication replaces the local enterprise context.
