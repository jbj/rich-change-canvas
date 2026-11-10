// Classify every file in each sampled repository, at the sample's merge commit.
//
//   node research/survey-files.mjs [--cache DIR] [--out research/file-survey.json] [--top 40]
//   node research/survey-files.mjs --list other > /tmp/other.tsv   # repository, path, reason
//
// Trees are fetched blobless at depth 1 into the cache (default $TMPDIR/rich-change-survey);
// no blobs are downloaded, nothing is checked out, and no repository code is executed.
// Path listings are cached as <cache>/<owner>__<repo>.paths, so reruns are offline.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { classify } from "../src/metrics.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  cache: { type: "string", default: join(tmpdir(), "rich-change-survey") },
  out: { type: "string", default: join(root, "file-survey.json") },
  top: { type: "string", default: "40" },
  list: { type: "string" },
}, strict: false });
const top = Number(values.top);
mkdirSync(values.cache, { recursive: true });

const git = (args, gitDir) => execFileSync("git", gitDir ? [`--git-dir=${gitDir}`, ...args] : args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
});

export function listPaths(repository, sha, cache = values.cache) {
  const listing = join(cache, `${repository.replace("/", "__")}.paths`);
  if (existsSync(listing)) {
    const [head, ...paths] = readFileSync(listing, "utf8").split("\n").filter(Boolean);
    if (head === sha) return paths;
  }
  const dir = join(cache, repository.replace("/", "__"));
  rmSync(dir, { recursive: true, force: true });
  git(["init", "-q", "--bare", dir]);
  git(["fetch", "-q", "--depth=1", "--filter=blob:none", "--no-tags",
    `https://github.com/${repository}.git`, sha], dir);
  const paths = git(["-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", "-z", sha], dir)
    .split("\0").filter(Boolean);
  writeFileSync(listing, [sha, ...paths].join("\n") + "\n");
  rmSync(dir, { recursive: true, force: true });
  return paths;
}

export function loadSurvey(cache = values.cache) {
  const corpus = JSON.parse(readFileSync(join(root, "corpus.json"), "utf8"));
  return corpus.samples.map((sample) => {
    const sha = sample.mergeCommitSha ?? sample.headSha;
    process.stderr.write(`${sample.repository}@${sha.slice(0, 10)}\n`);
    return { repository: sample.repository, language: sample.language, sha, paths: listPaths(sample.repository, sha, cache) };
  });
}

const extensionOf = (path) => {
  const name = path.split("/").at(-1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : `(none) ${name}`;
};
const directoryOf = (path) => path.split("/").slice(0, -1).slice(0, 2).join("/") || ".";
const rank = (counter) => Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, top);
const bump = (counter, key) => { counter[key] = (counter[key] ?? 0) + 1; };

if (process.argv[1] === fileURLToPath(import.meta.url) && values.list) {
  for (const { repository, paths } of loadSurvey()) {
    for (const path of paths) {
      const { category, reason } = classify(path);
      if (category === values.list || values.list === "all") process.stdout.write(`${repository}\t${path}\t${category}\t${reason}\n`);
    }
  }
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repos = loadSurvey();
  const totals = {};
  const otherExtensions = {};
  const otherDirectories = {};
  const perRepository = [];
  let files = 0;
  for (const { repository, language, sha, paths } of repos) {
    const categories = {};
    for (const path of paths) {
      const { category } = classify(path);
      bump(categories, category);
      bump(totals, category);
      if (category === "other") {
        bump(otherExtensions, extensionOf(path));
        bump(otherDirectories, `${repository}:${directoryOf(path)}`);
      }
    }
    files += paths.length;
    perRepository.push({ repository, language, sha, files: paths.length, otherShare: +((categories.other ?? 0) / paths.length).toFixed(4), categories });
  }
  const summary = {
    generatedBy: "research/survey-files.mjs",
    note: "Every path at each corpus sample's merge commit, classified by path only (blob contents not inspected).",
    repositories: repos.length, files,
    otherShare: +((totals.other ?? 0) / files).toFixed(4),
    categories: Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1])),
    perRepository: perRepository.sort((a, b) => b.otherShare - a.otherShare),
    topOtherExtensions: rank(otherExtensions),
    topOtherDirectories: rank(otherDirectories),
  };
  writeFileSync(values.out, JSON.stringify(summary, null, 2) + "\n");
  console.log(`${files} files in ${repos.length} repositories; other = ${totals.other ?? 0} (${(100 * summary.otherShare).toFixed(2)}%)`);
  for (const [category, count] of Object.entries(summary.categories)) console.log(`  ${category.padEnd(15)} ${String(count).padStart(8)}  ${(100 * count / files).toFixed(2)}%`);
  console.log("\nHighest per-repository other share:");
  for (const repo of summary.perRepository.slice(0, 10)) console.log(`  ${repo.repository.padEnd(36)} ${(100 * repo.otherShare).toFixed(2)}% of ${repo.files}`);
  console.log("\nTop residual extensions:");
  for (const [key, count] of summary.topOtherExtensions) console.log(`  ${String(count).padStart(7)}  ${key}`);
  console.log("\nTop residual directories:");
  for (const [key, count] of summary.topOtherDirectories.slice(0, 25)) console.log(`  ${String(count).padStart(7)}  ${key}`);
}
