// A unified diff of two texts, for gq sync to show what it would write over a
// local edit. Managed files are small, so a plain longest-common-subsequence
// table is enough.

const CONTEXT = 3;

// The diff of `before` → `after` as lines, the file headers labelled from
// `path`; empty when the texts are equal.
export function unifiedDiff(path, before, after) {
  const operations = diffLines(splitLines(before), splitLines(after));
  const changed = operations.flatMap(({ type }, index) => (type === " " ? [] : [index]));
  if (changed.length === 0) return [];

  const lines = [`--- ${path}`, `+++ ${path} (gq sync)`];
  let start = 0;
  while (start < changed.length) {
    // A hunk runs until two changes are further apart than both contexts.
    let end = start;
    while (end + 1 < changed.length && changed[end + 1] - changed[end] <= 2 * CONTEXT) end += 1;
    const from = Math.max(0, changed[start] - CONTEXT);
    const to = Math.min(operations.length, changed[end] + CONTEXT + 1);
    const hunk = operations.slice(from, to);
    const oldCount = hunk.filter(({ type }) => type !== "+").length;
    const newCount = hunk.filter(({ type }) => type !== "-").length;
    const oldStart = oldCount === 0 ? hunk[0].before : hunk[0].before + 1;
    const newStart = newCount === 0 ? hunk[0].after : hunk[0].after + 1;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const { type, line } of hunk) lines.push(`${type}${line}`);
    start = end + 1;
  }
  return lines;
}

// Each operation keeps the line indexes it starts at in both texts.
function diffLines(before, after) {
  const common = Array.from({ length: before.length + 1 }, () =>
    new Array(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      common[i][j] =
        before[i] === after[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      operations.push({ type: " ", line: before[i], before: i++, after: j++ });
    } else if (i < before.length && (j === after.length || common[i + 1][j] >= common[i][j + 1])) {
      operations.push({ type: "-", line: before[i], before: i++, after: j });
    } else {
      operations.push({ type: "+", line: after[j], before: i, after: j++ });
    }
  }
  return operations;
}

// A last line without a newline carries diff's marker, so it differs from
// the same line with one.
function splitLines(text) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  else lines[lines.length - 1] += "\n\\ No newline at end of file";
  return lines;
}
