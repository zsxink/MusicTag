## MODIFIED Requirements

### Requirement: Synchronize the Cask after a release is published
The release automation SHALL update the tap only after the GitHub Release is published, and SHALL update the Cask version, architecture-specific artifact URLs, and checksums from that release. The generated Cask SHALL include a `livecheck` block that uses the explicit GitHub latest-releases URL (`https://github.com/zsxink/MusicTag/releases/latest`) with the `github_latest` strategy, so `brew livecheck` can detect when the tap lags behind the latest published release. The generated Cask SHALL NOT declare `auto_updates`. It SHALL NOT publish an entry pointing to a draft or unavailable release.

#### Scenario: Draft release
- **WHEN** the release workflow creates a draft GitHub Release
- **THEN** tap synchronization does not run for that draft

#### Scenario: Published release
- **WHEN** a MusicTag release is published and contains both supported macOS DMG assets
- **THEN** automation computes the SHA-256 of each asset
- **AND** commits the matching version, URLs, and checksums to the tap repository

#### Scenario: Tap lags behind the latest release
- **WHEN** the tap still advertises an older version than the latest published MusicTag release
- **THEN** `brew livecheck musictag` reports the newer version based on the GitHub latest release
- **AND** the Cask does not declare `auto_updates`, so explicitly named `brew upgrade` invocations still apply

#### Scenario: Missing cross-repository credential
- **WHEN** the tap write credential is missing or lacks permission
- **THEN** synchronization reports a clear failure without exposing credential contents
- **AND** the already published MusicTag release remains available
