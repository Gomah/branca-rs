/**
 * Checks and maintains the Agent Skills in skills/, which ship in the npm package (see AGENTS.md):
 *
 *   bun scripts/skills.ts check    intent validate, sources changed since the last review,
 *                                  library_version against package.json, the packed file list, and
 *                                  `intent stale`
 *   bun scripts/skills.ts stamp    record every skill's current sources as reviewed
 *   bun scripts/skills.ts version  set library_version to the package version (run by the release
 *                                  workflow after `changeset version`)
 *
 * Each SKILL.md lists the files it was written from in its `sources` frontmatter. skills/sync-state.json,
 * the file `intent stale` reads, records the git blob SHA of each of those files as of the last review.
 * The check is conservative: any change to a source fails it until someone has read the skills against
 * the change and stamped.
 */
import { checkStaleness, findSkillFiles, parseFrontmatter } from "@tanstack/intent";
import { $ } from "bun";
import { dirname, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const skillsDir = resolve(root, "skills");
const statePath = resolve(skillsDir, "sync-state.json");
const intent = resolve(root, "node_modules/.bin/intent");

$.cwd(root);

/** The part of skills/sync-state.json that `intent stale` reads. */
interface SyncState {
  skills: Record<string, { sources_sha: Record<string, string> }>;
}

interface Skill {
  /** The skill's directory under skills/, which is also its key in sync-state.json. */
  name: string;
  libraryVersion: unknown;
  sources: string[];
}

const pkg: { name: string; version: string; repository: { url: string } } = await Bun.file(
  resolve(root, "package.json"),
).json();
const repo = /github\.com[/:](.+?)(?:\.git)?$/.exec(pkg.repository.url)?.[1];
if (!repo) throw new Error(`Cannot read the GitHub repository from ${pkg.repository.url}`);

switch (process.argv[2]) {
  case "check":
    await check();
    break;
  case "stamp":
    await stamp();
    break;
  case "version":
    // Also validates, so a release cannot stamp skills whose examples no longer compile.
    await $`${intent} validate --set-version ${pkg.version}`;
    break;
  default:
    console.error("Usage: bun scripts/skills.ts check | stamp | version");
    process.exit(1);
}

async function check(): Promise<void> {
  const problems: string[] = [];

  // Frontmatter, links, packaging, and the code examples typechecked against src/.
  const validation = await $`${intent} validate`.nothrow().quiet();
  process.stdout.write(validation.stdout);
  process.stderr.write(validation.stderr);
  if (validation.exitCode !== 0) {
    problems.push("intent validate failed, see above.");
  } else if (/not typechecked/.test(`${validation.stdout}${validation.stderr}`)) {
    problems.push(
      "intent validate skipped the typecheck of the code examples, see above. Fix the toolchain.",
    );
  }

  const recorded = await readState();
  const skills = await Promise.all(
    readSkills().map(async (skill) => ({
      skill,
      current: await sourceShas(skill).catch((error: Error) => error),
    })),
  );
  for (const { skill, current } of skills) {
    if (skill.libraryVersion !== pkg.version) {
      problems.push(
        `skills/${skill.name}: library_version is ${JSON.stringify(skill.libraryVersion)}, package.json is ` +
          `${pkg.version}. Run \`bun scripts/skills.ts version\` (the release workflow does).`,
      );
    }
    if (current instanceof Error) {
      problems.push(current.message);
      continue;
    }
    const reviewed = recorded.skills[skill.name]?.sources_sha ?? {};
    const changed = skill.sources.filter(
      (source) => reviewed[source] && reviewed[source] !== current[source],
    );
    const unreviewed = skill.sources.filter((source) => !reviewed[source]);
    const dropped = Object.keys(reviewed).filter((source) => !skill.sources.includes(source));
    if (changed.length > 0) {
      problems.push(`skills/${skill.name}: changed since the last review: ${changed.join(", ")}.`);
    }
    if (unreviewed.length > 0) {
      problems.push(`skills/${skill.name}: never reviewed against ${unreviewed.join(", ")}.`);
    }
    if (dropped.length > 0) {
      problems.push(`skills/${skill.name}: sync-state.json still records ${dropped.join(", ")}.`);
    }
  }
  for (const name of Object.keys(recorded.skills)) {
    if (!skills.some(({ skill }) => skill.name === name)) {
      problems.push(`skills/sync-state.json records skills/${name}, which does not exist.`);
    }
  }

  // What `npm publish` would upload: every skill file, and not the review record.
  const [packed]: [{ files: { path: string }[] }] = JSON.parse(
    await $`npm pack --dry-run --json --ignore-scripts`.quiet().text(),
  );
  const shipped = new Set(packed.files.map((file) => file.path));
  for await (const file of new Bun.Glob("**/*").scan({ cwd: skillsDir })) {
    const path = `skills/${file.replaceAll("\\", "/")}`;
    if (path === "skills/sync-state.json") {
      if (shipped.has(path)) problems.push(`${path} would be published. Exclude it in package.json "files".`);
    } else if (!shipped.has(path)) {
      problems.push(`${path} would not be published. Add it to package.json "files".`);
    }
  }

  // Intent's own conservative signals. They overlap with the checks above, so only run them when those
  // pass, to report anything that Intent adds.
  if (problems.length === 0) {
    const report = await checkStaleness(root, pkg.name);
    for (const skill of report.skills.filter((entry) => entry.needsReview)) {
      problems.push(`skills/${skill.name}: ${skill.reasons.join(", ")} (intent stale).`);
    }
    for (const signal of report.signals.filter((entry) => entry.needsReview)) {
      problems.push(`${signal.subject}: ${signal.reasons.join(", ")} (intent stale).`);
    }
  }

  if (problems.length > 0) {
    console.error(`\n✘ ${problems.length} problem(s) with the agent skills:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "\nFor changed or unreviewed sources: read each listed skill against the change, update it if it no " +
        "longer matches, then run `bun run skills:stamp`.",
    );
    process.exit(1);
  }
  console.log(
    `\n✔ ${skills.length} agent skills are valid, reviewed against their current sources, and packed.`,
  );
}

async function stamp(): Promise<void> {
  const recorded = await readState();
  const state: SyncState = { skills: {} };
  const skills = await Promise.all(
    readSkills().map(async (skill) => ({ skill, current: await sourceShas(skill) })),
  );
  for (const { skill, current } of skills) {
    const reviewed = recorded.skills[skill.name]?.sources_sha ?? {};
    for (const [source, sha] of Object.entries(current)) {
      const before = reviewed[source];
      if (before !== sha) {
        console.log(
          `skills/${skill.name}: ${source} ${before ? `${before.slice(0, 7)} → ` : ""}${sha.slice(0, 7)}`,
        );
      }
    }
    state.skills[skill.name] = { sources_sha: current };
  }
  await Bun.write(statePath, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`✔ Recorded the reviewed sources in ${relative(root, statePath)}. Commit it with the skills.`);
}

function readSkills(): Skill[] {
  return findSkillFiles(skillsDir)
    .map((file) => {
      const frontmatter = parseFrontmatter(file) ?? {};
      const metadata = frontmatter.metadata as Record<string, unknown> | undefined;
      return {
        name: relative(skillsDir, dirname(file)).replaceAll("\\", "/"),
        libraryVersion: metadata?.library_version,
        sources: Array.isArray(frontmatter.sources) ? frontmatter.sources.map(String) : [],
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

async function readState(): Promise<SyncState> {
  const file = Bun.file(statePath);
  return (await file.exists()) ? ((await file.json()) as SyncState) : { skills: {} };
}

/** The git blob SHA of each of the skill's sources, keyed by the source as the frontmatter writes it. */
async function sourceShas(skill: Skill): Promise<Record<string, string>> {
  if (skill.sources.length === 0) {
    throw new Error(`skills/${skill.name}: lists no sources, so nothing can tell when it goes stale.`);
  }
  const paths = skill.sources.map((source) => sourcePath(skill, source));
  const exists = await Promise.all(paths.map((path) => Bun.file(resolve(root, path)).exists()));
  const missing = skill.sources.filter((_, index) => !exists[index]);
  if (missing.length > 0) {
    throw new Error(`skills/${skill.name}: ${missing.join(", ")} does not exist.`);
  }
  const shas = (await $`git hash-object -- ${paths}`.quiet().text()).trim().split("\n");
  return Object.fromEntries(skill.sources.map((source, index) => [source, shas[index] ?? ""]));
}

/** Resolves `Owner/repo:path`, or a bare path, to a file in this repository. */
function sourcePath(skill: Skill, source: string): string {
  const qualified = /^([^:\s]+\/[^:\s]+):(.+)$/.exec(source);
  if (qualified && qualified[1]?.toLowerCase() !== repo?.toLowerCase()) {
    throw new Error(`skills/${skill.name}: source ${source} is not in ${repo}, so it cannot be checked.`);
  }
  const path = relative(root, resolve(root, qualified?.[2] ?? source));
  if (path.startsWith("..") || /[*?[\]{}]/.test(path)) {
    throw new Error(
      `skills/${skill.name}: source ${source} must name a file in this repository, without globs.`,
    );
  }
  return path;
}
