const prefix = "apexlinks.scorequeue.v1.";
export function readQueue(userId) {
  try {
    return JSON.parse(localStorage.getItem(prefix + userId) || "[]");
  } catch {
    return [];
  }
}
export function queueScore(userId, orgId, path, body) {
  const queue = readQueue(userId),
    key = orgId + ":" + body.roundId + ":" + (body.playerId || body.team),
    old = queue.find((q) => q.key === key);
  const item = {
    key,
    orgId,
    path,
    body: { ...body, version: old?.body.version ?? body.version },
    saved: new Date().toISOString(),
  };
  const next = queue.filter((q) => q.key !== key);
  next.push(item);
  localStorage.setItem(prefix + userId, JSON.stringify(next));
  return item;
}
export function removeQueued(userId, key) {
  localStorage.setItem(
    prefix + userId,
    JSON.stringify(readQueue(userId).filter((q) => q.key !== key)),
  );
}
