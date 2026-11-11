import { createHash } from "node:crypto";

export function snapshotDigest(snapshot) {
  const { id, ...content } = snapshot;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function validateSyntaxSnapshots(snapshots) {
  for (const [id, snapshot] of Object.entries(snapshots)) {
    if (snapshot.id !== id || snapshotDigest(snapshot) !== id ||
        snapshot.identity?.schemaVersion !== 1 || snapshot.encoding !== "packed-v1" ||
        !Array.isArray(snapshot.nodes) || !snapshot.nodes.length || !Array.isArray(snapshot.types) || !Array.isArray(snapshot.fields) ||
        !Array.isArray(snapshot.values) || !Array.isArray(snapshot.lineStarts) ||
        snapshot.lineStarts[0] !== 0 || snapshot.lineStarts.some((index, row) =>
          !Number.isSafeInteger(index) || index < 0 || (row > 0 && index <= snapshot.lineStarts[row - 1])) ||
        !["available", "parse-error"].includes(snapshot.status)) {
      throw new Error(`Invalid syntax snapshot: ${id}`);
    }
    for (const [index, node] of snapshot.nodes.entries()) {
      const [type, parent, field, startIndex, endIndex, startByte, endByte, flags, value] = node;
      if (node.length < 8 || node.length > 9 || !node.every(Number.isSafeInteger) ||
          typeof snapshot.types[type] !== "string" ||
          (index === 0 ? parent !== -1 : parent < 0 || parent >= index) ||
          (field !== -1 && typeof snapshot.fields[field] !== "string") ||
          (value !== undefined && typeof snapshot.values[value] !== "string") ||
          startIndex < 0 || endIndex < startIndex || startByte < 0 || endByte < startByte ||
          endByte > snapshot.identity.sourceBytes || endIndex > snapshot.identity.sourceBytes ||
          flags < 0 || flags > 15 || ![0, 2, 4, 8].includes(flags & 14)) {
        throw new Error(`Invalid syntax node: ${id}:${index}`);
      }
    }
  }
}
