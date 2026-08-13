import { normalizedBaseUrl, requestJson, type FetchLike } from "./http.ts";

type OneRosterEnvelope<T> = { classes?: T[]; users?: T[]; orgs?: T[] };
export type OneRosterClass = { sourcedId: string; title: string; classCode?: string; school?: { sourcedId: string } };
export type OneRosterUser = { sourcedId: string; givenName: string; familyName: string; email?: string; role?: string };

export class ClassLinkOneRosterConnector {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetcher: FetchLike;

  constructor(config: { oneRosterBaseUrl: string; accessToken: string; fetcher?: FetchLike }) {
    this.baseUrl = normalizedBaseUrl(config.oneRosterBaseUrl);
    this.accessToken = config.accessToken;
    this.fetcher = config.fetcher ?? fetch;
    if (!this.accessToken) throw new Error("ClassLink OneRoster access token is required.");
  }

  private get<T>(path: string) {
    return requestJson<T>(this.fetcher, "ClassLink OneRoster", `${this.baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
    });
  }

  async listClasses() {
    const payload = await this.get<OneRosterEnvelope<OneRosterClass>>("/classes?limit=100&offset=0");
    return payload.classes ?? [];
  }

  async listClassStudents(classSourcedId: string) {
    const payload = await this.get<OneRosterEnvelope<OneRosterUser>>(
      `/classes/${encodeURIComponent(classSourcedId)}/students?limit=100&offset=0`,
    );
    return payload.users ?? [];
  }
}
