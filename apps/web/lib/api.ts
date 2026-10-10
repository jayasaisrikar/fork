export const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL ?? 'http://localhost:8790';

let csrfToken = '';
export const setCsrf = (token: string) => (csrfToken = token);

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ENGINE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(
      'ENGINE_UNREACHABLE',
      0,
      "The FORK engine didn't respond. Nothing was changed. Check that it is running.",
    );
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiFailure(
      json.code ?? 'ERROR',
      response.status,
      json.message ?? `Request failed (${response.status})`,
      json.details,
    );
  }
  return json as T;
}
