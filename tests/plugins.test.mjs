import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, toCsv } from "../lib/plugins/csv.ts";
import { chalklinePlugins, getPlugin } from "../lib/plugins/registry.ts";

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

