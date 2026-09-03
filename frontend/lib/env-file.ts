const ENTRY_PATTERN =
  /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*("(?:\\[\s\S]|[^"\\])*"|'[^']*'|[^#\r\n]*)/gm;

const DOUBLE_QUOTED_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
};

function unescapeDoubleQuoted(value: string) {
  return value.replace(/\\([\s\S])/g, (_match, character: string) => {
    return DOUBLE_QUOTED_ESCAPES[character] ?? character;
  });
}

export function parseEnvFile(content: string) {
  const entries: [string, string][] = [];

  for (const match of content.matchAll(ENTRY_PATTERN)) {
    const [, key, raw = ""] = match;

    if (!key) {
      continue;
    }

    if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) {
      entries.push([key, unescapeDoubleQuoted(raw.slice(1, -1))]);
      continue;
    }

    if (raw.startsWith("'") && raw.endsWith("'") && raw.length > 1) {
      entries.push([key, raw.slice(1, -1)]);
      continue;
    }

    entries.push([key, raw.trimEnd()]);
  }

  return entries;
}
