// Safe relative redirect handling for the self-hosted Better Auth sign-in flow.
export const SIGN_IN_PATH = "/sign-in";

// Only allow same-app relative paths as post-login redirects; anything absolute,
// protocol-relative, or pointing back at the sign-in page falls back to "/".
export function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (url.pathname === SIGN_IN_PATH) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

export function signInPath(returnTo: string): string {
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}
