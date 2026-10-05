# Onyx Chalkline

Chalkline is a teacher-led AI classroom app with a Hermes-based desktop that helps teachers turn lesson ideas into interactive HTML activities, custom narrated videos, and assigned practice. Teachers review and publish lessons, while students use a connected workspace to explore explanations, ask lesson-specific AI questions, complete work, and receive feedback. Teachers can review those questions and replies alongside student submissions to plan follow-up instruction around where learners need support. Version 0.2 adds individual sign-ins, teacher-owned classes, student enrollment, private HTTPS access across devices, and recoverable work with safe retries. The current lesson format is a synthetic Grade 3 fractions demonstration; broader subjects and a school pilot remain future stages.

Two runnable prototypes live here:

| App | What it does | Start |
| --- | --- | --- |
| **Connected classroom** | Teacher Lesson Studio, interactive fraction lessons, narrated videos, student assignments and AI help, teacher question review and feedback | `cd classroom && node server.mjs` |
| **Teacher evidence workspace** | Synthetic evidence groups, local observations, lesson planning and CSV/JSON handoffs | `npm ci && npm run dev` |

**Current scope: synthetic demonstration data only.** The connected classroom starts with a teacher and four fictional learners. Teachers can create additional classes and student accounts, and an operator can add teachers. Private device access is supported; real pupil records, district identity and a school rollout remain outside this release.

## Connected teacher and student workflow

1. Edit a lesson, quiz and narration script, or ask your configured model to draft a new theme.
2. Preview the interactive HTML lesson. On Windows, render a narrated MP4 with captions and a transcript.
3. Review the saved version, choose learners, a due date and the allowed help level, then assign it.
4. Students sign in with their individual accounts, explore the lesson, ask for help, save work and submit answers.
5. Teachers review exact questions and replies, work and submissions, send feedback, and draft follow-up teaching.

Published lessons are immutable snapshots. Private teacher notes and answer keys stay out of student APIs and model context. Students can see that their teacher receives lesson questions. Topic grouping uses simple keyword rules; it does not diagnose or grade children.

![Teacher classroom overview](docs/connected-classroom.png)

![Student lesson and help](docs/student-lesson.png)

### Try it

Requires Node.js 24.11+ (Node 24 recommended). No dependency installation is needed to run the classroom:

```sh
git clone https://github.com/lEWFkRAD/onyx-chalkline.git
cd onyx-chalkline/classroom
node server.mjs
```

Open `http://127.0.0.1:5195` and use the initial teacher credentials in the private `classroom/data/bootstrap.json`. Windows users can run `./Start-Classroom.ps1`. Add learners in **Class & people** and share their generated credentials privately. For access from other devices, configure your private HTTPS origin using the setup guide.

See the **[classroom setup and operating guide](classroom/README.md)** for optional AI configuration, Windows narration requirements, tests, access boundaries and limitations. Keep generated credentials, session links, databases and provider configuration private. Offline backup, validation, restoration and teacher account recovery are documented in the operating guide.

## Hermes desktop edition

The teacher desktop has been brought to Hermes upstream snapshot `16bc0b6b94be7435cb63ed30923fbc7edd53f4c5` and includes a Connected classroom tab. Its separate app identity and `chalkline://` links are preserved.

[Native Chalkline source and build guide](https://github.com/lEWFkRAD/hermes-agent/blob/codex/chalkline-public-20261003/CHALKLINE.md) lives on a dedicated branch of the user-owned Hermes fork. The classroom service in this repository can also run independently of Hermes. No prebuilt desktop installer is included in this update.

## Existing teacher evidence workspace

The original web app remains at the repository root. It includes Today, Plan, Evidence, Students and Integrations views with synthetic Grade 3 mathematics data. Observations are stored in the browser; roster CSV parsing does not replace the displayed demo roster. CSV evidence and lesson JSON are local exports.

```sh
npm ci
npm run dev
npm test
npm run lint
```

The workspace requires Node 22.13+. The connected classroom is a separate application and data store; it does not yet synchronize with the original evidence demo.

## Integration starter pack

Canvas, Clever and ClassLink connectors have mock-backed contract tests. Infinite Campus and OneRoster use CSV/file handoffs. They are not wired to a live district tenant. See the [integration matrix](docs/NWGA-INTEGRATION-MATRIX.md) for capabilities and setup assumptions. Vendor and district names do not imply endorsement or authorization.

See [the staged roadmap](docs/ROADMAP.md) for what this release completes and what comes next.

## Before a school pilot

The private demo includes class authorization, expiring sessions, password resets and offline recovery. District identity, retention/deletion, operational monitoring, accessibility and model/pedagogical evaluation still need school-specific implementation and validation. This prototype is not approved for real student records. Teacher-controlled review remains central to the workflow.

## License

Licensed under [Apache-2.0](LICENSE). The separate Hermes-derived native repository retains its own upstream license and notices.
