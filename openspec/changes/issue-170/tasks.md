## 1. Product documentation and contracts

- [ ] 1.1 Synchronize `docs/V1-PRD.md` with Issue #170 menu, weekly automatic update check, and notification acceptance criteria
- [ ] 1.2 Synchronize `docs/design/design.md` with menu action event, menu enablement contract, successful-check timestamp persistence, and update notification lifecycle
- [ ] 1.3 Verify existing config read/write boundary and settle timestamp persistence through the existing Rust/config facade without adding component-level file IO

## 2. Native application menus

- [ ] 2.1 Implement File, Edit, View, and Help menus on Windows and Linux while preserving the macOS application menu
- [ ] 2.2 Emit stable `app-menu-action` events and route actions through the existing frontend API event boundary
- [ ] 2.3 Dispatch menu actions to existing folder, save, rescan, theme, update, About, reload, window-close, and quit capabilities
- [ ] 2.4 Synchronize enabled/visible state for save, About/EULA, and development-only developer tools; guard stale actions at dispatch
- [ ] 2.5 Add focused Rust and frontend tests for menu construction, action mapping, platform differences, and state-dependent availability

## 3. Update check cadence and notifications

- [ ] 3.1 Persist and load the last successful update check timestamp through the established config boundary
- [ ] 3.2 Gate startup checks to first run or at least seven days since last success; leave failed attempts eligible for retry and keep manual checks unrestricted
- [ ] 3.3 Keep update availability independent of toast visibility and expose an accessible AppBar marker between brand and path that reopens the update prompt
- [ ] 3.4 Apply 15-second update and 5-second up-to-date auto-dismiss timers; keep errors manually dismissible and preserve per-version “Later” memory
- [ ] 3.5 Add focused tests for cadence boundaries, persistence, failures, manual override, timer cleanup, reopen behavior, and “Later” state

## 4. Validation

- [ ] 4.1 Run applicable Rust and frontend focused tests, full `cargo test`, `npm run test`, and `npm run build`
- [ ] 4.2 Validate all OpenSpec changes strictly and verify menu/update behavior against the Issue #170 acceptance criteria
