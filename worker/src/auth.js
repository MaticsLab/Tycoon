// Better Auth, backed by the `tycoon-auth` D1 database (see migrations/).
//   - email + password sign-up, log in with email or username (username plugin)
//   - "Play now" guests (anonymous plugin); signing up later keeps their village life
//   - bearer tokens (bearer plugin) so the Android app and WebSocket can authenticate
//     without cross-site cookies
import { betterAuth } from 'better-auth';
import { username, anonymous, bearer } from 'better-auth/plugins';

// Origins allowed to call the auth API from another origin: the Capacitor Android
// app (served from http://localhost) and local development servers.
export const NATIVE_ORIGINS = ['http://localhost', 'https://localhost', 'capacitor://localhost', 'http://localhost:5173', 'http://localhost:8787'];

let cached = null;

export function getAuth(env) {
  if (cached?.env === env) return cached.auth;
  const auth = betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: [env.BETTER_AUTH_URL, ...NATIVE_ORIGINS].filter(Boolean),
    emailAndPassword: { enabled: true, minPasswordLength: 6, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 24 * 90, updateAge: 60 * 60 * 24 },
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 16 }),
      anonymous({
        emailDomainName: 'guest.tycoon.village',
        generateName: () => 'Villager',
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await worldStub(env).linkAccount(anonymousUser.user.id, newUser.user.id, { name: newUser.user.name });
        },
      }),
      bearer(),
    ],
  });
  cached = { env, auth };
  return auth;
}

export const worldStub = (env) => env.WORLD.get(env.WORLD.idFromName('main'));

// Resolve a bearer token (the value of the `set-auth-token` header) to a user.
export async function userFromToken(env, token) {
  if (!token) return null;
  const session = await getAuth(env).api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
  return session?.user || null;
}
