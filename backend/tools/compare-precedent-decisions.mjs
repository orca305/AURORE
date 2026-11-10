const maxCells = 250_000;
const maxHunks = 20;
const maxParagraphs = 8;
const maxLength = 1_200;

function paragraphs(text) {
  return (text ?? "").split(/<br\s*\/?\s*>|\r\n?|\n/iu).filter(part => part.trim());
}

export function compareDecisionText(previous, current) {
  const before = paragraphs(previous);
  const after = paragraphs(current);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const height = oldEnd - start + 1;
  const width = newEnd - start + 1;
  if (height * width > maxCells) return { status: "comparison-limit", hunks: [] };

  // Longest common subsequence keeps unchanged paragraphs out of disjoint change groups.
  const common = new Uint32Array(height * width);
  for (let i = height - 2; i >= 0; i--) {
    for (let j = width - 2; j >= 0; j--) {
      const cell = i * width + j;
      common[cell] = before[start + i] === after[start + j]
        ? 1 + common[cell + width + 1]
        : Math.max(common[cell + width], common[cell + 1]);
    }
  }

  const hunks = [];
  let i = start;
  let j = start;
  let hunk;
  let truncated = false;
  while (i < oldEnd || j < newEnd) {
    if (i < oldEnd && j < newEnd && before[i] === after[j]) {
      hunk = undefined;
      i++;
      j++;
      continue;
    }
    if (!hunk) {
      if (hunks.length === maxHunks) return { status: "truncated", hunks };
      hunk = { beforeStart: i + 1, afterStart: j + 1, removedCount: 0, addedCount: 0, before: [], after: [] };
      hunks.push(hunk);
    }
    const cell = (i - start) * width + j - start;
    const remove = i < oldEnd && (j === newEnd || common[cell + width] >= common[cell + 1]);
    const part = remove ? before[i++] : after[j++];
    const output = remove ? hunk.before : hunk.after;
    if (remove) hunk.removedCount++;
    else hunk.addedCount++;
    if (output.length < maxParagraphs) output.push(part.slice(0, maxLength));
    if (part.length > maxLength || hunk.removedCount > maxParagraphs || hunk.addedCount > maxParagraphs) {
      truncated = true;
    }
  }
  return { status: truncated ? "truncated" : "complete", hunks };
}

export async function decisionChangesForReviews(db, caseSourceKey, pending) {
  const bySnapshot = new Map();
  for (const item of pending) {
    if (item.caseChanged) bySnapshot.set(item.beforeCaseSnapshotId, item);
  }
  if (!bySnapshot.size) return [];

  const pairs = [...bySnapshot.values()];
  const ids = [...new Set(pairs.flatMap(item => [item.beforeCaseSnapshotId, item.caseSnapshotId]))];
  const { rows } = await db.query(
    `SELECT r.src_snapshot_id::text AS id, r.issue_cont AS issue, r.summary_cont AS summary,
      r.decision_cont AS decision
     FROM legal_prec_rev r JOIN legal_prec c ON c.id=r.legal_prec_id AND NOT c.del_yn
     WHERE c.src_cd='MOLEG' AND c.src_key=$1 AND r.src_snapshot_id=ANY($2::bigint[])`,
    [caseSourceKey, ids],
  );
  const revisions = new Map(rows.map(row => [row.id, row]));
  return pairs.map(({ beforeCaseSnapshotId, caseSnapshotId }) => {
    const before = revisions.get(beforeCaseSnapshotId);
    const current = revisions.get(caseSnapshotId);
    if (!before || !current) throw new Error("The decision revisions changed while preparing the review.");
    const changes = ["issue", "summary", "decision"]
      .map(field => ({ field, ...compareDecisionText(before[field], current[field]) }))
      .filter(section => section.status !== "complete" || section.hunks.length);
    return { beforeCaseSnapshotId, caseSnapshotId, changes };
  });
}
