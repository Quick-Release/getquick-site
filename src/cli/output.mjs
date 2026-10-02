// Writes lines through io.out, the run() seam's stdout.
export function printValue(io, value, options = {}) {
  if (options.json) {
    io.out(JSON.stringify(value, null, 2));
    return;
  }

  if (Array.isArray(value)) {
    printTable(io, value);
    return;
  }

  printObject(io, value);
}

function printObject(io, value) {
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || typeof entry === "object") continue;
    io.out(`${humanize(key)}: ${sanitize(entry)}`);
  }
}

function printTable(io, rows) {
  if (rows.length === 0) {
    io.out("No results.");
    return;
  }

  const keys = uniqueKeys(rows);
  const widths = keys.map((key) =>
    Math.max(key.length, ...rows.map((row) => formatCell(row[key]).length)),
  );
  io.out(keys.map((key, index) => key.toUpperCase().padEnd(widths[index])).join("  "));
  io.out(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    io.out(keys.map((key, index) => formatCell(row[key]).padEnd(widths[index])).join("  "));
  }
}

function uniqueKeys(rows) {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))];
}

function formatCell(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return sanitize(JSON.stringify(value));
  return sanitize(value);
}

function sanitize(value) {
  return [...String(value)]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      const isControl = codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
      return isControl ? `\\u${codePoint.toString(16).padStart(4, "0")}` : character;
    })
    .join("");
}

function humanize(value) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}
