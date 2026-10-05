# Chalkline connected classroom 0.4

**College edition:** see [Chalkline College](COLLEGE.md) for separate course data, statistics and academic-reading modules, and its own launcher. The school workflow below remains supported.

One shared classroom service for the teacher desktop and student browsers. Teachers create classes, enroll synthetic learners, review lessons and assign work. Students sign in individually, explore the lesson, ask for help, save or submit work and receive teacher feedback.

The first shared release remains a **synthetic-data prototype for one school installation**. It supports multiple teacher-owned classes; it is not yet an approved real-student or multi-school service. Visual lessons currently cover Grade 3 unit fractions. Narrated video rendering currently uses Windows.

## Start on this computer

Requires Node.js 24.11 or newer. Install the pinned PDF/Word text parsers:

```sh
cd classroom
npm ci --omit=dev --ignore-scripts --workspaces=false
node server.mjs
```

Open `http://127.0.0.1:5195`. Initial randomly generated teacher and demo-student credentials are stored in the private `data/bootstrap.json` file. Keep that file and the entire data directory out of Git, public issues and shared screenshots. Sign in with the teacher username and password, then create a class or use the four initial fictional learners. A school operator controls this installation; there is no public self-registration or way to request a teacher role from the browser.

On Windows, `./Start-Classroom.ps1` starts a hidden service and opens the sign-in page. `-TeacherSession` opens a short-lived teacher session using the locally stored initial credentials; once the password changes, sign in normally. The launcher also accepts `-DataDirectory`, `-ConfigPath`, `-Port` and `-NoBrowser`, and checks that an existing process belongs to the selected data directory.

## Source Planner

Both editions include [Source Planner](SOURCE-PLANNER.md): upload PDF, DOCX, TXT or Markdown teaching material, review the extracted text, and draft an editable private plan around selected sources. Adapt pacing, activities, differentiation, assessment and homework. Source documents and plans stay teacher-private; reviewed student materials are prepared separately in Lesson/Module Studio.

## First shared classroom cycle

1. Sign in as a teacher. Create a class, then add a learner with a name and unique username. Share the displayed generated password privately; reset it if it is lost.
2. In Lesson Studio, edit the explanation, narration scenes, quiz and private teaching notes. Save and preview the current version.
3. Optionally make a narrated video. Review the exact saved lesson, answer key and any included media, then assign it to selected class members with a due date and help policy.
4. The learner signs in from their browser. They can explore the HTML activity, watch the video, ask lesson-specific questions, save an answer or turn it in.
5. Review the learner's submitted work and actual questions/replies. Send feedback or draft a follow-up lesson.

Class membership is enforced for every assignment, asset and work request. Published lesson versions remain unchanged after later edits. Teacher notes and answer keys never enter student responses or tutor context. Removing a learner or resetting a password revokes their existing sessions. Signing out revokes the current session; changing a password ends all sessions for that account.

Students can see that teachers receive their lesson questions and replies. Topic groupings use keyword rules and are not diagnoses, grades or measures of ability.

## Private access across devices

Keep the service on loopback and place an authenticated private-network HTTPS proxy in front of it. In the private config, pin the browser origin:

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 5195,
    "publicOrigin": "https://your-private-host.example:8460"
  }
}
```

The proxy must preserve the configured Host header. Client-supplied forwarding headers do not grant authority. The local address remains usable by the desktop client. A device also needs network access to the private endpoint; a classroom username alone does not grant private-network membership.

For a Tailscale installation, [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) can terminate HTTPS and proxy to `http://127.0.0.1:5195`. Inspect existing Serve configuration and choose a free port before adding a route. Use Serve for the private demo, not Funnel. This repository does not change any network routing automatically.

Alternatively, direct HTTPS is supported with `server.host` set to the selected interface IP and `server.tls` containing `certFile` and `keyFile` paths. An explicit HTTPS `publicOrigin` is required. Plain HTTP listening on a non-loopback interface is rejected. Store certificates, private keys and provider credentials outside the repository and restrict access to the data directory.

## AI and video

Copy `config.example.json` to the private data directory, supply your approved AI endpoint/model if desired, and restart. Use the `CHALKLINE_AI_KEY` environment variable only if that endpoint requires a secret. With no provider, authoring, assignments and saved lesson hints remain usable; AI drafting reports that it is unavailable. Model calls have no Hermes tools. Student help uses only the assigned public lesson and that student's recent exchanges; teacher planning uses the explicitly selected private source extracts. Calls within the service are serialized; unavailable or busy AI produces an explicitly labeled saved hint.

Windows narration requires System.Speech and FFmpeg with libx264, AAC, drawtext and drawbox support. Configure executable paths through the private `media` settings when they are not on PATH. A render produces an MP4, WebVTT captions and a transcript. Only media attached to an assigned reviewed version is available to its learners. Linux/macOS can host the remaining classroom workflows.

## Recovery and upgrading

Read [OPERATIONS.md](OPERATIONS.md) for offline backup, validation and restoration. Stop the classroom and back up its state before upgrading. Restores use a new empty destination and require a fresh sign-in.

Version 0.2 migrates v1 draft, assignment, membership, work, feedback, help and media records. Existing permanent access links stop working; the private bootstrap file provides the new initial sign-ins. Keep the old version and its pre-upgrade backup available for rollback. Never point an older binary at a migrated database.

Work saves are versioned. Stale edits return a conflict instead of overwriting newer work. Publishing, submitting work and help requests use request IDs, so repeating an ambiguous request does not create duplicate assignments, submissions or questions. A changed request cannot reuse the same ID. The student browser preserves unfinished answers for retry and clearly distinguishes browser drafts from work saved to the classroom.

## Source and verification

This `classroom/` directory is the maintained service source. The Hermes desktop connects to its API and browser UI; it does not need a second implementation of the classroom database or tutor. The older root evidence demo is separate historical product exploration.

```sh
npm ci --workspaces=false
npm test --workspaces=false
npx --workspaces=false playwright install chromium
npm run test:browser --workspaces=false
# Windows with FFmpeg:
npm run test:media --workspaces=false
```

Tests cover actual HTTP access boundaries, reviewed snapshots, retry behavior, password/session revocation, private model context, migration preservation, backup/restore and the teacher/student browser workflow. Live model quality, physical-device behavior and school readiness require their own validation.

Before real pupils: the responsible school must settle identity and data responsibilities, retention/deletion, accessibility, model/content evaluation, incident support and deployment operations. No district connection or real-student approval is implied by this release.
