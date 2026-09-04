/**
 * One-time carry-over of saved work from the app's previous name.
 *
 * Every localStorage key this app owns is prefixed with the product name —
 * `boma-rates`, `boma-projects`, `boma-quote-<id>` and so on. That prefix
 * used to be `gradcon-`, so a browser that used the tool before the rename
 * still has all of its projects, rates and preferences sitting under the old
 * keys where nothing looks for them any more.
 *
 * This copies each `gradcon-*` key across to its `boma-*` twin, and only
 * where the new key is not already set — so it can run on every startup, it
 * never clobbers newer work, and re-running it is a no-op. The old keys are
 * left in place deliberately: nothing is destroyed if this turns out to have
 * mapped something wrongly.
 *
 * Safe to call from anywhere, including a context with no localStorage at
 * all (SSR, a browser with site data blocked) — it just does nothing.
 */
const LEGACY_PREFIX = "gradcon-";
const PREFIX = "boma-";

export function migrateLegacyKeys() {
  let store;
  try {
    store = window.localStorage;
    if (!store) return 0;
  } catch {
    return 0; // storage blocked entirely — nothing to migrate into
  }

  let keys;
  try {
    keys = Object.keys(store).filter((k) => k.startsWith(LEGACY_PREFIX));
  } catch {
    return 0;
  }

  let moved = 0;
  for (const legacyKey of keys) {
    const key = PREFIX + legacyKey.slice(LEGACY_PREFIX.length);
    try {
      if (store.getItem(key) !== null) continue; // already carried over, or newer
      const value = store.getItem(legacyKey);
      if (value === null) continue;
      store.setItem(key, value);
      moved++;
    } catch {
      // A quota error on one key shouldn't abandon the rest.
    }
  }
  return moved;
}
