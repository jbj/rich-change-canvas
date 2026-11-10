import { execFileSync } from "node:child_process";

export function run(command, args, { cwd, encoding = "utf8", input } = {}) {
  try {
    return execFileSync(command, args, {
      cwd, encoding, input, timeout: 120_000, maxBuffer: 128 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_PAGER: "cat", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GH_PAGER: "cat" },
    });
  } catch (error) {
    if (!error || typeof error !== "object" || !("status" in error)) throw error;
    throw new Error(`${command} failed (${error.status ?? error.code}): ${
      String(error.stderr ?? error.message).trim()
    }`, { cause: error });
  }
}

export function binary(bytes) {
  if (bytes.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return true;
  }
}
