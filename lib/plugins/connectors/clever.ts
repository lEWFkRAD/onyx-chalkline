import { normalizedBaseUrl, requestJson, type FetchLike } from "./http.ts";

type CleverEnvelope<T> = { data: Array<{ data: T } | T>; links?: Array<{ rel: string; uri: string }> };
export type CleverSection = { id: string; name: string; subject?: string; sis_id?: string };
export type CleverUser = { id: string; name?: { first?: string; last?: string }; email?: string; roles?: Record<string, unknown> };

function unwrap<T>(envelope: CleverEnvelope<T>) {
  return envelope.data.map((item) => ("data" in item ? item.data : item));
}

export class CleverConnector {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetcher: FetchLike;

  constructor(config: { accessToken: string; baseUrl?: string; fetcher?: FetchLike }) {
    this.baseUrl = normalizedBaseUrl(config.baseUrl ?? "https://api.clever.com/v3.0");
    this.accessToken = config.accessToken;
    this.fetcher = config.fetcher ?? fetch;
    if (!this.accessToken) throw new Error("Clever access token is required.");
  }

  private get<T>(path: string) {
    return requestJson<CleverEnvelope<T>>(this.fetcher, "Clever", `${this.baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
    }).then(unwrap);
  }

  listSections() {
    return this.get<CleverSection>("/sections?limit=100");
  }

  listSectionStudents(sectionId: string) {
    return this.get<CleverUser>(`/sections/${encodeURIComponent(sectionId)}/users?role=student&limit=100`);
  }
}
