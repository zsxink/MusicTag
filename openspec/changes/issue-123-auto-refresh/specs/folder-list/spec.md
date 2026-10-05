# folder-list Specification

## ADDED Requirements

### Requirement: Automatically refresh a watched folder
The application MUST automatically refresh the visible audio file list when audio files are added, removed, or renamed in the currently opened folder or its descendants, without requiring the user to switch folders or restart the application.

#### Scenario: New audio file appears in the current folder
- **WHEN** an audio file is added to the currently opened folder
- **THEN** the file appears in the visible list automatically

#### Scenario: Audio file changes in a descendant folder
- **WHEN** an audio file is added, removed, or renamed in a descendant folder of the currently opened folder
- **THEN** the visible list is refreshed to reflect the current contents

#### Scenario: Open folder changes
- **WHEN** the user opens a different folder
- **THEN** automatic refresh follows the newly opened folder and no longer refreshes from the previous folder

#### Scenario: Manual refresh
- **WHEN** the user invokes the existing manual refresh action
- **THEN** the application rereads the current folder and updates the visible list
