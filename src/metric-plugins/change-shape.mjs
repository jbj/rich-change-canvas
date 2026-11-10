export const churnPlugin = {
  id: "churn", version: 1, label: "Text churn", unit: "lines", reducer: "sum",
  tier: "Language-independent", mode: "diffstat",
  description: "Absolute added and removed text lines in the selected scope, including blanks and comments. Binary files contribute no text lines.",
  measure({ additions, deletions }) {
    return { additions, deletions };
  },
};
