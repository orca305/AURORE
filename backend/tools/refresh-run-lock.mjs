import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { link, mkdir, open, readFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
export async function createRecord(path, record) {
  const temporary = path + '.' + randomUUID() + '.part',
    file = await open(temporary, 'wx');
  try {
    try {
      await file.writeFile(JSON.stringify(record, null, 2) + '\n', 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temporary, path);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    await unlink(temporary);
  }
}
const lockName = 'run.lock.json';
const failure = (code, message) => Object.assign(new Error(message), { code });
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}
async function readLock(directory) {
  try {
    return JSON.parse(await readFile(join(directory, lockName), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { invalid: true };
  }
}
function valid(record) {
  return (
    record &&
    Number.isInteger(record.pid) &&
    record.pid > 0 &&
    record.pid <= 2147483647 &&
    typeof record.host === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      record.token ?? '',
    ) &&
    typeof record.startedAt === 'string' &&
    Number.isFinite(Date.parse(record.startedAt))
  );
}
export async function refreshExecutionState(directory) {
  const record = await readLock(directory);
  if (!record) return { status: 'IDLE', startedAt: null };
  if (!valid(record)) return { status: 'INVALID', startedAt: null };
  return {
    status:
      record.host !== hostname()
        ? 'OTHER_HOST'
        : alive(record.pid)
          ? 'RUNNING'
          : 'RECOVERY_REQUIRED',
    startedAt: new Date(record.startedAt).toISOString(),
  };
}
export async function withRefreshLock(
  directory,
  run,
  { recoverLock = false } = {},
) {
  const path = join(directory, lockName),
    record = {
      pid: process.pid,
      host: hostname(),
      token: randomUUID(),
      startedAt: new Date().toISOString(),
    };
  let owned = await createRecord(path, record);
  if (!owned && recoverLock) {
    const guard = join(directory, '.lock-recovery');
    try {
      await mkdir(guard);
    } catch (error) {
      if (error.code === 'EEXIST')
        throw failure(
          'RECOVERY_BUSY',
          'A recovery check is already in progress.',
        );
      throw error;
    }
    try {
      const previous = await readLock(directory);
      if (!valid(previous))
        throw failure('LOCK_INVALID', 'Check the lock record before recovery.');
      if (previous.host !== hostname())
        throw failure(
          'OTHER_HOST',
          'A lock from another host requires operator verification.',
        );
      if (alive(previous.pid))
        throw failure('BATCH_RUNNING', 'Another collector is still running.');
      const current = await readLock(directory);
      if (current?.token !== previous.token)
        throw failure('LOCK_CHANGED', 'The lock changed during recovery.');
      await unlink(path);
      owned = await createRecord(path, record);
    } finally {
      await rmdir(guard);
    }
  }
  if (!owned) {
    const state = await refreshExecutionState(directory);
    throw failure(
      state.status === 'RUNNING' ? 'BATCH_RUNNING' : state.status,
      'Collection is already claimed. Inspect --status; use --recover-lock only after an interrupted local process has exited.',
    );
  }
  try {
    return await run();
  } finally {
    const current = await readLock(directory);
    if (current?.token === record.token) await unlink(path);
    else
      throw failure(
        'LOCK_CHANGED',
        'The collection lock changed unexpectedly.',
      );
  }
}
