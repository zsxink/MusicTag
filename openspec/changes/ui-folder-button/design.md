# Design

## Domain
frontend

## Scope and constraints

- Move the existing folder selection action from `SongList.vue` to `AppBar.vue`.
- Remove the app-bar current-path label/value and the sidebar duplicate button.
- Preserve native folder picking, the existing `requestFolder` dirty-state guard, list replacement/loading behavior, picker cancellation behavior, error reporting, and the ⌘O/Ctrl+O shortcut.
- Do not change folder store semantics, Tauri commands, persistence, or the native menu action.

## Approach

`AppBar.vue` owns the visible button and its click handler. Reuse the existing `pickFolder()` API, then pass a selected non-null directory to `requestFolder(dir, listSongs)` so unsaved edits continue through the same save/discard/cancel transition. A cancelled picker is a no-op. Catch picker/transition errors and publish the same localized error through `songStore.folderRefreshError`; `SongList.vue` already renders that shared status and its retry control.

Remove the path element from `AppBar.vue`, including its `folderPath` title/value binding. Remove the button and its now-unused click-path imports/handler from `SongList.vue`; keep the shortcut listener there. Update the no-folder empty-state instruction so it points users to the app-bar action, not a button above the list. Keep search, missing-field controls, refresh/error feedback, and list content in the sidebar.

No new state or API is needed. This is a frontend-only relocation using the current IPC and store flow. There is no migration or concurrency change; picker cancellation and `requestFolder` remain the transition boundaries.

## Requirement mapping

| Requirement | Design coverage |
|---|---|
| Open folder from the app bar; retain transition behavior | AppBar invokes `pickFolder`, then `requestFolder(dir, listSongs)`; cancellation is a no-op. |
| Do not display current path in app bar | Remove path element and its path binding from AppBar. |
| Keep sidebar focused on browsing | Remove its folder button; retain search and missing-field controls. |
| Preserve errors and shortcut | Reuse `folderRefreshError` rendered by SongList; leave ⌘O/Ctrl+O listener in SongList. |

## Files and ownership

- `src/components/AppBar.vue`: button, folder picker flow, and removal of path display.
- `src/components/SongList.vue`: remove duplicate button/handler imports; retain shortcut and shared error rendering; adjust empty-state instruction.
- `src/components/appbar.test.ts` and `src/components/songlist.test.ts`: cover new button placement, picker cancellation/selection, dirty-flow delegation, path absence, and retained shortcut/sidebar controls.

## Validation

- Run focused AppBar and SongList component tests, including the existing folder-picker/dirty-transition cases updated for ownership relocation.
- Run `npm run build` for Vue/TypeScript integration.
- Run strict OpenSpec validation for this change.
