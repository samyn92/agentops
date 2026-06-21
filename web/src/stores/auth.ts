// Auth store — reactive session state for the console.
// Supports multi-provider GitLab OIDC (gitlab.com + self-hosted instances).
import { createResource } from 'solid-js';
import { authApi, type AuthUser, type AuthProvider } from '../lib/api';

const [authUser, { refetch: refetchAuth }] = createResource<AuthUser>(
  () => authApi.me().catch(() => ({ username: '', authenticated: false }) as AuthUser),
);

const [authProviders] = createResource<AuthProvider[]>(
  () => authApi.providers().catch(() => []),
);

/** Reactive: the current authenticated user (undefined while loading). */
export function currentUser(): AuthUser | undefined {
  return authUser();
}

/** Is the user logged in? */
export function isAuthenticated(): boolean {
  return authUser()?.authenticated === true;
}

/** Is OIDC disabled on the BFF? */
export function isAuthDisabled(): boolean {
  return authUser()?.authDisabled === true;
}

/** Available OAuth providers (for the login picker). */
export function providers(): AuthProvider[] {
  return authProviders() ?? [];
}

/** Are there multiple providers (show picker vs direct redirect)? */
export function hasMultipleProviders(): boolean {
  return (authProviders() ?? []).length > 1;
}

/** The GitLab instance URL for the current session. */
export function currentGitLabURL(): string | undefined {
  return authUser()?.gitlabUrl;
}

/** Redirect to GitLab login. With multiple providers, specify which one. */
export function login(returnTo?: string, provider?: string) {
  authApi.login(returnTo ?? window.location.pathname, provider);
}

/** Log out + reload. */
export function logout() {
  authApi.logout();
}

export { refetchAuth };
