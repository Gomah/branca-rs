# AGENTS.md

## Changesets

Releases are managed with [Changesets](https://github.com/changesets/changesets). Merging to `main` opens a
"chore: release" PR from the pending changesets; merging that PR publishes to npm from
`.github/workflows/release.yml`.

- Add a changeset for every user-facing change: public API, runtime behavior, supported Node.js versions,
  package exports or contents. Skip it for CI, tests, benchmarks, docs and internal refactors.
- Write the file directly as `.changeset/<short-kebab-name>.md`. Don't run `bun changeset`; it is
  interactive and hangs without a TTY.

  ```md
  ---
  "branca-rs": patch
  ---

  One or two sentences for the changelog, written for users of the package.
  ```

- Pick the bump for 0.x: `minor` for breaking changes (start the summary with "Breaking:" and say how to
  migrate), `patch` for everything else, including new features. Never `major` without being asked.
- Don't run `changeset version` or `changeset publish`, and don't edit `CHANGELOG.md` or the `version` in
  `package.json` by hand. The release workflow does all of that.
