// Only the newline between source fields is synthetic. Ranges use UTF-16 offsets.
export function packProvisions(chunks) {
  const groups = new Map();
  for (const [index, chunk] of chunks.entries()) {
    if (!chunk.group || !Array.isArray(chunk.path) || !chunk.path.length ||
        typeof chunk.text !== "string" || !chunk.text.trim()) {
      throw new Error("Invalid original provision field.");
    }
    if (!groups.has(chunk.group)) groups.set(chunk.group, []);
    groups.get(chunk.group).push({ chunk, index });
  }
  return [...groups.values()].map((members) => {
    const first = members[0].chunk;
    if (!["article", "addendum"].includes(first.section)) {
      throw new Error("A stored provision unit must start at an article or addendum.");
    }
    let text = "";
    const parts = members.map(({ chunk }, index) => {
      if (index) text += "\n";
      const start = text.length;
      text += chunk.text;
      return { path: chunk.path, section: chunk.section, displayNumber: chunk.displayNumber ?? null, start, end: text.length };
    });
    return {
      members, text, parts, type: first.section === "article" ? "ARTICLE" : "ADDENDUM",
      displayNumber: first.displayNumber ?? "부칙",
      normalizedNumber: first.article ?? first.group.split(":").at(-1),
      title: first.section === "article" ? first.context ?? null : null,
      effectiveDate: first.effectiveDate ?? null,
    };
  });
}
