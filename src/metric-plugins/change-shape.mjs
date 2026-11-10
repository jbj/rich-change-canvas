export const churnPlugin = {
  id: "churn-share", version: 1, label: "Churn share", unit: "%",
  tier: "Language-independent", mode: "distribution",
  description: "Fraction of selected-scope added + deleted text lines. Concentration uses the largest file; entropy is Shannon entropy across files in bits.",
  measure(changes) {
    const total = changes.reduce((sum, file) => sum + file.additions + file.deletions, 0);
    const shares = changes.map((file) => total ? (file.additions + file.deletions) / total : null);
    let largest = 0, entropy = 0;
    for (const share of shares) {
      if (share === null || share === 0) continue;
      largest = Math.max(largest, share);
      entropy -= share * Math.log2(share);
    }
    return {
      shares: shares.map((share) => share === null ? null : share * 100),
      largestShare: total ? largest * 100 : null,
      entropy: total ? entropy : null,
    };
  },
};
