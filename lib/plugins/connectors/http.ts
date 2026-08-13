export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ConnectorError extends Error {
  readonly status: number;
  readonly provider: string;

  constructor(provider: string, status: number, detail: string) {
    super(`${provider} request failed (${status}): ${detail}`);
    this.name = "ConnectorError";
    this.status = status;
    this.provider = provider;
  }
}

export function normalizedBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Connector base URLs must use HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

export async function requestJson<T>(
  fetcher: FetchLike,
  provider: string,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetcher(url, init);
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 240) || response.statusText || "Unknown error";
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      detail = parsed.message ?? parsed.error ?? detail;
    } catch {
      // Preserve the bounded text response.
    }
    throw new ConnectorError(provider, response.status, detail);
  }
  return (text ? JSON.parse(text) : null) as T;
}

