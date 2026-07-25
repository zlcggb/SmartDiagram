# SmartDiagram macOS shell — design QA

## Scope

- Light Aqua desktop shell, menu bar, widgets, desktop shortcuts, Dock, Spotlight, Finder-style recent projects, login, About, Help, and system panels.
- Desktop actions remain product actions: mind map opens `/diagram`, presentations open `/ppt`, recent projects opens the Finder-style window, Spotlight modes filter real app/project/diagram/conversation results, and login actions open the authentication window.

## Sources and references

- User desktop reference: `/var/folders/fy/hqtdnrzd4896stjp7z2_g0h80000gn/T/codex-clipboard-f34f31ba-a388-498c-a040-3dd18bc0586f.png`
- User Dock before-state: `/var/folders/fy/hqtdnrzd4896stjp7z2_g0h80000gn/T/codex-clipboard-f3f13acc-8586-4947-9c12-0ea770cf1bcc.png`
- Apple Spotlight reference: `output/playwright/apple-official-spotlight.png`
- Apple macOS design guidance: <https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/>
- Apple app-icon guidance: <https://developer.apple.com/design/human-interface-guidelines/app-icons>
- Apple typography guidance: <https://developer.apple.com/design/human-interface-guidelines/typography>
- Apple materials guidance: <https://developer.apple.com/design/human-interface-guidelines/materials>
- Apple Spotlight behavior: <https://support.apple.com/en-mide/guide/mac-help/mchlp1008/mac>

## Implementation evidence

- Final desktop, 1440×900: `output/playwright/macos-desktop-final-v4.jpg`
- Responsive desktop, 1024×768: `output/playwright/macos-desktop-1024-v3.jpg`
- Responsive compact Spotlight, 1024×768: `output/playwright/macos-spotlight-1024-final.jpg`
- Spotlight application search: `output/playwright/macos-spotlight-search-final-v4.jpg`
- Finder-style recent projects with toolbar: `output/playwright/macos-finder-final-v3.jpg`
- Login window with offline recovery: `output/playwright/macos-login-final-v4.jpg`
- About window: `output/playwright/macos-about-native-v2.jpg`
- Searchable Help window: `output/playwright/macos-help-search-final.jpg`

## Same-frame comparisons

- Apple Spotlight reference vs implementation: `output/playwright/qa-spotlight-reference-vs-final-v4.jpg`
- User desktop reference vs implementation: `output/playwright/qa-desktop-reference-vs-final-v4.jpg`
- User Finder reference vs implementation: `output/playwright/qa-finder-reference-vs-final-v3.jpg`
- User Dock before-state vs implementation: `output/playwright/qa-dock-before-vs-final-v4.jpg`

## Findings and resolutions

- P1, resolved — Spotlight was a large results dialog with a full-desktop blur. It is now a compact search capsule with four separate circular browse-mode controls; results expand only after input or mode selection.
- P1, resolved — Spotlight category filtering happened after a mixed-result limit and could hide older valid records. Each mode now scopes the source collection before applying its result limit.
- P1, resolved — Desktop, Dock, Spotlight, About, Help, login, and Finder guest states used inconsistent glyph tiles. Four original layered macOS-style artwork assets now provide one consistent icon source across every surface; optimized 384 px runtime copies reduce their shipped weight to about 630 KB total.
- P1, resolved — The wallpaper used a root-relative public path and could break under a non-root deployment base. It is now imported through Vite as a bundled source asset.
- P1, resolved — The recent-projects window looked like Finder without Finder's working navigation surface. It now has previous/next category navigation, list/grid controls, and project search; controls that require authenticated data are honestly disabled for guests.
- P1, resolved — Login could instantiate an empty CAPTCHA URL after a configuration failure. It now exposes an explicit unavailable state and working retry path, while the CAPTCHA interaction is a keyboard-accessible button.
- P2, resolved — Dock items were undersized and lacked a meaningful files area. The Dock now has 56 px artwork, native-style magnification, a stronger divider, and a functional recent-projects folder. The app keeps its running indicator; the folder uses open-state emphasis without an application-running dot.
- P2, resolved — Login had a duplicated close control, excessive background blur, and inconsistent SmartDiagram branding. The window now uses only traffic-light controls, direct native-style content, a compact segmented control, the generated product artwork, and consistent SmartDiagram copy.
- P2, resolved — The search field showed a rectangular browser focus outline inside the capsule. Focus is now communicated by the capsule border and halo.
- P2, resolved — Programmatic focus painted a persistent outline around windows and the red traffic-light button. Windows now focus their first meaningful field or neutral surface without visual chrome; keyboard `:focus-visible` remains available.
- P2, resolved — Recent-project guest and row icons used generic gradient tiles. Category artwork is now used for PPT and diagram content while sidebar icons remain monochrome interface symbols.
- P2, resolved — Help was only a shortcut sheet. It now includes a working topic search that filters the real application shortcuts.
- P2, resolved — Frontend-only preview logged an unhandled CAPTCHA configuration fetch error. The configuration request now returns a safe offline fallback; the clean reload at 2026-07-21 11:15 CST logged no application errors.

## Interaction verification

- Spotlight opens from the menu bar, traps focus, closes from the backdrop/Escape path, and restores the compact state.
- Spotlight `应用` mode expands to three meaningful actions; searching `PPT` returns only `PPT 制作`.
- Dock `最近项目` opens the Finder-style window, keeps the SmartDiagram running indicator, marks only the folder's open state, and restores focus to the Dock trigger after closing.
- Finder previous/next controls change categories; sidebar categories remain interactive for guests and each presents category-specific login copy/artwork.
- Login autofocus lands on the email field, unavailable CAPTCHA exposes retry, registration is disabled when configuration closes it, and the submit control cannot send an invalid offline request.
- Help search with `PPT` returns only the matching `打开 PPT 制作` shortcut.
- About, Help, login, desktop app icons, menu items, Spotlight modes, and login/register tabs were opened in the in-app browser and visually inspected.
- 1440×900 and 1024×768 states have no clipping, horizontal overflow, broken artwork, or unreadable controls.
- Reduced-motion, reduced-transparency/high-contrast, focus-visible, and forced-colors rules remain present.

## Console and validation status

- Latest clean reload: no application console errors; only the repository's existing React Router v7 future-flag warnings.
- Targeted ESLint: passed with 0 errors.
- Shell tests: passed, 24/24.
- Production build: passed, 6,317 modules transformed. Existing OfficeParser browser-externalization and large-chunk advisories remain warnings only.
- `git diff --check`: passed.

final result: passed
