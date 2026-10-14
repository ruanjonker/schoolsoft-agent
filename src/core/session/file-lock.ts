/**
 * Cross-process lock for the session file. A refresh token rotates on use,
 * so two runs must not spend the same one, and a save of one school's
 * account must not race a save of another in the same file. The lock is a
 * 0600 file created exclusively. A dead owner's lock, or one older than
 * `staleMs`, is removed and taken. The holder saves the new refresh token
 * before it releases the lock and before it uses the new access token.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createPrivateFile } from "../private-files.js";

export const SESSION_LOCK_FILE = "session.lock";
const DEFAULT_STALE_MS = 120_000;

export interface SessionLockOptions {
  dir: string;
  /** Process id written into the lock, so a dead holder can be told from a live one. */
  pid: number;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** A lock older than this is taken even if its pid still looks alive. */
  staleMs?: number;
}

function lockIsStale(
  path: string,
  now: number,
  isAlive: (pid: number) => boolean,
  staleMs: number,
): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return true;
  }
  const [pidRaw, atRaw] = text.split("\n");
  const pid = Number(pidRaw);
  const at = Number(atRaw);
  if (!Number.isFinite(at) || now - at >= staleMs) return true;
  if (!Number.isInteger(pid) || pid <= 0) return true;
  return !isAlive(pid);
}

/** Run `fn` while this process holds the session lock. The lock is released if `fn` throws. */
export async function withSessionFileLock<T>(
  o: SessionLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const path = join(o.dir, SESSION_LOCK_FILE);
  const now = o.now ?? Date.now;
  const isAlive = o.isAlive ?? (() => true);
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const staleMs = o.staleMs ?? DEFAULT_STALE_MS;
  const body = `${o.pid}\n${now()}`;
  for (;;) {
    if (createPrivateFile(path, body)) break;
    if (lockIsStale(path, now(), isAlive, staleMs)) {
      rmSync(path, { force: true, recursive: true });
      continue;
    }
    await sleep(20);
  }
  try {
    return await fn();
  } finally {
    rmSync(path, { force: true, recursive: true });
  }
}
