# Source Planner

Source Planner is available in both Chalkline School and College. Teachers can upload a lesson, chapter or teaching guide they are permitted to use—including files exported from publisher resources such as McGraw Hill—and ask the configured AI to plan around that material. This is a file-import workflow; it does not connect to publisher accounts, bypass access controls or synchronize a publisher LMS.

## Teacher workflow

1. Open **Source Planner** in the teacher/instructor workspace.
2. Upload a PDF, DOCX, UTF-8 text or Markdown file. Enter a descriptive title and publisher/author.
3. Select up to three sources. Open the extracted pages or sections and check reading order, tables and missing content.
4. Enter the audience, duration, learning goals and student needs. Confirm the source review and draft a plan.
5. Edit objectives, materials, timed activities, source references, differentiation, assessment, homework and private teaching notes. Step minutes must add up to the lesson duration.
6. Save the private plan or download a text copy with source titles, locations and file fingerprints. Reload retrieves the saved version; stale saves preserve local edits and report a conflict.

Sources and plans are scoped to the teacher-owned class/course. Students cannot retrieve them, and they are not sent to the student tutor. The teacher planning model receives selected extracts. Saving a plan does not publish an assignment or automatically generate a new HTML/video activity; use the existing Lesson/Module Studio separately to prepare reviewed student materials within its supported templates.

## Supported content and limits

| Item | Limit |
| --- | --- |
| File types | PDF, DOCX, TXT, MD |
| Uploaded file | 8 MiB |
| PDF length | 60 pages |
| Extracted text | 90,000 characters per document |
| Class/course library | 24 sources |
| Sources per draft | 1–3 |
| AI source context | First 8,000 extracted characters of each selected source; 24,000 total |
| Lesson duration | 5–240 minutes |
| Teaching sequence | 1–12 editable steps |

PDFs require selectable text. Scanned pages need OCR before upload; Chalkline does not read images, handwriting, diagrams or page layout. Word/text material receives numbered text sections, not original Word page numbers. Larger sources show a partial-context notice; upload the relevant chapter or excerpt to focus drafting on later material. Extraction rejects content over the limits rather than silently saving a shortened document.

Source references must identify existing selected pages/sections. Generated references are restricted to the extracts actually sent to the model. These checks establish location validity, not whether an AI interpretation is correct. Review both activities and references before using the plan.

## Storage and operation

Original uploaded files are processed in memory and discarded. Extracted text, metadata, SHA-256 fingerprints and saved plans live in the private SQLite database and are included in existing verified backups. Do not publish the data directory or backups. Deleting a source removes its current extracted record; existing backups retain their earlier contents. A source used by a saved plan/current draft must be released by clearing the plan before deletion.

A document is parsed in a separate, short-lived Node process, with a 20-second watchdog, a 192 MiB V8 old-heap setting and bounded output. This is not a hard process-RSS limit or a complete OS sandbox. One extraction runs per classroom instance. DOCX archives are checked and streamed before raw-text extraction: at most 2,000 entries and 20 MiB of declared/actual expanded content; unsupported, encrypted, duplicate and unsafe entries are rejected. PDF attachments/scripts and converted document HTML are not executed or published.

Install pinned runtime dependencies before starting a new release:

    cd classroom
    npm ci --omit=dev --ignore-scripts --workspaces=false

Back up and stop the old service before switching its source directory. Install dependencies into the new release directory, not underneath a running service. API version 2 remains compatible; the source/plan tables are additive. The native desktop can use the updated school browser service without a new renderer build.

AI drafting requires the configured model. If a response is unavailable, truncated or invalid, the source remains saved and the UI reports the failure; it does not label a canned plan as AI output. **Start an editable outline** creates a clearly labeled manual outline from the reviewed source selection. Teachers can fill and save that plan without an available AI service.

## Verification

    npm ci --workspaces=false
    node --test --test-concurrency=1 test/*.test.mjs
    npm run test:planner --workspaces=false

Tests include original synthetic PDF/DOCX fixtures, text/Unicode, archive limits, malformed documents, cancellation, source authorization, model context/citation limits, stale saves and backup restoration. The browser workflow covers both editions, real PDF/Word upload, extraction review, AI-stub drafting, editable save/reload/export, source deletion, navigation and mobile width. Real-model checks use a private configuration and original synthetic material; no commercial publisher content is bundled.
