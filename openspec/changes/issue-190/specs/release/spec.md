## MODIFIED Requirements
### Requirement: Release version metadata is consistent
The application package metadata and README version badge MUST identify the release as `0.2.2`.

#### Scenario: Inspect release version
- **WHEN** a maintainer inspects the Tauri, Cargo, npm, and README version declarations for this release
- **THEN** each declaration reports `0.2.2`

### Requirement: Release notes summarize user-visible changes
The README MUST summarize user-visible changes introduced since v0.2.1 without claiming capabilities beyond the shipped behavior.

#### Scenario: Read v0.2.2 release notes
- **WHEN** a user reads the v0.2.2 release notes
- **THEN** they can identify that saving a song or overwriting an existing `.lrc` preserves the file's original permission bits, with wording consistent with the shipped application

### Requirement: Release build is verified after merge
The v0.2.2 tag MUST use the existing tag-triggered workflow and produce a successful public Release after the change is merged and required CI passes. The publish job MUST explicitly provide GitHub CLI with the repository context because it runs without a local checkout.

#### Scenario: Publish job resolves repository without checkout
- **WHEN** the publish job runs on its fresh runner after all platform builds succeed
- **THEN** its `gh release` and `gh workflow` commands target the repository identified by the workflow context without relying on a local Git remote

#### Scenario: Verify tag-triggered release
- **WHEN** the merged v0.2.2 commit is tagged and the release workflow completes
- **THEN** the public Release is published, contains Windows, macOS arm64, macOS x64, and Linux build assets, and the triggered Homebrew tap synchronization succeeds
