const QUEUE_KEY = 'cs_offline_tap_queue';
const HOTLIST_KEY = 'cs_offline_tap_hotlist';
const HOTLIST_MS = 10000;
const MAX_QUEUE = 500;

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

export function getPendingTaps() {
  return readJson(QUEUE_KEY, []);
}

function saveQueue(queue) {
  writeJson(QUEUE_KEY, queue.slice(0, MAX_QUEUE));
}

export function enqueueTap(payload) {
  const queue = getPendingTaps();
  const item = {
    queueId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    queuedAt: new Date().toISOString(),
    ...payload,
  };
  queue.push(item);
  saveQueue(queue);
  setLocalHotlist(payload.card_uid);
  return item;
}

export function removeTap(queueId) {
  saveQueue(getPendingTaps().filter((t) => t.queueId !== queueId));
}

export function pendingCount() {
  return getPendingTaps().length;
}

export function isLocallyHotlisted(cardUid) {
  const map = readJson(HOTLIST_KEY, {});
  const exp = map[cardUid];
  if (!exp) return false;
  if (Date.now() >= exp) {
    delete map[cardUid];
    writeJson(HOTLIST_KEY, map);
    return false;
  }
  return true;
}

export function localHotlistSecondsLeft(cardUid) {
  const map = readJson(HOTLIST_KEY, {});
  const exp = map[cardUid];
  if (!exp) return 0;
  return Math.max(0, Math.ceil((exp - Date.now()) / 1000));
}

export function setLocalHotlist(cardUid, ms = HOTLIST_MS) {
  const map = readJson(HOTLIST_KEY, {});
  map[cardUid] = Date.now() + ms;
  writeJson(HOTLIST_KEY, map);
}

export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * POST one queued tap to /api/process-tap. Returns { ok, data, error }.
 */
export async function postTapToServer(item) {
  const res = await fetch('/api/process-tap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_uid: item.card_uid,
      driver_id: item.driver_id,
      shuttle_id: item.shuttle_id,
      route: item.route,
      vehicle_no: item.vehicle_no,
      queue_id: item.queueId,
      queued_at: item.queuedAt,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data };
  return { ok: false, error: data.error || `HTTP ${res.status}`, status: res.status, data };
}

/**
 * Sync all pending taps (FIFO). Stops on first hard failure; skips permanent rejects.
 */
export async function syncPendingTaps() {
  if (!isOnline()) return { synced: 0, failed: 0, remaining: pendingCount() };

  const queue = getPendingTaps();
  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    const result = await postTapToServer(item);
    if (result.ok) {
      removeTap(item.queueId);
      synced += 1;
      continue;
    }

    // Card not mapped / user missing — do not retry forever
    if (result.status === 404 || result.status === 400) {
      removeTap(item.queueId);
      failed += 1;
      continue;
    }

    failed += 1;
    break;
  }

  return { synced, failed, remaining: pendingCount() };
}
