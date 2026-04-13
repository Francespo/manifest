/**
 * First-run setup status check. Cached per page load so the login page,
 * setup page, and any guards can all ask without spamming the endpoint.
 */
let cachedPromise: Promise<boolean> | null = null;

interface SetupStatusResponse {
  needsSetup: boolean;
}

async function fetchSetupStatus(): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/setup/status', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const data = (await res.json()) as SetupStatusResponse;
    return data.needsSetup === true;
  } catch {
    return false;
  }
}

export function checkNeedsSetup(): Promise<boolean> {
  if (!cachedPromise) {
    cachedPromise = fetchSetupStatus();
  }
  return cachedPromise;
}

/** Invalidate the cached status. Call this after a successful setup. */
export function resetSetupStatus(): void {
  cachedPromise = null;
}

export interface CreateAdminInput {
  email: string;
  name: string;
  password: string;
}

export async function createFirstAdmin(input: CreateAdminInput): Promise<void> {
  const res = await fetch('/api/v1/setup/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let message = `Setup failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(', ');
    } catch {
      // not JSON — use default
    }
    throw new Error(message);
  }
  resetSetupStatus();
}
