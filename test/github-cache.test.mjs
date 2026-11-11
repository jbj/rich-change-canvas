import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGithubCache } from "../src/github-cache.mjs";

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "rich-github-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("Cache authenticates once, bounds concurrent requests, deduplicates and replays without authentication", async (t) => {
  const directory = await temporary(t);
  let active = 0, maximum = 0, authentications = 0, requests = 0;
  const api = createGithubCache({
    directory, concurrency: 3,
    authenticate: async () => { authentications++; },
    request: async (endpoint) => {
      requests++;
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { endpoint };
    },
  });
  const endpoints = Array.from({ length: 10 }, (_, index) => `repos/test/repo/contents/${index}?ref=head`);
  const results = await Promise.all([...endpoints, ...endpoints].map(api));
  assert.equal(requests, 10);
  assert.equal(authentications, 1);
  assert.equal(maximum, 3);
  assert.deepEqual(results.slice(0, 10), results.slice(10));
  const offline = createGithubCache({
    directory,
    authenticate: () => { throw new Error("Offline authentication must not run"); },
    request: () => { throw new Error("Offline request must not run"); },
  });
  assert.deepEqual(await Promise.all(endpoints.map(offline)), results.slice(0, 10));
  for (const name of await readdir(directory)) assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
});

test("Authentication and acquisition failures are explicit and never cached as successes", async (t) => {
  const directory = await temporary(t);
  const denied = createGithubCache({
    directory, authenticate: async () => { throw new Error("Not authenticated"); },
    request: () => { throw new Error("Must authenticate first"); },
  });
  await assert.rejects(denied("repos/test/repo"), /Not authenticated/);
  const unavailable = createGithubCache({
    directory, authenticate: async () => {},
    request: async () => { throw new Error("GitHub unavailable"); },
  });
  await assert.rejects(unavailable("repos/test/repo"), /GitHub unavailable/);
  assert.deepEqual(await readdir(directory), []);
});

test("Corrupt or mismatched cache entries fail rather than silently refetching", async (t) => {
  const directory = await temporary(t);
  const endpoint = "repos/test/repo";
  await createGithubCache({ directory, authenticate: async () => {}, request: async () => ({ id: 1 }) })(endpoint);
  const path = join(directory, (await readdir(directory))[0]);
  const cached = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...cached, endpoint: "wrong" }));
  await assert.rejects(createGithubCache({ directory })(endpoint), /identity mismatch/);
  await writeFile(path, "broken JSON");
  await assert.rejects(createGithubCache({ directory })(endpoint), SyntaxError);
});
