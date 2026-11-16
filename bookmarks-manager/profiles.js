// A profile remembers both what was on and what was off. An extension installed
// after the profile was saved is in neither list, so applying leaves it alone.

export function capture(exts) {
  return {
    on: exts.filter((e) => e.enabled).map((e) => e.id),
    off: exts.filter((e) => !e.enabled).map((e) => e.id),
  };
}

// Only extensions that still exist count: an uninstalled one must not make a
// profile look inactive forever.
export function matches(profile, exts) {
  const on = new Set(profile.on), off = new Set(profile.off);
  const known = exts.filter((e) => on.has(e.id) || off.has(e.id));
  return known.length > 0 && known.every((e) => e.enabled === on.has(e.id));
}

// The changes applying would make, as [id, enabled] pairs.
export function changes(profile, exts) {
  const on = new Set(profile.on), off = new Set(profile.off);
  return exts
    .filter((e) => (on.has(e.id) && !e.enabled) || (off.has(e.id) && e.enabled))
    .map((e) => [e.id, on.has(e.id)]);
}

export async function loadProfiles() {
  try {
    return (await chrome.storage.local.get('profiles')).profiles || [];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles) {
  return chrome.storage.local.set({ profiles });
}
