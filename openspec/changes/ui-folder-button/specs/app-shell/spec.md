# App shell folder entry

## MODIFIED Requirements

### Requirement: Open folder from the app bar
The application SHALL expose a single “打开文件夹” action in the global app bar. Activating it SHALL use the existing native folder picker, route the selected directory through the existing unsaved-change guard, and load the selected folder's songs. Cancelling the picker SHALL leave the current folder unchanged.

#### Scenario: Choose a folder
- **WHEN** the user activates the app-bar folder button and chooses a directory
- **THEN** the app loads that directory through the existing folder transition flow

#### Scenario: Cancel folder selection
- **WHEN** the user cancels the native folder picker
- **THEN** the current directory and song list remain unchanged

### Requirement: Do not display the current path in the app bar
The application SHALL NOT display the current folder path in the global app bar.

#### Scenario: Folder is open
- **WHEN** a folder is currently loaded
- **THEN** the app bar shows the folder-open action without a path label or path value

### Requirement: Keep the sidebar focused on browsing
The sidebar SHALL NOT contain a duplicate folder-open button; its search and missing-field controls remain available.

#### Scenario: Browse songs
- **WHEN** the user views the sidebar
- **THEN** search and missing-field controls remain available without a folder-open button
