# Chalkline College

A private course workspace for college instructors and students. It shares the maintained classroom service, authentication and recovery code with the school edition while using its own data directory, accounts, teaching formats and interface.

## Included in this first college edition

- Instructor-owned courses and individual student sign-ins. Enroll an existing student in another course you own without changing their password.
- Module Studio: course code, module/week, suggested study time, explanation, three narration scenes, assessment and private instructor notes.
- Up to three instructor-supplied readings with excerpts and optional HTTPS references. Linked pages are not fetched by the model.
- Introductory statistics lab: twelve explicitly fictional observations, scatterplot, temperature grouping, calculated Pearson correlation, group means and accessible data table. Pooled r is approximately 0.943; within each constructed group it is zero. The activity distinguishes association from causal evidence.
- Academic close-reading seminar: editable passage and an analysis checklist.
- Controlled HTML export and Windows narration producing an MP4, captions and full transcript. College videos use academic text cards.
- Reviewed, immutable assignments, due dates, saved written analysis, submissions, instructor feedback and exact course-help questions/replies. Browser drafts and safe retries reuse the classroom recovery path.
- College tutoring supports students' own reasoning. Instructors choose hints, separate worked examples, or instructor-only questions. AI availability and saved fallback hints are labeled. Students see that instructors can review their course-help conversations.

## Run locally

Requires Node 24.11+. Running the server needs no npm dependencies.

Windows:

~~~powershell
cd classroom
.\Start-College.ps1 -InstructorSession
~~~

Or from any supported server OS:

~~~sh
node server.mjs --data ./data-college --config ./config.college.example.json --port 5196
~~~

Open http://127.0.0.1:5196. Initial instructor and four fictional student credentials are created in the private data-college/bootstrap.json. Do not commit or share that file publicly. The Windows launcher opens an expiring instructor session when requested; ordinary sign-in works after the initial password changes.

Keep school and college data separate. The service records the edition in new databases and refuses an incompatible edition before changing the existing database. The example config has no provider or secrets. Copy it to the private data directory before adding approved AI or media settings.

## First walkthrough

1. Open Module Studio, edit the statistics explanation and save. Preview all-days and temperature-grouped views.
2. Optionally make a narrated video. Review the saved module, answer key and video, choose students and a due date, then assign.
3. Sign in as a fictional student in another browser. Inspect the data, ask a conceptual question, save an analysis and submit.
4. Review the exact question and response beside the student's work. Send instructor feedback.
5. Create a writing course using Academic close reading. Enroll the same student by username. Edit the reading, save, preview and assign. The student can switch courses with the same account.

AI drafting uses saved modules and readings. Unsaved college edits must be saved first. AI drafts stay within either controlled format; statistics data and calculations remain fixed. Instructors must review facts and references. Checklist ticks inside an exploration are temporary; written analysis is the saved record.

## Private device access and recovery

Follow [the shared operating guide](README.md#private-access-across-devices) using a separate local port and private HTTPS origin. The repository never modifies network routes automatically. College and school can run side by side; private-network membership does not replace app sign-in.

[Backup and restore](OPERATIONS.md) include edition metadata, accounts, lessons and media. Stop only the target instance before maintenance. Operator account recovery uses the shared CLI with --edition college:

~~~sh
node accounts.mjs reset-teacher --edition college --data /private/college-data --username instructor --output /private/new-college-login.json
~~~

The native Hermes teacher edition remains on its separately pinned classroom release. This college release is a browser app usable from instructor and student devices. It does not replace the existing school desktop installation.

## Verification and scope

~~~sh
npm ci --workspaces=false
npm test --workspaces=false
npx --workspaces=false playwright install chromium
npm run test:college --workspaces=false
# Windows, with configured FFmpeg:
npm run test:college-media --workspaces=false
~~~

Tests cover edition/credential isolation, ownership-limited enrollment, validation, HTML escaping, private-field omission, exact dataset calculations and media routing. The browser check covers statistics, edited readings, saved work, help, submission, feedback, two-course enrollment and mobile width.

This working demonstration uses fictional courses and students. No university LMS deployment, automated grading, plagiarism detection or learning-gain evidence is implied. Syllabus/PDF ingestion, institution SSO, gradebooks and LMS synchronization are future work. Narration currently requires Windows. Institution-specific identity, retention/deletion, accessibility evaluation and academic policy work remain before use with real student records.
