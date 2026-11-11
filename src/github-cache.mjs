import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { digest } from "./report.mjs";
import { createLimiter } from "./process.mjs";
import { createGithubRequest } from "./github-request.mjs";

const execute = promisify(execFile);

export function createGithubCache({
  directory = join(homedir(), ".cache", "rich-change-canvas", "github-v1"),
  concurrency = 8,
  request = createGithubRequest(),
  authenticate = async () => {
    try {
      await execute("gh", ["auth", "status", "--hostname", "github.com"], { timeout: 120_000 });
    } catch (error) {
      throw new Error("GitHub acquisition requires authenticated gh for github.com; run gh auth login.", { cause: error });
    }
  },
} = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError("Invalid request concurrency");
  let authentication;
  const limited = createLimiter(concurrency);
  const pending = new Map();
  return function api(endpoint) {
    if (pending.has(endpoint)) return pending.get(endpoint);
    const result = (async () => {
      const path = join(directory, `${digest(endpoint)}.json`);
      try {
        const cached = JSON.parse(await readFile(path, "utf8"));
        if (cached.endpoint !== endpoint) throw new Error(`GitHub cache identity mismatch: ${path}`);
        return cached.value;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      authentication ??= authenticate();
      await authentication;
      return limited(async () => {
        const value = await request(endpoint);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify({ endpoint, value }), { flag: "wx", mode: 0o600 });
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
        return value;
      });
    })();
    pending.set(endpoint, result);
    return result;
  };
}
