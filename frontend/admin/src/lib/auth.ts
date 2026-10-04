export interface TokenClaims {
  role: string;
  exp: number;
}

/**
 * Decode (not verify) the JWT payload in localStorage.token. The browser can't check
 * the RS256 signature; this only decides which screen to show. The backend's
 * require_admin is the real check. Decoding mirrors the player app's isTokenExpired.
 */
export function getTokenClaims(): TokenClaims | null {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.role !== 'string' || typeof payload.exp !== 'number') return null;
    return { role: payload.role, exp: payload.exp };
  } catch {
    return null;
  }
}
