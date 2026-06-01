const CACHE_KEY = 'cs_driver_card_cache_v1';

export function buildCardMapFromState(dbState) {
  const map = {};
  for (const u of dbState?.users || []) {
    if (u.role !== 'student' || !u.cardUid) continue;
    map[u.cardUid] = {
      userId: u.id,
      name: u.name,
      regNo: u.regNo,
    };
  }
  return map;
}

export function persistCardCache(dbState) {
  if (typeof window === 'undefined') return;
  const map = buildCardMapFromState(dbState);
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ updatedAt: Date.now(), map })
    );
  } catch {
    /* storage full — ignore */
  }
}

export function loadCardCache() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw).map || {};
  } catch {
    return {};
  }
}

/** Instant lookup: { userId, name, regNo } or null */
export function lookupCard(cardUid) {
  if (!cardUid) return null;
  return loadCardCache()[cardUid] || null;
}
