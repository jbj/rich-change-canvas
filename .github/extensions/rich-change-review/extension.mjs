import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { analyzeLocal, getLocalFileDiff } from "../../../src/local.mjs";
import { resolveReviewBase } from "../../../src/default-branch.mjs";
import { renderReports } from "../../../src/render.mjs";

const servers = new Map();
const repositoryPath = fileURLToPath(new URL("../../../", import.meta.url));

function analyze(workspacePath, base) {
  return analyzeLocal({ cwd: workspacePath, base: resolveReviewBase(workspacePath, { base }), includeWorking: true });
}

async function startServer(report) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    if (request.method === "GET" && requestUrl.pathname === "/diff") {
      try {
        const result = getLocalFileDiff({
          cwd: repositoryPath, report,
          scope: requestUrl.searchParams.get("scope"),
          path: requestUrl.searchParams.get("path"),
        });
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(Number.isInteger(error.statusCode) ? error.statusCode : 500, {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    if (request.method !== "GET" || requestUrl.pathname !== "/") {
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
