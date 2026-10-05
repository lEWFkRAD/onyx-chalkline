# Chalkline next stages

The working target is one complete cycle: a teacher approves a lesson, a learner works on it from another device, and the teacher uses the actual questions and work to plan follow-up teaching.

| Stage | Current status | Next acceptance check |
| --- | --- | --- |
| Foundations | v0.2 has one maintained classroom source, native compatibility contract, migrated SQLite records, versioned work, expiring sessions and offline backup/restore. | Rehearse upgrades regularly; keep dependencies and Hermes compatibility current. The separate root evidence demo still needs consolidation. |
| Private connected classroom | v0.2 includes teacher-owned classes, individual student accounts, private HTTPS configuration, assignments, help history, submissions and feedback. | Validate the actual teacher's devices and workflow with fictional learners before deciding school hosting and identity. |
| Broader Lesson Studio | Current HTML and narrated scenes support Grade 3 unit fractions. | Add reviewed worked-math, reading and science templates; editable individual scenes; printable fallback; portable queued video rendering. Check teaching accuracy and accessibility as well as schema validity. |
| Questions into follow-up teaching | Teachers can inspect exact questions/work and make a simple editable follow-up draft. | Add source-linked review queues, teacher-approved small-group practice, catch-up lessons and lesson-plan drafts. Separate observed evidence from AI suggestions. |
| School pilot and integrations | Proposed; no real-student rollout is included. | Agree school identity, retention/deletion, support, accessibility and model evaluation. Run one unit with volunteer teachers, then choose one authorized roster/LMS integration from actual needs. |

Version 0.2 is the first foundation and private-device slice, not completion of every stage. Version 0.4 adds pinned PDF/Word extraction dependencies; its classroom dependency audit reported zero findings at implementation. The older root evidence application's production-only npm audit reported zero findings during this build; its broader development-tool dependency backlog requires separate review. No district connector is live.

The next build should focus on a small reviewed library of lesson formats and a teacher walkthrough of the connected workflow. Avoid expanding integrations before that walkthrough identifies a concrete need.


## College edition: first implementation, 2026-10-04

Version 0.3 adds a separately configured browser edition for fictional college courses. Delivered: course identities and same-instructor multi-course enrollment, statistics and academic-reading formats, instructor-provided excerpts, academic help, editable narration cards, written analysis and feedback. It shares the service core without replacing the school installation.

Next college stages: broader instructor-authored activities; syllabus scheduling and student-material preparation from reviewed source plans; a study plan across enrolled courses; longer-form assessments and instructor rubrics; portable video rendering; and an institution-approved pilot covering identity, academic policy, data lifecycle and accessibility. LMS/SSO and real student records remain outside this demo. See [current scope](../classroom/COLLEGE.md).

## Source Planner: file import and teaching plans, 2026-10-04

Version 0.4 adds private class/course source libraries for PDF, DOCX, TXT and Markdown, extraction review, source-bound AI planning, editable timed steps and adaptations, private save/export, deletion controls and verified backup recovery. First 8,000 characters per selected source are sent to planning; no publisher login, OCR, page-image understanding or automatic assignment generation is included.

Next acceptance checks: walk through a teacher-provided permitted chapter; compare extracted tables and reading order; evaluate source fidelity and useful differentiation; connect approved plans to broader student HTML/video activity templates; then consider OCR and authorized LMS adapters based on that walkthrough.
