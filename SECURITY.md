# Security policy

## Supported version

Chalkline is an early prototype. The current `main` branch is the only
maintained version.

## Reporting a vulnerability

Do not open a public issue for a security concern. Do not include student
records, roster exports, teacher notes, district URLs, access tokens, API
keys, or any other sensitive information in an issue, pull request, or
repository content.

Report the concern privately to the project maintainer with a minimal,
redacted reproduction. The maintainer will acknowledge the report, assess its
impact, and coordinate a fix before public disclosure.

## Prototype boundary

This repository contains synthetic classroom data only. It is not approved for
FERPA-protected student records. Production use requires district-approved
identity, storage, retention, audit, accessibility, and data-governance
controls.

## Connected classroom demo

The classroom service is loopback-only and uses reusable demo access links. Keep its ignored data directory, access/launch files, SQLite database, media, logs and provider configuration out of public issues and commits. It is not a production identity or student-record system.
