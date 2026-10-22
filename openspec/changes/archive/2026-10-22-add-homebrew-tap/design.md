## Context

Issue #168 adds a macOS distribution channel through `zsxink/homebrew-tap`. This change is in the **infra** domain, with README documentation. It does not change Rust, Vue, Tauri commands, or application update behavior, so the runtime PRD/design contracts do not need amendments.

Current implementation and external facts checked on 2026-10-22:

- `.github/workflows/release.yml` builds on `v*` tag pushes, runs the existing test job, and builds Apple Silicon and Intel targets in the Tauri matrix. `tauri-action` creates a draft (`releaseDraft: true`) with the repository `GITHUB_TOKEN`.
- `src-tauri/tauri.conf.json` sets `productName: MusicTag` and uses ad hoc macOS signing. No Apple notarization is configured.
- The published `v0.1.4` release contains `MusicTag_0.1.4_aarch64.dmg` and `MusicTag_0.1.4_x64.dmg`. The Intel suffix is **x64**, even though the Rust target is `x86_64-apple-darwin`.
- `zsxink/homebrew-tap` is public and its default branch is `main`; its existing MarkFlow entry uses `Casks/m/markflow.rb`.
- MarkFlow uses `scripts/homebrew-publish.sh <tag>` and `HOMEBREW_TAP_TOKEN`. Its script downloads through `gh release download`, computes SHA-256, generates a Cask and pushes the tap. MusicTag can follow these naming and data-flow conventions, while enforcing public availability and both supported architectures.

## Goals / Non-Goals

**Goals:** provide the `musictag` Cask, synchronize it after publication, keep both architecture URLs and checksums consistent, document installation/upgrades, and make failures and safe retries explicit.

**Non-Goals:** official Homebrew Cask submission, changes to application update installation, Apple signing/notarization, Linux/Windows Homebrew packages, or changes to the existing tag build and draft publication process.

## Decisions

### D1. Separate publication synchronization from DMG building

Add `.github/workflows/homebrew.yml` with `release: { types: [published] }` and a `workflow_dispatch` tag input for first setup and retry. Preserve the existing `release.yml` build trigger and draft behavior. A completed draft build does not update the tap.

The `published` event covers publishing an existing draft. The job only processes a stable public release: it checks `draft == false`, `prerelease == false`, and a supported stable `vMAJOR.MINOR.PATCH` tag before any tap mutation. Read current release metadata by tag at execution time, rather than trusting only the original event payload. A manual run gets the same checks and cannot publish a draft to the tap.

GitHub suppresses new workflow runs for release events caused by `GITHUB_TOKEN`. Therefore the current intended path is a maintainer publishing the completed draft in GitHub UI or with their own credential. If publication is later automated with `GITHUB_TOKEN`, that publisher must explicitly dispatch this workflow, or use an appropriately authorized GitHub App/PAT. This change does not add another source-repository write credential.

The workflow and script must be merged before a new release tag is cut. Existing `v0.1.4` cannot retroactively generate a publication event for newly added workflow code; use the manual dispatch against the default branch for bootstrap. The source checkout uses trusted MusicTag default-branch code, and the input tag is passed through an environment variable to a quoted script argument. Set source checkout `persist-credentials: false` and job `permissions: contents: read`.

### D2. Download and validate the two public DMGs before preparing a tap change

Add `scripts/homebrew-publish.sh <tag>` as the single release-to-Cask entry point. Give it an explicit local tap checkout/output mode so generation and validation can run without pushing. Keep release lookup/download separate from the final commit/push operation so negative tests cannot mutate the tap.

For a version such as `0.1.4`, require these exact nonempty release assets:

| Cask architecture | Rust build target | Release asset |
| --- | --- | --- |
| `arm` | `aarch64-apple-darwin` | `MusicTag_0.1.4_aarch64.dmg` |
| `intel` | `x86_64-apple-darwin` | `MusicTag_0.1.4_x64.dmg` |

Use `gh release view/download --repo zsxink/MusicTag` with the source read token, following the established MarkFlow tool choice. Also verify each canonical public `browser_download_url` is reachable without credentials: a successful authenticated draft download alone is insufficient evidence for Homebrew users. Allow bounded network retry for publication propagation. Validate asset names and URLs against the fixed source repository and expected tag rather than interpolating arbitrary release data into Ruby or shell code.

Compute each SHA-256 from the actual downloaded bytes (`sha256sum` on Linux, or `shasum -a 256` when run on macOS), require 64 lowercase hexadecimal characters, and use the API digest as an optional consistency check rather than the sole hash source. If either asset is absent, empty, unreachable, or cannot be hashed, fail before writing or pushing a Cask. Do not fall back to a single architecture or `sha256 :no_check`.

### D3. Generate one declarative Cask in the existing tap structure

Generate `Casks/m/musictag.rb` with this shape (hash placeholders below are design notation; generated output must contain real hashes):

```ruby
cask "musictag" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.4"
  sha256 arm:   "<arm SHA-256>",
         intel: "<Intel SHA-256>"

  url "https://github.com/zsxink/MusicTag/releases/download/v#{version}/MusicTag_#{version}_#{arch}.dmg"
  name "MusicTag"
  desc "Edit metadata, cover art and lyrics for local music files"
  homepage "https://github.com/zsxink/MusicTag"

  app "MusicTag.app"
end
```

`arch` and architecture-keyed `sha256` follow Homebrew's documented DSL. Do not copy MarkFlow's `auto_updates true`: MusicTag checks for updates and opens release pages but does not install updates. Do not add uninstall/zap hooks that remove user settings. Validate generated Ruby syntax before preparing the commit. Homebrew DSL checks and download/install validation supplement Ruby syntax checks.

### D4. Restrict cross-repository credentials and tap writes

Use the repository Actions Secret `HOMEBREW_TAP_TOKEN`, matching MarkFlow's convention. The preferred credential is a fine-grained PAT selecting only `zsxink/homebrew-tap`, with repository **Contents: read and write** and GitHub's mandatory Metadata read access. A GitHub App installation token with the same repository/permission boundary is equivalent if already available. Source release reads use MusicTag's read-only `GITHUB_TOKEN`; the tap credential does not need write permission to MusicTag or workflow administration.

Check for the secret in a step before target checkout, printing the secret name and required repository permission on failure without printing its value. Do not silently skip the job. Check out the public tap into a temporary/dedicated directory using `actions/checkout` with `repository: zsxink/homebrew-tap`, `ref: main`, and the tap token. Use checkout's managed local credentials and cleanup, or an equivalent temporary credential helper; never embed the token in a clone URL, generated file, commit, or printed command.

The sync only stages `Casks/m/musictag.rb`. A byte-identical re-run succeeds without an empty commit. Reject an older version than the existing Cask so delayed events or manual retries cannot downgrade the tap. Serialize MusicTag sync jobs with a fixed concurrency group and `cancel-in-progress: false`. An external MarkFlow update may race with MusicTag: use normal fast-forward push and, if rejected, refresh/reapply only MusicTag's generated file with a bounded retry; never force-push or overwrite another app's changes.

Credential failure, branch-protection rejection, network failure, or conflict makes synchronization visibly fail. It does not edit, delete, unpublish or rebuild the already published MusicTag Release. A maintainer can correct the prerequisite and re-run/dispatch the same tag.

### D5. Bootstrap the external Cask through a reviewed handoff

The MusicTag repository owns the generator/workflow/docs; the initial live Cask belongs to a different repository. Dev produces a deterministic `musictag.rb` from the current public stable release and its downloaded checksums as review evidence. A local rendered artifact can be retained under the run's validation evidence path, not as a second authoritative Cask in MusicTag.

The Leader must explicitly authorize the external checkout and write paths before a worker edits the tap. Workers cannot commit/push. The Leader audits the external diff and performs the external Git/PR action using the repository's required policy. If external write access or the Actions Secret is unavailable, record that fact and retain the generated artifact and precise bootstrap command; do not mark external installation or automatic synchronization verified.

### D6. Documentation and validation

README gets a macOS Homebrew section with the tap link, `brew install zsxink/tap/musictag`, and `brew update && brew upgrade --cask musictag`. State that the public tap needs no GitHub sign-in and that versions become available after the public release and tap sync. Include concise maintainer setup/retry instructions near release documentation: secret permission boundary, manual publication requirement, expected asset names, failure behavior, and dispatch by tag.

Validation is infra-specific: validate OpenSpec; check shell syntax/lint and workflow event/permissions; exercise the generator/publish boundary with meaningful isolated fixtures for two architectures, missing asset, draft, invalid tag, missing credential, idempotent rerun and older-version rejection. Run `node --test tests/homebrew/publish.test.mjs` in both the pull-request CI and release test jobs; these Node tests are not collected by the frontend Vitest configuration. Confirm the published `v0.1.4` asset URLs and byte hashes. Run `ruby -c`, Homebrew style/DSL checks, and architecture-specific Cask metadata/fetch checks. Perform an actual macOS install into a temporary app directory where available, then remove only the temporary installation. Do not replace an existing `/Applications/MusicTag.app` during validation. An Intel runtime launch requires an Intel environment; report it unverified if unavailable rather than treating metadata/fetch checks as execution proof.

Current ad hoc signing can cause normal macOS Gatekeeper prompts. Homebrew installation does not notarize the app; do not add quarantine bypass hooks or claim notarization as part of this change.

## Maintainer prerequisites and rollout

1. Confirm tap write policy and provide the narrowly scoped `HOMEBREW_TAP_TOKEN` Secret in MusicTag. Code can detect presence/failure but cannot establish its actual configuration from source files.
2. Confirm a normal fast-forward push to tap `main` is allowed for the automation identity; if repository rules require a PR, preserve those rules and implement the approved PR route rather than bypassing them.
3. Merge the workflow/generator/docs, bootstrap the external Cask from a verified public stable release, and run the sync manually for that tag.
4. For future versions, wait until both DMGs are uploaded, publish the draft as a maintainer, and inspect the Homebrew workflow result.

No user-data migration is involved. To roll back a faulty Cask, restore the previous known-good Cask through a normal reviewed tap commit; never rewrite release history. Installation success and live automation remain rollout checks until the credential and external tap update have actually been exercised.

## Traceability and references

- Install requirement (both architecture scenarios): D2, D3, D5, D6.
- Synchronization requirement (draft/published/missing credential scenarios): D1, D2, D4.
- README usage requirement: D6.
- [GitHub release event behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release).
- [GitHub workflow event suppression with GITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).
- [Homebrew Cask architecture DSL](https://docs.brew.sh/Cask-Cookbook#handling-different-system-configurations).
- [Maintaining and installing a tap](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap).
- [MarkFlow publication script reference](https://github.com/zsxink/MarkFlow/blob/main/scripts/homebrew-publish.sh).
