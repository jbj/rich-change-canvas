import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = dirname(fileURLToPath(import.meta.url));
const cache = process.env.STUDY_CACHE;
if (!cache) throw new Error("Set STUDY_CACHE to an artifact directory outside the repository.");
mkdirSync(cache, { recursive: true });
const projects = JSON.parse(readFileSync(join(root, "projects.json"), "utf8"));
const extensions = {
  JavaScript: /\.[cm]?jsx?$/, TypeScript: /\.[cm]?tsx?$/,
  Python: /\.py$/, Go: /\.go$/, Rust: /\.rs$/, Java: /\.java$/,
};

function api(endpoint) {
  const encoded = Buffer.from(endpoint).toString("base64url");
  const file = join(cache, `${encoded.length < 200 ? encoded : createHash("sha256").update(endpoint).digest("hex")}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const result = JSON.parse(execFileSync("gh", ["api", endpoint], {
    encoding: "utf8", maxBuffer: 100 * 1024 * 1024,
  }));
  writeFileSync(file, JSON.stringify(result));
  return result;
}

function pages(endpoint, extract = (value) => value) {
  const result = [];
  for (let page = 1; ; page++) {
    const response = api(`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    const items = extract(response);
    assert.ok(Array.isArray(items), `Expected a page array: ${endpoint}`);
    result.push(...items);
    if (items.length < 100) return result;
  }
}

function reviewEvidence(pr, reviews, issueComments, inlineComments) {
  const latest = new Map();
  for (const review of reviews) {
    if (review.user?.type === "Bot" || review.user?.login === pr.user.login) continue;
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) latest.set(review.user.login, review);
  }
  const approvals = [...latest.values()].filter((review) => review.state === "APPROVED");
  return {
    issueComments: pr.comments, inlineComments: pr.review_comments,
    nonemptyReviewBodies: reviews.filter((review) => review.body?.trim()).length,
    discussionEntries: pr.comments + pr.review_comments + reviews.filter((review) => review.body?.trim()).length,
    humanIssueComments: issueComments.filter((comment) => comment.user?.type !== "Bot").length,
    humanInlineComments: inlineComments.filter((comment) => comment.user?.type !== "Bot").length,
    humanReviewBodies: reviews.filter((review) => review.user?.type !== "Bot" && review.body?.trim()).length,
    humanDiscussionEntries: issueComments.filter((comment) => comment.user?.type !== "Bot").length +
      inlineComments.filter((comment) => comment.user?.type !== "Bot").length +
      reviews.filter((review) => review.user?.type !== "Bot" && review.body?.trim()).length,
    humanApprovals: approvals.length,
    headHumanApprovals: approvals.filter((review) => review.commit_id === pr.head.sha).length,
    maintainerApprovals: approvals.filter((review) => ["OWNER", "MEMBER", "COLLABORATOR"].includes(review.author_association)).length,
    reviewEvents: reviews.map((review) => ({
      state: review.state, association: review.author_association,
      human: review.user?.type !== "Bot", authorReview: review.user?.login === pr.user.login,
      commitSha: review.commit_id, submittedAt: review.submitted_at,
      hasBody: Boolean(review.body?.trim()), url: review.html_url,
    })),
  };
}

function blob(repo, path, sha) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const result = api(`repos/${repo}/contents/${encoded}?ref=${sha}`);
  assert.ok(!Array.isArray(result), `Expected a file: ${path}`);
  let binary = null;
  if (result.encoding === "base64") {
    const bytes = Buffer.from(result.content, "base64");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      binary = bytes.includes(0);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      binary = true;
    }
  }
  return { bytes: result.size, binary, sha: result.sha };
}

function filesWithEvidence(repo, files, parent, head) {
  return files.map((file) => {
    const lines = file.patch?.split("\n") ?? [];
    const complete = typeof file.patch === "string" &&
      lines.filter((line) => line.startsWith("+")).length === file.additions &&
      lines.filter((line) => line.startsWith("-")).length === file.deletions;
    const renameOnly = file.status === "renamed" && !file.additions && !file.deletions;
    let before = null;
    let after = null;
    if (!complete) {
      if (file.status !== "added") before = blob(repo, file.previous_filename ?? file.filename, parent);
      if (file.status !== "removed") after = blob(repo, file.filename, head);
    }
    return {
      path: file.filename, previousPath: file.previous_filename ?? null,
      status: file.status, additions: file.additions, deletions: file.deletions,
      binary: before?.binary === true || after?.binary === true,
      beforeBytes: before?.bytes ?? null, afterBytes: after?.bytes ?? null,
      addedRustTestAttributes: file.filename.endsWith(".rs") ?
        lines.filter((line) => /^\+\s*#\[(?:\w+::)*test(?:\]|\()/.test(line)).length : 0,
      removedRustTestAttributes: file.filename.endsWith(".rs") ?
        lines.filter((line) => /^-\s*#\[(?:\w+::)*test(?:\]|\()/.test(line)).length : 0,
      patchState: complete ? "complete" :
        before?.binary === true || after?.binary === true ? "binary" : renameOnly ? "rename-only" : "missing-or-truncated",
    };
  });
}

function collectProject(language, repo, requiredPattern = null) {
  const saved = join(cache, `${repo.replace("/", "--")}-selected-v3.json`);
  if (existsSync(saved)) return JSON.parse(readFileSync(saved, "utf8"));
  const repository = api(`repos/${repo}`);
  const audit = [];
  for (let page = 1; page <= 4; page++) {
    const candidates = api(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50&page=${page}`);
    for (const candidate of candidates) {
      if (!candidate.merged_at || candidate.user.type === "Bot") continue;
      const pr = api(`repos/${repo}/pulls/${candidate.number}`);
      let targetedFiles = null;
      if (requiredPattern) {
        targetedFiles = pages(`repos/${repo}/pulls/${pr.number}/files`);
        if (!targetedFiles.some((file) => new RegExp(requiredPattern).test(file.filename))) {
          audit.push({ number: pr.number, reason: "missing-targeted-binary-case-file" });
          continue;
        }
      }
      const reviews = pages(`repos/${repo}/pulls/${pr.number}/reviews`);
      const preliminary = reviewEvidence(pr, reviews, [], []);
      if (!preliminary.headHumanApprovals || !preliminary.maintainerApprovals ||
          preliminary.humanReviewBodies > 2) {
        audit.push({ number: pr.number, reason: "review-evidence-filter", ...preliminary, reviewEvents: undefined });
        continue;
      }
      const issueComments = pages(`repos/${repo}/issues/${pr.number}/comments`);
      const inlineComments = pages(`repos/${repo}/pulls/${pr.number}/comments`);
      assert.equal(issueComments.length, pr.comments);
      assert.equal(inlineComments.length, pr.review_comments);
      const evidence = reviewEvidence(pr, reviews, issueComments, inlineComments);
      if (evidence.humanDiscussionEntries > 2) {
        audit.push({ number: pr.number, reason: "review-evidence-filter", ...evidence, reviewEvents: undefined });
        continue;
      }
      const rawFiles = targetedFiles ?? pages(`repos/${repo}/pulls/${pr.number}/files`);
      assert.equal(rawFiles.length, pr.changed_files, `${repo}#${pr.number}: truncated PR file list`);
      if (!rawFiles.some((file) => extensions[language].test(file.filename))) {
        audit.push({ number: pr.number, reason: "no-changed-target-language-file" });
        continue;
      }
      if (pr.commits > 250) {
        audit.push({ number: pr.number, reason: "PR-commit-endpoint-limit" });
        continue;
      }
      const comparison = api(`repos/${repo}/compare/${pr.base.sha}...${pr.head.sha}`);
      const mergeBase = comparison.merge_base_commit.sha;
      const files = filesWithEvidence(repo, rawFiles, mergeBase, pr.head.sha);
      assert.equal(files.reduce((sum, file) => sum + file.additions, 0), pr.additions);
      assert.equal(files.reduce((sum, file) => sum + file.deletions, 0), pr.deletions);
      const rawCommits = pages(`repos/${repo}/pulls/${pr.number}/commits`);
      assert.equal(rawCommits.length, pr.commits, "Incomplete PR commit list");
      const commits = rawCommits.map((entry) => {
        const detail = api(`repos/${repo}/commits/${entry.sha}?per_page=100&page=1`);
        const rawCommitFiles = [...detail.files];
        if (detail.files.length === 100) {
          for (let next = 2; ; next++) {
            const extra = api(`repos/${repo}/commits/${entry.sha}?per_page=100&page=${next}`);
            rawCommitFiles.push(...extra.files);
            if (extra.files.length < 100) break;
          }
        }
        const parentSha = detail.parents[0]?.sha ?? null;
        const commitFiles = filesWithEvidence(repo, rawCommitFiles, parentSha, entry.sha);
        assert.equal(commitFiles.reduce((sum, file) => sum + file.additions, 0), detail.stats.additions);
        assert.equal(commitFiles.reduce((sum, file) => sum + file.deletions, 0), detail.stats.deletions);
        return {
          sha: entry.sha, parentSha, parentCount: detail.parents.length,
          subject: entry.commit.message.split("\n")[0], url: entry.html_url,
          additions: detail.stats.additions, deletions: detail.stats.deletions, files: commitFiles,
        };
      });
      const result = {
        repository: repository.full_name, language, stars: repository.stargazers_count,
        number: pr.number, title: pr.title, url: pr.html_url,
        mergedAt: pr.merged_at, collectedAt: new Date().toISOString(),
        baseSha: pr.base.sha, headSha: pr.head.sha, mergeBaseSha: mergeBase,
        mergeCommitSha: pr.merge_commit_sha, additions: pr.additions, deletions: pr.deletions,
        evidence, files, commits, selectionAudit: audit,
        selectionRequirement: requiredPattern,
      };
      writeFileSync(saved, `${JSON.stringify(result, null, 2)}\n`);
      process.stderr.write(`${repo}#${pr.number}: ${language}, ${files.length} files, ${commits.length} commits, ${evidence.humanDiscussionEntries} human discussion entries\n`);
      return result;
    }
  }
  writeFileSync(join(cache, `${repo.replace("/", "--")}-rejected.json`), JSON.stringify(audit, null, 2));
  throw new Error(`No qualifying ${language} PR found for ${repo}; inspect selection audit and expand deliberately.`);
}

const groupFilter = process.env.STUDY_GROUP;
const repoFilter = process.env.STUDY_REPOSITORY;
assert.ok(!(groupFilter && repoFilter), "Choose one study filter");
const filtered = Boolean(groupFilter || repoFilter);
const selectedProjects = projects.filter(([language, repo]) =>
  (!groupFilter || language === groupFilter) && (!repoFilter || repo === repoFilter));
assert.ok(selectedProjects.length, "No projects match the study filter");
const outputName = filtered ? `part-${(groupFilter ?? repoFilter).replaceAll("/", "--")}.json` : "corpus.json";
const results = [];
for (const [language, repo, requiredPattern] of selectedProjects) {
  results.push(collectProject(language, repo, requiredPattern));
  writeFileSync(join(root, outputName), `${JSON.stringify({
    schemaVersion: 1,
    selection: "First qualifying recently updated merged non-bot PR per project; <=2 human issue + inline + nonempty review-body entries, bots reported separately; at least one current human head approval and one current maintainer approval; includes target-language file.",
    samples: results,
  }, null, 2)}\n`);
}
if (!filtered) {
  assert.equal(new Set(results.map((result) => result.repository)).size, 30);
  assert.ok(new Set(results.map((result) => result.language)).size >= 5);
}
process.stderr.write(`Saved ${results.length} projects.\n`);
