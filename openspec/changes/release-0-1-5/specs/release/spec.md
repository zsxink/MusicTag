## ADDED Requirements
### Requirement: Release version metadata is consistent
The application package metadata and README version badge MUST identify the release as `0.1.5`.

#### Scenario: Inspect release version
- **WHEN** a maintainer inspects the Tauri, Cargo, npm, and README version declarations for this release
- **THEN** each declaration reports `0.1.5`

### Requirement: Release notes summarize user-visible changes
The README MUST summarize user-visible changes introduced since v0.1.4 without claiming automatic update installation.

#### Scenario: Read v0.1.5 release notes
- **WHEN** a user reads the v0.1.5 release notes
- **THEN** they can identify the macOS Homebrew installation channel, the native application menu, the update-check throttling, and the pre-release compliance changes

### Requirement: Release build is verified after merge
The v0.1.5 tag MUST use the existing tag-triggered workflow and produce a successful draft release build after the change is merged and required CI passes.

#### Scenario: Verify tag-triggered release
- **WHEN** the merged v0.1.5 commit is tagged and the release workflow completes
- **THEN** the draft Release and its platform build results are verified as successful
