# Design: Compact top-bar update indicator

## Scope and domain

Domain: `frontend`. Issue #188 changes only the presentation of the existing update indicator in `src/components/AppBar.vue`: replace its 28px red circular badge with a small red dot. This is a v0.2.1 patch release. The approved proposal and `specs/update-check/spec.md` define the boundary; update discovery, eligibility, notice lifecycle, persistence, and release behavior are out of scope.

The current component renders the indicator only when `hasAvailableUpdate()` is true. Clicking the button calls `restoreUpdateNotice`; the button has an accessible name and `title`. Preserve these bindings and attributes exactly. The small indicator stays beside the brand. No changes are needed to Rust, stores, update APIs, PRD, or the shared technical design for this presentation-only change.

## Implementation approach

Keep the patch to the indicator markup and its scoped CSS in `src/components/AppBar.vue`:

- Keep the existing button, `v-if`, class, `type`, accessible name, `title`, and click handler.
- Remove the visible bullet text glyph. Render a small red dot with CSS, such as a dedicated empty, `aria-hidden` child whose inline box is approximately 8px; do not render text content or a 28px red circular surface.
- Keep a usable button hit area and keyboard focus indication while making its resting/hover surface transparent. The visual dot remains red; hover/focus feedback must not restore the old large badge. Preserve current app-bar placement and avoid shifting neighboring controls beyond what the smaller visual indicator naturally requires.
- Do not change `hasAvailableUpdate`, `restoreUpdateNotice`, update store state, dismissal persistence, toast behavior, or timers.

This is a single-component visual adjustment with no state migration and no network, permission, concurrency, or transaction implications.

## Scenario-to-validation mapping

| Behavior scenario | Validation |
|---|---|
| Update prompt automatically closes | Existing toast tests continue to cover the 15-second close behavior. Review the AppBar CSS for the 8px dot, transparent button surface, and keyboard focus affordance. |
| User reopens the update prompt | AppBar test sets an available, dismissed update; asserts the indicator is adjacent to the brand, its `aria-label` and `title` are preserved, no glyph/text is rendered, and click restores `noticeVisible`. Existing toast tests cover prompt contents. |
| No update is available | AppBar test covers `up-to-date` and asserts the indicator is absent. |
| User views details or postpones | Existing update store and toast tests cover these unchanged behaviors; this change does not modify them. |

Extend the existing `src/components/appbar.test.ts` cases rather than creating a new test harness. The markup behavior is directly asserted in the co-located Vue component test. Dot dimensions and surface styling should be checked against the CSS diff; avoid brittle snapshot assertions of the entire component. No fixture is required.

## Version and release acceptance

Update the application-owned version declarations to `0.2.1`: `package.json`, root entries in `package-lock.json`, `src-tauri/Cargo.toml`, the `music-tag` entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Update README's current version badge and add a concise v0.2.1 note describing only the compact update dot. Do not replace historical version references or alter third-party dependency versions.

Tester and Verify run the focused `src/components/appbar.test.ts` suite, `npm run build`, and `npm run test`; the full CI-required OpenSpec and Rust checks remain applicable per `.github/workflows/ci.yml` even though product code changes are frontend-only. Record commands, exit codes, and the exact HEAD. After merge and required CI success, release acceptance requires the existing release workflow for tag `v0.2.1` to finish successfully and the public Release to point to the merged version commit. Confirm its published status and expected platform assets before reporting release completion; a tag or queued run alone is insufficient evidence.

## File ownership and limits

- Dev may edit only `src/components/AppBar.vue`, `src/components/appbar.test.ts`, the five version metadata files listed above, and `README.md`.
- Tester may make a scoped correction only after the main agent explicitly authorizes its path; otherwise Tester is read-only.
- CR and Verify are read-only. Main agent alone changes task completion/progress, Git state, and release state.

Do not edit PRD/design documentation, update logic/store/API, workflow definitions, unrelated component styles, or release behavior. If implementation requires changing update eligibility, accessibility wording, toast restoration, or persistence, stop and return for a scope decision.
