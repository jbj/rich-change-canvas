import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { analyzeLocal } from "../../../src/local.mjs";
import { resolveDefaultBranch } from "../../../src/default-branch.mjs";
import { renderReports } from "../../../src/render.mjs";

const servers = new Map();
const repositoryPath = fileURLToPath(new URL("../../../", import.meta.url));

function analyze(workspacePath, base = resolveDefaultBranch(workspacePath)) {
  return analyzeLocal({ cwd: workspacePath, base, includeWorking: true });
}

async function startServer(report) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (request.method !== "GET" || path !== "/") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(renderReports([report]));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("Unable to determine the canvas server address");
  }
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

const canvas = createCanvas({
  id: "review",
  displayName: "Rich change review",
  description: "Read-only change evidence for the current repository compared with its default branch.",
  inputSchema: {
    type: "object",
    properties: { base: { type: "string", minLength: 1 } },
    additionalProperties: false,
  },
  open: async (ctx) => {
    let entry = servers.get(ctx.instanceId);
    if (!entry) {
      const report = analyze(repositoryPath, ctx.input?.base);
      entry = await startServer(report);
      servers.set(ctx.instanceId, entry);
    }
    return { title: "Rich change review", url: entry.url };
  },
  onClose: async (ctx) => {
    const entry = servers.get(ctx.instanceId);
    if (!entry) return;
    servers.delete(ctx.instanceId);
    await new Promise((resolve) => entry.server.close(resolve));
  },
});

await joinSession({ canvases: [canvas] });
