// Passcode plumbing for the manager pages. The server only asks for a
// passcode when ADMIN_PASSCODE is set on it, so this stays invisible on an
// open (laptop/LAN) install: the first request succeeds and nobody is asked.
const KEY = 'seatdraft.passcode';

export async function adminFetch(url, options = {}) {
  for (;;) {
    const headers = { ...(options.headers || {}) };
    const saved = sessionStorage.getItem(KEY);
    if (saved) headers['x-admin-passcode'] = saved;

    const res = await fetch(url, { ...options, headers });
    if (res.status !== 401) return res;

    const body = await res.json().catch(() => ({}));
    const entered = prompt(
      body.error === 'bad_passcode'
        ? 'Wrong passcode — try again:'
        : 'This action needs the manager passcode:'
    );
    if (entered === null) return res;   // they cancelled; let the caller show the 401
    sessionStorage.setItem(KEY, entered.trim());
  }
}
