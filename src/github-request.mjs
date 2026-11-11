import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function github(args) {
  const { stdout } = await execute("gh", ["api", "--hostname", "github.com", ...args], {
    timeout: 120_000, maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export function createGithubRequest({ invoke = github } = {}) {
  let queue = [];
  async function acquire(batch) {
    try {
      const fields = batch.map(({ owner, repository, expression }, index) =>
        `file${index}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(repository)}){` +
        `object(expression:${JSON.stringify(expression)}){__typename ... on Blob{oid byteSize isBinary isTruncated text}}}`);
      const response = await invoke(["graphql", "-f", `query={${fields.join("\n")}}`]);
      if (response.errors?.length) throw new Error(`GitHub blob query failed: ${response.errors.map((error) => error.message).join("; ")}`);
      const contents = batch.map(({ endpoint }, index) => {
        const blob = response.data?.[`file${index}`]?.object;
        if (blob?.__typename !== "Blob") throw new Error(`Unsupported or missing GitHub file: ${endpoint}`);
        const bytes = typeof blob.text === "string" ? Buffer.from(blob.text) : null;
        const complete = !blob.isBinary && !blob.isTruncated && bytes?.length === blob.byteSize;
        return { type: "file", sha: blob.oid, size: blob.byteSize,
          encoding: complete ? "base64" : "none", content: complete ? bytes.toString("base64") : "" };
      });
      batch.forEach((entry, index) => entry.resolve(contents[index]));
    } catch (error) {
      batch.forEach((entry) => entry.reject(error));
    }
  }
  function flush() {
    const batch = queue;
    queue = [];
    for (let index = 0; index < batch.length; index += 4) {
      void acquire(batch.slice(index, index + 4));
    }
  }
  return function request(endpoint) {
    const match = /^repos\/([^/]+)\/([^/]+)\/contents\/(.+)\?ref=([^&]+)$/.exec(endpoint);
    if (!match) return invoke([endpoint]);
    return new Promise((resolve, reject) => {
      queue.push({ endpoint, owner: match[1], repository: match[2],
        expression: `${decodeURIComponent(match[4])}:${decodeURIComponent(match[3])}`, resolve, reject });
      if (queue.length === 1) setImmediate(flush);
    });
  };
}
