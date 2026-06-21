// Auth store — reactive session state for the console.
// Fetches /auth/me on mount; exposes the user identity + login/logout actions.
// When OIDC is disabled on the BFF, authDisabled is true and the UI hides
// the login button (backward-compatible: everything works, just unsigned).
import { createSignal, createResource } from 'solid-js';
import { authApi, type AuthUser } from '../lib/api';

const [authUser, { refetch: refetchAuth }] = createResource<AuthUser>(
  () => authApi.me().catch(() => ({ username: '', authenticated: false }) as AuthUser),
);

/** Reactive: the current authenticated user (null while loading). */
export function currentUser(): AuthUser | undefined {
  return authUser();
}

/** Is the user logged in? (false while loading or if not authed). */
export function isAuthenticated(): boolean {
  return authUser()?.authenticated === true;
}

/** Is OIDC disabled on the BFF (env vars absent)? */
export function isAuthDisabled(): boolean {
  return authUser()?.authDisabled === true;
}

/** Redirect to GitLab login. */
export function login(returnTo?: string) {
  authApi.login(returnTo ?? window.location.pathname);
}

/** Log out + reload. */
export function logout() {
  authApi.logout();
}

export { refetchAuth };
