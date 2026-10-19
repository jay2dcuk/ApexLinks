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
const deviceKey = "apexlinks.offline.workspace.v1";
export function offlineEnabled(userId) {
  try {
    return (
      localStorage.getItem("apexlinks.offline.enabled." + userId) === "true"
    );
  } catch {
    return false;
  }
}
export function enableOffline(userId) {
  localStorage.setItem("apexlinks.offline.enabled." + userId, "true");
}
export function cacheWorkspace(snapshot) {
  try {
    if (!snapshot.me || !offlineEnabled(snapshot.me.id)) return false;
    localStorage.setItem(
      deviceKey,
      JSON.stringify({
        ...snapshot,
        saved: new Date().toISOString(),
        expires: Date.now() + 12 * 3600000,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
export function cachedWorkspace() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(deviceKey));
    return snapshot &&
      snapshot.expires > Date.now() &&
      offlineEnabled(snapshot.me.id)
      ? snapshot
      : null;
  } catch {
    return null;
  }
}
export function clearOffline(userId) {
  try {
    if (userId) localStorage.removeItem("apexlinks.offline.enabled." + userId);
    const snapshot = JSON.parse(localStorage.getItem(deviceKey));
    if (snapshot?.me?.id)
      localStorage.removeItem("apexlinks.offline.enabled." + snapshot.me.id);
    localStorage.removeItem(deviceKey);
  } catch {}
}
