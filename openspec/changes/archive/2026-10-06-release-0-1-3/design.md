# Design: v0.1.3 release review

## Domain and boundaries

Primary domain: `docs` + `infra`. This change reviews the already shipped user-facing behavior from PRs #143, #151, and #153, aligns release metadata and README notes, and validates the tag-triggered release path. It adds no product capability. Any implementation fix must address a concrete defect in those approved behaviors and remain within the existing PRD/design contracts; otherwise stop and request a parent decision.

## Review strategy

Review the merged changes and their tests independently against the applicable PRD/design clauses:

- #143: embedded-cover export; verify exported bytes come from the embedded front cover and export leaves tags/form state unchanged.
- #151: folder auto-refresh; verify recursive watch target replacement, stale-event isolation, event coalescing, list-read failure behavior, and preservation of selection/editor state.
- #153: search-source availability and localization; verify per-source failure vs successful-empty semantics, source statistics, and translated user-facing strings.

The CR is a separate read-only pass after implementation and targeted regression checks. It records the reviewed commits/files, applicable scenarios, findings by severity, and evidence. If no blocker/major issue exists, explicitly record that conclusion. Fix only confirmed in-spec defects; each fix gets a targeted regression test and is sent through an independent follow-up CR. Do not fold in PR #155 workflow-only changes except when a demonstrated release-gate defect requires it.

## Release metadata and notes

Set all existing user-facing/package/build version declarations to `0.1.3` consistently, including the README badge. Update README release notes with concise entries for embedded cover export, folder auto-refresh, and search-source availability plus language adaptation. Exclude development-process-only changes. Do not create a tag or GitHub Release until changes are merged and required CI passes.

## Verification and release flow

Use repository CI as the verification authority: inspect applicable workflow conditions and execute all enabled CI-equivalent commands on the final source snapshot. Run strict validation for this OpenSpec change and the required all-spec validation. For affected behavior, run focused regressions; for review-only behavior with no source change, cite existing tests and review evidence. Check version values across app metadata and README badge. After merge, create/use the existing tag-triggered workflow for `v0.1.3`, create a draft Release, and verify the workflow/build result and draft contents. If tag-triggered release behavior differs from the approved spec or CI fails, stop and report concrete evidence.

## Risks

- Version values can be duplicated across frontend, Tauri, packaging, and release configuration; enumerate actual declarations before editing and verify consistency afterward.
- Watchers and asynchronous search can have timing-sensitive failures; targeted checks must cover stale events and success-with-empty vs all-network-failed cases where relevant.
- Release creation is an external side effect and is sequenced after merge and passing CI; retain draft status as required by the spec.

## Files expected to change

- `openspec/changes/release-0-1-3/design.md`, `tasks.md`
- Version metadata files discovered in the repository (for example package/Tauri configuration and platform packaging configuration)
- `README.md`
- Production/test files only if the independent review confirms an in-scope defect
- No unrelated workflow or process files unless a release-gate defect is proven
