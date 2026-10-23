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

## Agent skills

`skills/<name>/SKILL.md` are [Agent Skills](https://agentskills.io) for people who use the package. They ship in
the npm tarball, consumers load them with [TanStack Intent](https://tanstack.com/intent), and each one lists the
files it was written from in its `sources` frontmatter.

- When you change a file that a skill lists in `sources`, `bun run skills:check` fails. Read each listed skill
  against your change and update it if it no longer matches, then run `bun run skills:stamp`. It records the
  review in `skills/sync-state.json`. Don't stamp without reading the skills.
- Code examples in skills are typechecked against `src/` by `intent validate`. Keep each fence a complete,
  runnable example, and mark deliberate mistakes with `ts expect-error=TS<code>`.
- Don't edit `metadata.library_version`. The release workflow sets it to the new version
  (`bun scripts/skills.ts version` after `changeset version`).
- Skills are package contents, so a change to a `SKILL.md` needs a changeset.
