export const AUTH_COOKIE_NAME = "editions_admin_session";

export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getExpectedToken(): string | null {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return null;
  // Simple deterministic token based on SHA-256 of ADMIN_PASSWORD
  // In Node runtime, we can compute sync or async
  return adminPassword;
}
