#!/usr/bin/env bash
# Render locally, or publish only Casks/m/musictag.rb in an explicit tap checkout.
set -euo pipefail
# Never allow inherited shell tracing to expose credentials passed to gh.
set +x

fail() { printf 'homebrew-publish: %s\n' "$*" >&2; exit 1; }
usage() {
  printf 'Usage: %s <vMAJOR.MINOR.PATCH> --output <file>\n       %s <vMAJOR.MINOR.PATCH> --publish --tap-dir <checkout>\n' "$0" "$0" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
tag=$1
shift
[[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail 'Expected a stable vMAJOR.MINOR.PATCH tag.'
version=${tag#v}
output=''
tap_dir=''
publish=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) [[ $# -ge 2 && -z "$output" ]] || usage; output=$2; shift 2 ;;
    --publish) [[ "$publish" == false ]] || usage; publish=true; shift ;;
    --tap-dir) [[ $# -ge 2 && -z "$tap_dir" ]] || usage; tap_dir=$2; shift 2 ;;
    *) usage ;;
  esac
done
if [[ "$publish" == true ]]; then
  [[ -z "$output" && -n "$tap_dir" ]] || usage
  [[ -n "${HOMEBREW_TAP_TOKEN:-}" ]] || fail 'HOMEBREW_TAP_TOKEN is required (Contents: read and write for zsxink/homebrew-tap only).'
else
  [[ -n "$output" && -z "$tap_dir" ]] || usage
fi
for executable in gh curl python3 ruby; do
  command -v "$executable" >/dev/null || fail "Required command missing: $executable"
done
if command -v sha256sum >/dev/null; then
  hash_file() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null; then
  hash_file() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  fail 'sha256sum or shasum is required.'
fi

source_repo=zsxink/MusicTag
cask_path=Casks/m/musictag.rb
temp_dir=$(mktemp -d)
publish_tree=''
cleanup() {
  if [[ -n "$publish_tree" ]]; then
    git -C "$tap_dir" worktree remove --force "$publish_tree" >/dev/null 2>&1 || true
  fi
  rm -rf "$temp_dir"
}
trap cleanup EXIT

# Prefer the source repository's read-only token. Local rendering can use gh auth.
source_gh() {
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    GH_TOKEN=$GITHUB_TOKEN gh "$@"
  else
    gh "$@"
  fi
}
retry() {
  local attempt
  for attempt in 1 2 3; do
    if "$@"; then return 0; fi
    [[ "$attempt" -eq 3 ]] || sleep "$((attempt * 2))"
  done
  return 1
}

retry source_gh release view "$tag" --repo "$source_repo" \
  --json tagName,isDraft,isPrerelease,assets > "$temp_dir/release.json" \
  || fail 'Cannot read current release metadata.'
python3 - "$temp_dir/release.json" "$tag" "$version" > "$temp_dir/assets.tsv" <<'PY'
import json
import sys

metadata_path, tag, version = sys.argv[1:]
with open(metadata_path, encoding="utf-8") as source:
    release = json.load(source)
if (release.get("tagName") != tag or release.get("isDraft") is not False
        or release.get("isPrerelease") is not False):
    sys.exit("Release must be a published, stable release matching the requested tag.")
for arch in ("aarch64", "x64"):
    name = f"MusicTag_{version}_{arch}.dmg"
    matches = [asset for asset in release.get("assets", []) if asset.get("name") == name]
    if len(matches) != 1:
        sys.exit(f"Expected exactly one release asset: {name}")
    asset = matches[0]
    expected_url = f"https://github.com/zsxink/MusicTag/releases/download/{tag}/{name}"
    size = asset.get("size")
    if (asset.get("url") != expected_url or type(size) is not int or size <= 0
            or asset.get("state") != "uploaded"):
        sys.exit(f"Asset URL, upload state or size is invalid: {name}")
    digest = asset.get("digest") or "-"
    if digest != "-":
        import re
        if not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            sys.exit(f"Unsupported asset digest: {name}")
    print(name, expected_url, size, digest, sep="\t")
PY

mkdir "$temp_dir/downloads"
hashes=()
while IFS=$'\t' read -r asset_name public_url expected_size api_digest; do
  # -q ignores curlrc; no Authorization header, cookies or netrc credentials are used.
  curl -q --fail --silent --show-error --head --location \
    --proto '=https' --proto-redir '=https' --max-redirs 5 \
    --connect-timeout 15 --max-time 60 --retry 3 --retry-delay 2 --retry-all-errors \
    --netrc-file /dev/null "$public_url" > /dev/null \
    || fail "Release asset is not publicly reachable: $asset_name"
  retry source_gh release download "$tag" --repo "$source_repo" \
    --pattern "$asset_name" --dir "$temp_dir/downloads" --clobber \
    || fail "Cannot download release asset: $asset_name"
  asset_file=$temp_dir/downloads/$asset_name
  [[ -s "$asset_file" && -f "$asset_file" && ! -L "$asset_file" ]] || fail "Empty or invalid downloaded asset: $asset_name"
  actual_size=$(wc -c < "$asset_file" | tr -d '[:space:]')
  [[ "$actual_size" == "$expected_size" ]] || fail "Downloaded asset size mismatch: $asset_name"
  checksum=$(hash_file "$asset_file")
  [[ "$checksum" =~ ^[0-9a-f]{64}$ ]] || fail "Invalid SHA-256: $asset_name"
  [[ "$api_digest" == '-' || "$api_digest" == "sha256:$checksum" ]] || fail "Downloaded asset digest mismatch: $asset_name"
  hashes+=("$checksum")
  printf '%s  %s\n' "$checksum" "$public_url"
done < "$temp_dir/assets.tsv"
[[ ${#hashes[@]} -eq 2 ]] || fail 'Both architecture hashes are required.'

cat > "$temp_dir/musictag.rb" <<EOF_CASK
# frozen_string_literal: true

cask "musictag" do
  arch arm: "aarch64", intel: "x64"

  version "$version"
  sha256 arm:   "${hashes[0]}",
         intel: "${hashes[1]}"

  url "https://github.com/zsxink/MusicTag/releases/download/v#{version}/MusicTag_#{version}_#{arch}.dmg"
  name "MusicTag"
  desc "Edit metadata, cover art and lyrics for local music files"
  homepage "https://github.com/zsxink/MusicTag"

  livecheck do
    url "https://github.com/zsxink/MusicTag/releases/latest"
    strategy :github_latest
  end

  app "MusicTag.app"

  uninstall quit: "com.musictag.desktop"

  zap trash: [
    "~/Library/Application Support/MusicTag",
    "~/Library/Caches/com.musictag.desktop",
    "~/Library/WebKit/com.musictag.desktop",
  ]
end
EOF_CASK
ruby -c "$temp_dir/musictag.rb"

if [[ "$publish" == false ]]; then
  [[ ! -L "$output" ]] || fail 'Output must not be a symbolic link.'
  mkdir -p "$(dirname "$output")"
  cp "$temp_dir/musictag.rb" "$output"
  printf 'Rendered %s for %s (local mode; no tap Git operations).\n' "$output" "$tag"
  exit 0
fi

command -v git >/dev/null || fail 'Required command missing: git'
[[ -d "$tap_dir" ]] || fail 'Target tap checkout does not exist.'
tap_dir=$(cd "$tap_dir" && pwd -P)
[[ "$(git -C "$tap_dir" rev-parse --show-toplevel)" == "$tap_dir" ]] || fail 'Target must be the tap repository root.'
[[ "$(git -C "$tap_dir" symbolic-ref --quiet --short HEAD)" == main ]] || fail 'Target tap checkout must be on main.'
[[ -z "$(git -C "$tap_dir" status --porcelain --untracked-files=all)" ]] || fail 'Target tap checkout must be clean.'
# Never print invalid remotes: a caller may have put a credential in the URL.
check_remote() {
  case "$1" in
    https://github.com/zsxink/homebrew-tap|https://github.com/zsxink/homebrew-tap.git|git@github.com:zsxink/homebrew-tap.git|ssh://git@github.com/zsxink/homebrew-tap.git) ;;
    *) fail 'Target origin must point directly to zsxink/homebrew-tap without embedded credentials.' ;;
  esac
}
# Reject multiple push destinations as well as credential-bearing or unrelated URLs.
check_remote "$(git -C "$tap_dir" remote get-url --all origin)"
check_remote "$(git -C "$tap_dir" remote get-url --push --all origin)"

for attempt in 1 2 3; do
  # A detached temporary worktree preserves the caller's branch, index and files.
  git -C "$tap_dir" fetch --no-tags origin refs/heads/main:refs/remotes/origin/main \
    || fail 'Cannot refresh tap main (check credential permissions).'
  publish_tree=$temp_dir/tap-worktree
  git -c core.hooksPath=/dev/null -C "$tap_dir" worktree add --detach "$publish_tree" refs/remotes/origin/main
  [[ ! -L "$publish_tree/Casks" && ! -L "$publish_tree/Casks/m" && ! -L "$publish_tree/$cask_path" ]] \
    || fail 'Cask path must not contain symbolic links.'
  python3 - "$publish_tree/$cask_path" "$version" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
if path.exists():
    versions = re.findall(r'^\s*version "([^"\n]+)"\s*$', path.read_text(encoding="utf-8"), re.M)
    stable = r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
    if len(versions) != 1 or not re.fullmatch(stable, versions[0]):
        sys.exit("Existing MusicTag Cask has an unrecognized version; refusing to overwrite it.")
    if tuple(map(int, versions[0].split("."))) > tuple(map(int, sys.argv[2].split("."))):
        sys.exit("Refusing to downgrade the MusicTag Cask.")
PY
  mkdir -p "$publish_tree/Casks/m"
  cp "$temp_dir/musictag.rb" "$publish_tree/$cask_path"
  if git -C "$publish_tree" diff --quiet -- "$cask_path" && git -C "$publish_tree" ls-files --error-unmatch "$cask_path" >/dev/null 2>&1; then
    printf 'Tap already contains MusicTag %s; no commit needed.\n' "$version"
    exit 0
  fi
  git -c core.hooksPath=/dev/null -C "$publish_tree" add -- "$cask_path"
  [[ "$(git -C "$publish_tree" diff --cached --name-only)" == "$cask_path" ]] || fail 'Refusing to commit paths outside the MusicTag Cask.'
  git -c core.hooksPath=/dev/null -c commit.gpgsign=false \
    -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    -C "$publish_tree" commit -m "chore: update MusicTag to $version" -- "$cask_path"
  if git -c core.hooksPath=/dev/null -C "$publish_tree" push origin HEAD:refs/heads/main; then
    printf 'Published MusicTag %s to zsxink/homebrew-tap.\n' "$version"
    exit 0
  fi
  git -C "$tap_dir" worktree remove "$publish_tree"
  publish_tree=''
  [[ "$attempt" -eq 3 ]] || sleep "$((attempt * 2))"
done
fail 'Tap push failed after 3 attempts; check permissions, branch rules or network, then retry the same tag.'
