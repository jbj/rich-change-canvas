import { textPlugins } from "./text-shape.mjs";
import { churnPlugin } from "./change-shape.mjs";

export const snapshotPlugins = [
  {
    id: "bytes", version: 1, label: "Byte size", unit: "B", reducer: "sum",
    tier: "Language-independent", mode: "snapshot", textOnly: false,
    description: "Whole before/after blob bytes, including binary files. Not compiled program size.",
    measure: ({ bytes }) => ({ numerator: bytes.length, denominator: 1 }),
  },
  ...textPlugins,
];

export const changePlugins = [churnPlugin];
