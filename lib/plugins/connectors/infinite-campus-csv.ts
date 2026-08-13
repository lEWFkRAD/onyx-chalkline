import { parseCsv, toCsv, type CsvRow } from "../csv.ts";

export type CampusRosterRecord = {
  studentId: string;
  firstName: string;
  lastName: string;
  section: string;
  source: CsvRow;
};

const aliases = {
  studentId: ["student_id", "student_number", "person_id", "sourcedid", "identifier"],
  firstName: ["first_name", "firstname", "given_name", "givenname"],
  lastName: ["last_name", "lastname", "family_name", "familyname"],
  section: ["section", "section_name", "course_section", "class_name"],
};

function firstValue(row: CsvRow, keys: string[]) {
  return keys.map((key) => row[key]).find(Boolean) ?? "";
}

export function importCampusRoster(text: string): CampusRosterRecord[] {
  return parseCsv(text).map((row, index) => {
    const studentId = firstValue(row, aliases.studentId);
    const firstName = firstValue(row, aliases.firstName);
    const lastName = firstValue(row, aliases.lastName);
    if (!studentId || (!firstName && !lastName)) {
      throw new Error(`Roster row ${index + 2} is missing a student identifier or name.`);
    }
    return { studentId, firstName, lastName, section: firstValue(row, aliases.section), source: row };
  });
}

export function exportCampusEvidence(
  rows: Array<{ studentId: string; assignment: string; score: number; comment: string; evidenceReference: string }>,
) {
  return toCsv(
    ["student_number", "assignment", "score", "comment", "chalkline_evidence_reference"],
    rows.map((row) => ({
      student_number: row.studentId,
      assignment: row.assignment,
      score: row.score,
      comment: row.comment,
      chalkline_evidence_reference: row.evidenceReference,
    })),
  );
}
