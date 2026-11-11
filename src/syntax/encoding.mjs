export function packSnapshot(snapshot, text) {
  const types = [], fields = [], values = [];
  const intern = (table, map, value) => {
    if (!map.has(value)) { map.set(value, table.length); table.push(value); }
    return map.get(value);
  };
  const typeIds = new Map(), fieldIds = new Map(), valueIds = new Map();
  const nodes = snapshot.nodes.map((node) => {
    const r = node.range;
    return [intern(types, typeIds, node.type), node.parent ?? -1,
      node.field === null ? -1 : intern(fields, fieldIds, node.field),
      r.startIndex, r.endIndex, r.startByte, r.endByte,
      Number(node.named) | (node.kind === "function" ? 2 : node.kind === "decision" ? 4 : node.kind === "boolean" ? 8 : 0),
      ...(node.value === undefined ? [] : [intern(values, valueIds, node.value)])];
  });
  const lineStarts = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === "\n") lineStarts.push(index + 1);
  return { ...snapshot, encoding: "packed-v1", types, fields, values, lineStarts, nodes };
}

function position(lineStarts, index) {
  let low = 0, high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= index) low = middle;
    else high = middle;
  }
  return { row: low, column: index - lineStarts[low] };
}

export function unpackSnapshot(snapshot) {
  if (snapshot?.encoding !== "packed-v1") return snapshot;
  const nodes = snapshot.nodes.map(([type, parent, field, startIndex, endIndex, startByte, endByte, flags, value], id) => ({
    id, type: snapshot.types[type], named: Boolean(flags & 1), parent: parent === -1 ? null : parent,
    field: field === -1 ? null : snapshot.fields[field], children: [],
    range: nodeRange(snapshot, snapshot.nodes[id]),
    ...(flags & 14 ? { kind: flags & 2 ? "function" : flags & 4 ? "decision" : "boolean" } : {}),
    ...(value === undefined ? {} : { value: snapshot.values[value] }),
  }));
  for (const node of nodes) if (node.parent !== null) nodes[node.parent].children.push(node.id);
  return { ...snapshot, encoding: undefined, nodes };
}

export function nodeRange(snapshot, row) {
  const [, , , startIndex, endIndex, startByte, endByte] = row;
  return { startByte, endByte, startIndex, endIndex,
    startPosition: position(snapshot.lineStarts, startIndex), endPosition: position(snapshot.lineStarts, endIndex) };
}
