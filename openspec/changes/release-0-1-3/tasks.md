# Tasks: v0.1.3 release review

## Review and implementation

- [x] 1. Inventory version declarations, release badge/notes, applicable CI and tag-triggered workflow; record baseline and relevant merged commits for PRs #143, #151, #153.
- [x] 2. Conduct independent read-only CR of #143 embedded-cover export against PRD/design; record paths, scenarios, findings and evidence.
- [x] 3. Conduct independent read-only CR of #151 folder auto-refresh against PRD/design; include stale watcher events, coalescing, failed list reads, and editor-state preservation.
- [x] 4. Conduct independent read-only CR of #153 source availability/localization; include successful-empty versus all-network-failed semantics and user-facing language behavior.
- [x] 5. For confirmed in-spec defects only, implement bounded fixes and targeted regression tests; retain explicit task/file ownership and do not change product scope.
- [x] 6. Run independent read-only follow-up CR over each fix; resolve findings within the approved spec or stop for parent decision.
- [x] 7. Update all discovered release version metadata and README badge to `0.1.3`; add concise release notes for the three user-visible feature groups since v0.1.2.

## Validation and release

- [x] 8. Run focused regression checks for changed behavior; if no defects were found, preserve CR evidence and run/cite relevant existing tests.
- [ ] 9. Run strict OpenSpec validation for this change and all applicable CI-equivalent checks from the current workflow; verify all version declarations and README badge agree.
- [ ] 10. After merge and required CI success, tag `v0.1.3` using the existing tag-triggered release workflow, create the draft Release, and verify build artifacts/workflow conclusion and release notes.

## Acceptance evidence

- CR report covers #143, #151, #153 with findings or explicit no-blocker/major conclusions.
- Every accepted defect has a targeted regression check and independent follow-up review.
- Version metadata and README badge read `0.1.3`; README notes summarize only user-visible changes since v0.1.2.
- Strict OpenSpec validation and every applicable required CI job pass on the final source snapshot.
- `v0.1.3` draft Release and tag-triggered build are verified after merge; no release success is claimed before remote evidence is available.
