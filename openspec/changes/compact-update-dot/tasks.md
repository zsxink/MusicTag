# Tasks: Compact top-bar update indicator

## Spec gate

- [x] 1. Main agent verifies Issue #188, `compact-update-dot` branch/worktree and approved proposal/spec; records the current HEAD and baseline state of `AppBar.vue`, component tests, version metadata, README, and CI/release workflows.
- [x] 2. After Architect delivery, main agent runs the spec-gate preflight and `npx --yes @fission-ai/openspec@1.5.0 validate compact-update-dot --strict --no-interactive`; proceed only after success.

## Dev and Tester

- [x] 3. Dev makes the minimal scoped change in `src/components/AppBar.vue`: render a small red CSS dot instead of the 28px red circle and bullet glyph. Preserve `hasAvailableUpdate()` gating, placement, button accessibility name, title, click action, usable hit area, and focus feedback. Do not alter update state or behavior.
- [x] 4. Dev extends `src/components/appbar.test.ts` to cover the eligible/restorable update case (indicator adjacent to brand, accessible name/title preserved, no text glyph, click restores notice) and the no-available-update case (indicator absent). Keep assertions focused; no new harness or fixture.
- [x] 5. Dev updates application-owned versions to `0.2.1` in `package.json`, `package-lock.json` root entries, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`'s `music-tag` package, and `src-tauri/tauri.conf.json`; update README badge and add a concise v0.2.1 note. Do not edit historical notes or dependency versions.
- [ ] 6. Main agent audits Dev's diff against authorized paths and records the Dev checkpoint. Tester runs the focused `src/components/appbar.test.ts`, reviews the rendered CSS diff for a small red dot with no large red surface and retained focus affordance, checks version consistency/README accuracy, and runs `npm run build` plus `npm run test`. Record commands, exit codes, and HEAD. No fixture applies.

## Independent CR and Verify

- [ ] 7. Independent read-only CR reviews the final diff against both spec scenarios. Confirm the change is presentation-only, keeps the condition/name/title/restore click/placement, removes visible glyph and large circle, preserves hit area/focus affordance, and does not alter update checks, prompting, timers, or persistence. Record snapshot, files, evidence, and explicit blocker/major result.
- [ ] 8. Verify runs the current change strict validation and all applicable CI checks from `.github/workflows/ci.yml`, including `validate --all --strict --no-interactive`, pipe native suites, Homebrew publisher test, pipe self-check, `npm ci`, build/test, and Rust stable `cargo check --all-targets`/`cargo test --all-targets` with workflow system dependencies. Run the focused component test explicitly as well. Record each command, exit code, Node/Rust/system setup, and exact HEAD; stop on failure.
- [ ] 9. Main agent saves the source manifest and command evidence for the verified snapshot and confirms the evidence matches current HEAD. Any post-CR source change invalidates affected verification and requires re-review as applicable.

## Integrate and v0.2.1 release

- [ ] 10. Main agent performs pipe integration in order: `archive → commit → sync-main → push → get-or-create-pr → wait-required-ci → merge → verify-remote → cleanup-local`. PR references Issue #188 with `Closes #188`; require successful CI before merge and bind checkpoints to the Verify source fingerprint.
- [ ] 11. After merge and required CI success, verify the merged version commit is on remote main. Create/push `v0.2.1` only if it does not already exist; if present, verify its target SHA. Never overwrite or force-push an existing tag.
- [ ] 12. Verify the `v0.2.1` release workflow completes successfully and the public Release points to the merged version commit, is published (not draft or prerelease), and contains the expected platform assets. Record run/Release URLs, tag SHA, and asset names. Do not report release success from a tag alone or a queued workflow.

## Completion evidence

- Both spec scenarios pass through component tests; visual CSS review confirms a compact red dot without a large red surface.
- Update eligibility, notice restoration, accessibility name/title, and all update-check/persistence behavior remain unchanged.
- Application version declarations and README identify v0.2.1 without third-party dependency changes.
- Independent CR, strict OpenSpec validation, and all applicable CI checks have evidence tied to the final Verify HEAD.
- The merged v0.2.1 commit has a successful release workflow and a verified public Release with platform assets; absent remote evidence, release remains incomplete.
