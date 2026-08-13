import { normalizedBaseUrl, requestJson, type FetchLike } from "./http.ts";

export type CanvasCourse = { id: string | number; name: string; course_code?: string };
export type CanvasAssignment = { id: string | number; name: string; published: boolean; html_url?: string };

export type ChalklineLessonDraft = {
  name: string;
  descriptionHtml: string;
  pointsPossible?: number;
  dueAt?: string;
  submissionTypes?: Array<"none" | "on_paper" | "online_text_entry" | "online_upload" | "online_url">;
};

export class CanvasConnector {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetcher: FetchLike;

  constructor(config: { baseUrl: string; accessToken: string; fetcher?: FetchLike }) {
    this.baseUrl = normalizedBaseUrl(config.baseUrl);
    this.accessToken = config.accessToken;
    this.fetcher = config.fetcher ?? fetch;
    if (!this.accessToken) throw new Error("Canvas access token is required.");
  }

  private headers() {
    return { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" };
  }

  listTeacherCourses() {
    const query = new URLSearchParams({ enrollment_type: "teacher", enrollment_state: "active", per_page: "100" });
    return requestJson<CanvasCourse[]>(this.fetcher, "Canvas", `${this.baseUrl}/api/v1/courses?${query}`, {
      method: "GET",
      headers: this.headers(),
    });
  }

  createUnpublishedAssignment(courseId: string | number, lesson: ChalklineLessonDraft) {
    const assignment = {
      name: lesson.name,
      description: lesson.descriptionHtml,
      points_possible: lesson.pointsPossible ?? 0,
      submission_types: lesson.submissionTypes ?? ["on_paper"],
      due_at: lesson.dueAt,
      published: false,
    };

    return requestJson<CanvasAssignment>(
      this.fetcher,
      "Canvas",
      `${this.baseUrl}/api/v1/courses/${encodeURIComponent(String(courseId))}/assignments`,
      {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ assignment }),
      },
    );
  }
}
