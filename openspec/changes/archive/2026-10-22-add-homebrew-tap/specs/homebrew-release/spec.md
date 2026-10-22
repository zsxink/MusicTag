## ADDED Requirements

### Requirement: Install MusicTag through the owner tap
The project SHALL provide a Homebrew Cask named `musictag` in the public `zsxink/homebrew-tap` repository. The Cask SHALL install the MusicTag app from the matching public GitHub Release DMG, use the correct artifact for Apple Silicon and Intel Macs, and verify the artifact with its SHA-256 checksum.

#### Scenario: Install on Apple Silicon
- **WHEN** a user installs `zsxink/tap/musictag` on an Apple Silicon Mac
- **THEN** Homebrew downloads the matching arm64 DMG from the published MusicTag release
- **AND** validates it against the arm64 SHA-256 checksum before installing `MusicTag.app`

#### Scenario: Install on Intel
- **WHEN** a user installs `zsxink/tap/musictag` on an Intel Mac
- **THEN** Homebrew downloads the matching x64 DMG from the published MusicTag release
- **AND** validates it against the x64 SHA-256 checksum before installing `MusicTag.app`

### Requirement: Synchronize the Cask after a release is published
The release automation SHALL update the tap only after the GitHub Release is published, and SHALL update the Cask version, architecture-specific artifact URLs, and checksums from that release. It SHALL NOT publish an entry pointing to a draft or unavailable release.

#### Scenario: Draft release
- **WHEN** the release workflow creates a draft GitHub Release
- **THEN** tap synchronization does not run for that draft

#### Scenario: Published release
- **WHEN** a MusicTag release is published and contains both supported macOS DMG assets
- **THEN** automation computes the SHA-256 of each asset
- **AND** commits the matching version, URLs, and checksums to the tap repository

#### Scenario: Missing cross-repository credential
- **WHEN** the tap write credential is missing or lacks permission
- **THEN** synchronization reports a clear failure without exposing credential contents
- **AND** the already published MusicTag release remains available

### Requirement: Document Homebrew usage
The MusicTag README SHALL document the tap install command, upgrade command, and tap repository link.

#### Scenario: User follows README instructions
- **WHEN** a user follows the README Homebrew instructions
- **THEN** they can install MusicTag without signing in to GitHub
- **AND** use Homebrew to upgrade it after the tap is updated
