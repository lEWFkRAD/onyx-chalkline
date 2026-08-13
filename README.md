# Onyx Chalkline

Chalkline is a teacher-controlled classroom evidence system. It turns everyday
student work and teacher observations into a source-linked picture of learning,
then helps the teacher prepare the next lesson without replacing the district's
LMS, SIS, roster, or sign-on systems.

## Current product slice

- A custom responsive teacher workspace with Today, Plan, Evidence, Students,
  and Integrations views.
- A complete synthetic Grade 3 mathematics workflow from 18 exit tickets to
  temporary evidence groups and a teacher-reviewed responsive lesson.
- Local teacher observation capture using device storage.
- Portable roster CSV import and evidence CSV export.
- A Canvas-ready JSON lesson package.
- Explicit adapter contracts for Canvas, Infinite Campus, Clever, ClassLink,
  and OneRoster/CSV.
- Visible teacher release gates before assignments, grades, or records leave
  the workspace.

## Northwest Georgia integration baseline

The starter pack is based on public district evidence checked on 13 August
2026:

- Dalton Public Schools publicly lists Canvas, Clever, and Infinite Campus.
- Rome City Schools publicly provides Infinite Campus teacher access.
- Whitfield County's Infinite Campus portal exposes ClassLink SSO.
- Walker County Schools publicly exposes Infinite Campus and Clever.

These references establish regional product fit. They do **not** establish a
vendor partnership, district approval, or live connection. Live Canvas, Clever,
ClassLink, or Infinite Campus access requires the applicable district and vendor
authorization. Chalkline therefore ships a working portable CSV/JSON path while
those approvals are pursued.

## Data boundary

The current build contains synthetic classroom data only. Roster files and
teacher notes stay in the browser on the current device. This is a prototype,
not an approved system for FERPA-protected education records. A district pilot
needs approved identity, storage, retention, audit, accessibility, security,
and data-governance controls before real student information is introduced.

## Local development

Requires Node.js 22.13 or newer.

```powershell
npm install
npm run dev
npm test
```

`npm test` creates the production build, verifies server-rendered product
content, checks the teacher release boundary, validates the regional plugin
registry, and exercises CSV import/export behavior.

## Plugin contract

Plugin metadata lives in `lib/plugins/registry.ts`. Every plugin declares:

- the narrow capabilities it needs;
- whether it works now, uses a file handoff, or needs district setup;
- the administrator setup required for a live connection;
- a portable fallback that keeps teachers moving without fake connectivity.

The product rule is: **read broadly, write narrowly, release deliberately**.

