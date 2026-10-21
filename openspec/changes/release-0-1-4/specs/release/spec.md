# Release Specification

## Purpose
Define the version metadata, release notes, and verification requirements for the v0.1.4 release.

## ADDED Requirements
### Requirement: Release version metadata is consistent
The application package metadata and README version badge MUST identify the release as `0.1.4`.

#### Scenario: Inspect release version
- **WHEN** a maintainer inspects the Tauri, Cargo, npm, and README version declarations for this release
- **THEN** each declaration reports `0.1.4`

### Requirement: Release notes summarize user-visible changes
The README MUST summarize user-visible changes introduced since v0.1.3 without claiming automatic update installation.

#### Scenario: Read v0.1.4 release notes
- **WHEN** a user reads the v0.1.4 release notes
- **THEN** they can identify the new stable-release update check and its manual release-page flow

### Requirement: Release build is verified after merge
The v0.1.4 tag MUST use the existing tag-triggered workflow and produce a successful draft release build after the change is merged and required CI passes.

#### Scenario: Verify tag-triggered release
- **WHEN** the merged v0.1.4 commit is tagged and the release workflow completes
- **THEN** the draft Release and its platform build results are verified as successful
