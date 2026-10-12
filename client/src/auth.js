// Talks to Better Auth on the game server using bearer tokens (works the same in
// the browser and in the Android app, where cookies would be cross-site).
export function httpBase(wsUrl) {
  return new URL(wsUrl.replace(/^ws/, 'http')).origin;
}

export async function authCall(base, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${base}/api/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(friendly(data?.code, data?.message) || `Sign-in failed (${res.status})`);
  return { data, token: res.headers.get('set-auth-token') };
}

function friendly(code, message) {
  const map = {
    INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password',
    INVALID_USERNAME_OR_PASSWORD: 'Wrong username or password',
    USERNAME_IS_ALREADY_TAKEN: 'That username is taken',
    USERNAME_IS_ALREADY_TAKEN_PLEASE_TRY_ANOTHER: 'That username is taken',
    USER_ALREADY_EXISTS: 'An account with that email already exists',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with that email already exists',
    PASSWORD_TOO_SHORT: 'Passwords need at least 6 characters',
    USERNAME_TOO_SHORT: 'Usernames need at least 3 characters',
    USERNAME_TOO_LONG: 'Usernames can be at most 16 characters',
    INVALID_USERNAME: 'Usernames can use letters, numbers, _ and .',
    INVALID_EMAIL: 'That email doesn’t look right',
  };
  return map[code] || message;
}

export const signInGuest = (base) => authCall(base, '/sign-in/anonymous', {});

export function signIn(base, login, password, guestToken) {
  const body = login.includes('@') ? { email: login, password } : { username: login, password };
  return authCall(base, login.includes('@') ? '/sign-in/email' : '/sign-in/username', body, guestToken);
}

// With a guest token, Better Auth links the guest to the new account (village life carries over).
export function signUp(base, { email, username, password, name }, guestToken) {
  return authCall(base, '/sign-up/email', { email, username, password, name: name || username }, guestToken);
}

export async function getSession(base, token) {
  const { data } = await authCall(base, '/get-session', undefined, token);
  return data;
}

export const signOut = (base, token) => authCall(base, '/sign-out', {}, token).catch(() => null);
