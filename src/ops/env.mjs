import { chmod, readFile, writeFile } from "node:fs/promises";

export function parseEnv(content) {
  const values = {};

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = parseValue(match[2]);
  }

  return values;
}

export async function readEnvFile(path) {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export async function mergeEnvFile(path, updates) {
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const seen = new Set();
  const lines = content.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*).*$/);
    if (!match || !(match[2] in updates)) return line;
    seen.add(match[2]);
    return `${match[1]}${match[2]}${match[3]}${formatValue(updates[match[2]])}`;
  });

  for (const [name, value] of Object.entries(updates)) {
    if (!seen.has(name)) lines.push(`${name}=${formatValue(value)}`);
  }

  await writeFile(path, `${lines.join("\n").replace(/\n*$/, "")}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

function formatValue(value) {
  const stringValue = String(value ?? "");
  if (stringValue === "" || /^[A-Za-z0-9_./:@-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/["\\$`]/g, "\\$&")}"`;
}

function parseValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'")) {
    const closing = trimmed.indexOf("'", 1);
    if (closing !== -1) return trimmed.slice(1, closing);
  }
  if (trimmed.startsWith('"')) {
    const match = trimmed.match(/^"((?:\\.|[^"\\])*)"/);
    if (match) {
      return match[1].replace(/\\([nrt"\\])/g, (_, escaped) => {
        return { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" }[escaped];
      });
    }
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}
