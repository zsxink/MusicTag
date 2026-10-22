# Homebrew publisher tests

Run with Node 24 from the repository root:

```sh
node --test tests/homebrew/publish.test.mjs
bash -n scripts/homebrew-publish.sh
```

The tests run the actual publisher with fake `gh`, `curl`, `git`, and `sleep`
commands. All release bytes, release metadata, tap checkouts, remote state, and
command logs live in per-test temporary directories and are removed afterward.
The fakes reject unknown commands and never delegate to the real tools. No
GitHub credentials, live network, or actual Git repositories are used. The
remaining local requirements match the publisher: Bash, Python 3, Ruby, and
`sha256sum` or `shasum`.

Coverage includes both architecture URLs and downloaded-byte hashes, optional
API digests, invalid tags, draft/prerelease rejection, missing/empty assets,
digest and size mismatches, public URL failures, missing credentials, isolated
tap changes, identical reruns, downgrade rejection, and a rejected push followed
by a retry that preserves another Cask's concurrent update.

These checks cover the publisher contract. Real Homebrew DSL/style, real DMG
fetch/install, workflow dispatch, and GitHub permission/branch rules need
separate integration validation. The Vue Vitest configuration intentionally
collects only `src/**/*.test.ts`; this Node suite is run with the command above.
