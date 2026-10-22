## Why

MusicTag currently publishes macOS DMG files as GitHub Release assets, but users do not have a Homebrew installation path. The owner has an existing public `zsxink/homebrew-tap` repository used for another app, so the MusicTag Cask can be maintained there without depending on official Homebrew review.

## What Changes

- Add a `musictag` Homebrew Cask to the existing `zsxink/homebrew-tap` repository.
- Automate Cask updates after a MusicTag GitHub Release is published, using the arm64 and Intel DMG assets and their SHA-256 checksums.
- Document installation and upgrade commands in MusicTag README.

## Capabilities

### New Capabilities
- `homebrew-release`: Install and upgrade MusicTag for macOS through the owner's Homebrew tap, with the published release and tap Cask kept in sync.

### Modified Capabilities
- `ci-release`: Extend the existing GitHub Release process with a post-publication tap synchronization step.

## Impact

- MusicTag release workflow and README.
- The external repository `zsxink/homebrew-tap` receives `Casks/m/musictag.rb` updates through a narrowly scoped Actions secret.
- No application runtime behavior changes. Users do not need a GitHub account to install from the public tap.
- The existing release is created as a draft; tap synchronization must happen only once it is published.
