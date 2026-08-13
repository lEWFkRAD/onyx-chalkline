import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, toCsv } from "../lib/plugins/csv.ts";
import { chalklinePlugins, getPlugin } from "../lib/plugins/registry.ts";
import { CanvasConnector } from "../lib/plugins/connectors/canvas.ts";
import { CleverConnector } from "../lib/plugins/connectors/clever.ts";
import { ClassLinkOneRosterConnector } from "../lib/plugins/connectors/classlink.ts";
import { exportCampusEvidence, importCampusRoster } from "../lib/plugins/connectors/infinite-campus-csv.ts";

test("NWGA plugin registry exposes the verified regional starter pack", () => {
  assert.deepEqual(
    chalklinePlugins.map((plugin) => plugin.id),
    ["canvas", "infinite-campus", "clever", "classlink", "oneroster-csv"],
  );
  assert.equal(getPlugin("oneroster-csv")?.status, "ready");
  assert.equal(getPlugin("canvas")?.status, "district_setup");
  assert.ok(getPlugin("infinite-campus")?.capabilities.includes("gradebook.write"));
});

test("CSV adapter parses common SIS exports including quoted names", () => {
  const rows = parseCsv('student_id,student_name,section\r\n101,"Watts, Jamie",Math 3\r\n102,Alex Kim,Math 3');
  assert.deepEqual(rows, [
    { student_id: "101", student_name: "Watts, Jamie", section: "Math 3" },
    { student_id: "102", student_name: "Alex Kim", section: "Math 3" },
  ]);
});

test("CSV adapter safely escapes evidence exports", () => {
  const csv = toCsv(["student", "evidence"], [{ student: "Watts, Jamie", evidence: 'Said "one fourth"' }]);
  assert.equal(csv, 'student,evidence\r\n"Watts, Jamie","Said ""one fourth"""');
});

test("Canvas connector lists teacher courses and creates only unpublished assignments", async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url: String(url), init });
    if (init.method === "GET") return Response.json([{ id: 7, name: "Math 3" }]);
    return Response.json({ id: 91, name: "Fraction check", published: false });
  };
  const canvas = new CanvasConnector({ baseUrl: "https://district.instructure.com", accessToken: "test-token", fetcher });

  assert.equal((await canvas.listTeacherCourses())[0].name, "Math 3");
  const assignment = await canvas.createUnpublishedAssignment(7, {
    name: "Fraction check",
    descriptionHtml: "<p>Explain your reasoning.</p>",
    pointsPossible: 2,
  });

  assert.equal(assignment.published, false);
  assert.match(requests[0].url, /api\/v1\/courses\?enrollment_type=teacher/);
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-token");
  const body = JSON.parse(requests[1].init.body);
  assert.equal(body.assignment.published, false);
  assert.equal(body.assignment.submission_types[0], "on_paper");
});

test("Clever connector uses v3 section and role-filtered student endpoints", async () => {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(String(url));
    return Response.json({ data: [{ data: { id: "sec-1", name: "Math 3" } }] });
  };
  const clever = new CleverConnector({ accessToken: "clever-token", fetcher });
  assert.equal((await clever.listSections())[0].id, "sec-1");
  await clever.listSectionStudents("sec-1");
  assert.equal(urls[0], "https://api.clever.com/v3.0/sections?limit=100");
  assert.equal(urls[1], "https://api.clever.com/v3.0/sections/sec-1/users?role=student&limit=100");
});

test("ClassLink connector reads district-scoped OneRoster classes and students", async () => {
  const urls = [];
  const fetcher = async (url, init) => {
    urls.push(String(url));
    assert.equal(init.headers.Authorization, "Bearer classlink-token");
    if (String(url).includes("/students")) return Response.json({ users: [{ sourcedId: "stu-1", givenName: "Maya", familyName: "B" }] });
    return Response.json({ classes: [{ sourcedId: "class-1", title: "Math 3" }] });
  };
  const classlink = new ClassLinkOneRosterConnector({
    oneRosterBaseUrl: "https://district.example.org/ims/oneroster/v1p1",
    accessToken: "classlink-token",
    fetcher,
  });
  assert.equal((await classlink.listClasses())[0].title, "Math 3");
  assert.equal((await classlink.listClassStudents("class-1"))[0].givenName, "Maya");
  assert.match(urls[0], /\/classes\?limit=100&offset=0$/);
  assert.match(urls[1], /\/classes\/class-1\/students\?limit=100&offset=0$/);
});

test("Infinite Campus file adapter maps common roster aliases and exports evidence references", () => {
  const roster = importCampusRoster("student_number,first_name,last_name,section_name\n1001,Maya,B,Math 3");
  assert.deepEqual(roster[0], {
    studentId: "1001",
    firstName: "Maya",
    lastName: "B",
    section: "Math 3",
    source: { student_number: "1001", first_name: "Maya", last_name: "B", section_name: "Math 3" },
  });
  const exported = exportCampusEvidence([{ studentId: "1001", assignment: "Exit ticket", score: 1, comment: "Review denominator", evidenceReference: "ticket-04" }]);
  assert.match(exported, /^student_number,assignment,score,comment,chalkline_evidence_reference/);
  assert.match(exported, /1001,Exit ticket,1,Review denominator,ticket-04/);
});
