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

The classroom service binds to loopback by default. Cross-device access requires a configured HTTPS origin and private network proxy, or direct TLS; plain non-loopback HTTP is rejected. Individual passwords are salted with scrypt, sessions expire and can be revoked, and assignment/media access is checked against class membership. Keep ignored data directories, bootstrap credentials, SQLite databases, backups, media, logs and provider configuration private. Browser drafts are scoped to the signed-in account but remain on that device until saved or cleared; use trusted devices for this synthetic demo. These controls do not establish readiness for real student records.
