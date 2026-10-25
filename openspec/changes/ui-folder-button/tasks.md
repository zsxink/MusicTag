## Tasks

- [x] 1. Move the folder picker action to `AppBar.vue` and remove the app-bar path display.
  - Own `src/components/AppBar.vue`.
  - Reuse `pickFolder`, `listSongs`, and `requestFolder`; preserve cancellation, dirty-state handling, and `folderRefreshError` feedback.
  - Keep the theme and update controls in their existing positions/behavior.
- [x] 2. Remove the sidebar duplicate and update its component coverage.
  - Own `src/components/SongList.vue` and `src/components/songlist.test.ts`.
  - Remove the sidebar button and its picker handler/imports while retaining search, missing-field controls, shared error/retry feedback, and song browsing; keep ⌘O/Ctrl+O on AppBar.
  - Point the no-folder empty-state instruction to the app-bar button; cover shortcut and sidebar controls.
- [x] 3. Cover the app-bar folder action and validate the frontend change.
  - Own `src/components/appbar.test.ts`.
  - Assert one app-bar folder button, no path display, selected-directory flow through `requestFolder`, and picker cancellation as a no-op.
  - Run focused AppBar/SongList component tests, `npm run build`, and `npx --yes @fission-ai/openspec@1.5.0 validate ui-folder-button --strict --no-interactive`; record actual outcomes in the phase evidence.
