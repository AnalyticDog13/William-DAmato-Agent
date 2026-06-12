const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

export function getToken(): string {
  return localStorage.getItem("william_token") ?? "";
}
export function setToken(token: string): void {
  localStorage.setItem("william_token", token);
}
export function clearToken(): void {
  localStorage.removeItem("william_token");
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${getToken()}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { error?: string }).error ?? detail;
    } catch { /* not json */ }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const apiBase = API_BASE;
