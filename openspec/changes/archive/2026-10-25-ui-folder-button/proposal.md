# UI folder button

GitHub Issue: #182

Move the folder picker entry point into the global app bar and remove the current folder path display. Keep folder selection, dirty-state interception, keyboard shortcut, and song loading behavior unchanged.

## Why
The current absolute path consumes prominent header space while the folder action is confined to the sidebar. The app bar should expose the primary folder action directly.

## What Changes
- Place one compact folder-icon button in the global app bar with “打开文件夹” accessible name and hover title.
- Remove the path label/value from the app bar.
- Remove the duplicate button from the sidebar.
- Preserve folder picking, unsaved-change handling, and error feedback.
