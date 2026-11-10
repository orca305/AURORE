import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function run(script, args, input) {
  const caOptions = process.execArgv.filter(option => option === "--use-system-ca");
  const path = fileURLToPath(new URL(script, import.meta.url));
  const child = spawnSync(process.execPath, [...caOptions, path, ...args], {
    input,
    encoding: "utf8",
    windowsHide: true,
  });
  if (child.error || child.status !== 0) {
    throw new Error(`${script} failed: ${child.stderr?.trim() || child.error?.code || child.signal || child.status}`);
  }
  return JSON.parse(child.stdout);
}

async function main() {
  const [date, outputParent, ...extra] = process.argv.slice(2);
  if (!/^\d{8}$/.test(date ?? "") || !outputParent || extra.length) {
    throw new Error("Usage: node --env-file=local-dev/.env backend/tools/stage-law-refresh.mjs YYYYMMDD <staging-parent>");
  }
  const plan = run("./plan-law-refresh.mjs", [date]);
  const preview = run("./preview-law-refresh.mjs", [], JSON.stringify(plan));
  const prepared = run("./prepare-law-refresh.mjs", [outputParent], JSON.stringify(preview));
  const { corrections } = run("./review-law-corrections.mjs", [outputParent], JSON.stringify(preview));
  console.log(JSON.stringify({
    date: plan.date, changes: plan.changes, watchedLaws: plan.watchedLaws,
    candidates: preview.results, prepared, corrections,
  }, null, 2));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
