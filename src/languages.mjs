export function languageForPath(path) {
  for (const [language, pattern] of [
    ["JavaScript", /\.[cm]?jsx?$/], ["TypeScript", /\.[cm]?tsx?$/],
    ["Python", /\.pyi?$/], ["Go", /\.go$/], ["Rust", /\.rs$/], ["Java", /\.java$/],
    ["C/C++", /\.(c|h|cc|cpp|cxx|hpp)$/], ["Kotlin", /\.kts?$/],
    ["Shell", /\.(sh|bash)$/], ["SQL", /\.sql$/],
  ]) if (pattern.test(path)) return language;
  return null;
}
