import { test } from "node:test";
import assert from "node:assert/strict";
import { createGithubRequest } from "../src/github-request.mjs";

test("GitHub source requests are batched into concurrent queries with safely quoted paths", async () => {
  const calls = [];
  let active = 0, maximum = 0;
  const request = createGithubRequest({ invoke: async (args) => {
    calls.push(args);
    maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    const fields = args[2].match(/file\d+:repository/g);
    return { data: Object.fromEntries(fields.map((_, index) => [`file${index}`, {
      object: { __typename: "Blob", oid: "blob", byteSize: 3, isBinary: false, isTruncated: false, text: "é\n" },
    }])) };
  } });
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    request(`repos/test/repo/contents/${encodeURIComponent(`dir/"${index}.go`)}?ref=head`)));
  assert.equal(calls.length, 2);
  assert.equal(maximum, 2);
  assert.ok(calls[0][2].includes(JSON.stringify('head:dir/"0.go')));
  for (const result of results) {
    assert.equal(result.encoding, "base64");
    assert.equal(Buffer.from(result.content, "base64").toString(), "é\n");
    assert.equal(result.size, 3);
  }
});

test("Binary, truncated and byte-mismatched GraphQL blobs request REST fallback rather than losing bytes", async () => {
  const objects = [
    { isBinary: true, isTruncated: false, text: null, byteSize: 4 },
    { isBinary: false, isTruncated: true, text: "a", byteSize: 4 },
    { isBinary: false, isTruncated: false, text: "�", byteSize: 1 },
  ];
  const request = createGithubRequest({ invoke: async () => ({
    data: Object.fromEntries(objects.map((object, index) => [`file${index}`, {
      object: { __typename: "Blob", oid: `blob${index}`, ...object },
    }])),
  }) });
  const results = await Promise.all(objects.map((_, index) => request(`repos/test/repo/contents/${index}?ref=head`)));
  for (const [index, result] of results.entries()) {
    assert.equal(result.encoding, "none");
    assert.equal(result.sha, `blob${index}`);
    assert.equal(result.size, objects[index].byteSize);
  }
});

test("GraphQL failures reject every affected source read, and metadata still uses REST", async () => {
  const request = createGithubRequest({ invoke: async () => ({ errors: [{ message: "Access denied" }] }) });
  const results = await Promise.allSettled([request("repos/test/repo/contents/a?ref=head"),
    request("repos/test/repo/contents/b?ref=head")]);
  assert.ok(results.every((result) => result.status === "rejected" && /Access denied/.test(result.reason.message)));
  const missing = createGithubRequest({ invoke: async () => ({ data: { file0: { object: null } } }) });
  await assert.rejects(missing("repos/test/repo/contents/a?ref=head"), /missing GitHub file/);
  const metadata = createGithubRequest({ invoke: async (args) => ({ args }) });
  assert.deepEqual(await metadata("repos/test/repo/pulls/1"), { args: ["repos/test/repo/pulls/1"] });
});
