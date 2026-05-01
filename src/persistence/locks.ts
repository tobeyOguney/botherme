import { Mutex } from "async-mutex";

const registry = new Map<string, Mutex>();

export function userLock(userId: string): Mutex {
  let m = registry.get(userId);
  if (!m) {
    m = new Mutex();
    registry.set(userId, m);
  }
  return m;
}

export async function withUserLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return userLock(userId).runExclusive(fn);
}
