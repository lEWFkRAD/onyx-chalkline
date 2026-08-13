# Northwest Georgia teacher-tool integration matrix

Checked: 13 August 2026

| Tool | Public regional evidence | Chalkline v0.1 path | Live path requirement |
| --- | --- | --- | --- |
| Canvas | Dalton High School's official student resources list Canvas | Teacher-reviewed lesson JSON package | District Canvas base URL plus approved LTI 1.3 registration or developer key |
| Infinite Campus | Official Rome City teacher link; official Dalton listing; official Whitfield and Walker portals | Roster import and evidence/gradebook CSV export with preview | District-approved Campus integration and exact data-exchange scope |
| Clever | Official Dalton listing and Walker school portal listing | OneRoster/CSV fallback | District Clever app approval and scoped roster permissions |
| ClassLink | Official Whitfield Infinite Campus portal offers ClassLink SSO | OneRoster/CSV fallback | District ClassLink assignment, SSO configuration, and OneRoster scope |
| OneRoster/CSV | Portable interoperability path | Works locally now | Column mapping and district data-governance approval for real records |

## Product claim boundary

“Supported” means Chalkline has an adapter contract and a functional portable
handoff. It does not mean Onyx has a commercial partnership, district tenant,
production credential, or permission to process student records.

## Authoritative public sources

- Dalton High School student resources: <https://www.daltonpublicschools.com/o/dhs/page/student-resources>
- Rome City Schools Infinite Campus: <https://www.rcs.rome.ga.us/page/infinite-campus>
- Whitfield County Schools Campus portal: <https://campus.whitfield.k12.ga.us/campus/portal/students/whitfield.jsp>
- Walker County / LaFayette Middle student resources: <https://lms.walkerschools.org/students>
- Walker County Campus portal: <https://campus.walkerschools.org/campus/portal/parents/walker.jsp>

## Next implementation increments

1. Interview a Northwest Georgia teacher and district instructional-technology
   owner; replace assumed workflow details with observed practice.
2. Obtain a district-approved synthetic sandbox and select the first live
   integration—Canvas LTI or OneRoster is the likely lowest-friction pilot.
3. Add district-owned identity and role mapping.
4. Add encrypted, tenant-isolated persistence plus retention and deletion
   controls before any real student evidence is introduced.
5. Add accessibility evaluation with teacher keyboard, screen-reader, and
   classroom-device testing.
6. Pilot the exit-ticket-to-tomorrow workflow against a manual baseline and
   measure time saved, teacher edit rate, unsupported claims, and post-reteach
   student performance.

