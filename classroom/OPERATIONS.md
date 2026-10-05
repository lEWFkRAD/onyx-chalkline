# Classroom operations

Use Node.js 24.11 or newer. The service has no production npm dependencies. Keep the entire data directory and every backup private: they contain work, authentication records, initial credentials and provider configuration. Maintenance prints counts and status, never tokens or file contents.

## Upgrade and recover

1. Stop the classroom service and wait for video/help jobs to finish. Close any other process using the same data directory. Record the running source revision and configuration.
2. Make and validate a backup in a new sibling directory before migrating the database.
3. Start the new version and check teacher sign-in, an approved lesson, student work and help history before reopening access.
4. To roll back, stop the service, restore the backup into a different empty directory, and point the previous compatible source at that restored directory. Keep the failed data intact. Recheck configuration paths and sign in again.

The parent of each output or restore directory must exist. Source and destination must be separate; nested outputs are rejected. Commands never overwrite an existing backup or populated restore directory.

```sh
node maintenance.mjs backup --data /private/classroom-data --output /private/classroom-backup-20261004
node maintenance.mjs validate --backup /private/classroom-backup-20261004
node maintenance.mjs restore --backup /private/classroom-backup-20261004 --data /private/classroom-restored
```

Run from the classroom source directory. On Windows, quote paths containing spaces. SQLite snapshots include committed WAL data. A SHA-256 manifest covers the database, access.json (legacy), bootstrap.json, identity.json if present, config.json if present, and files below media/. Logs, launch records, locks and WAL/shm files are excluded. Symbolic links are rejected. A failed partial backup has no valid manifest and must not be used.

Restore verifies hashes before copying, checks copied files and SQLite integrity, and revokes restored sessions. Restoring a v1 database is supported; migration happens when the chosen app version opens it. TLS keys and provider environment secrets outside the directory are not copied. Preserve these separately and check paths when moving machines.

Hashes detect accidental changes; only restore backups from storage you control. Backups are not encrypted by this tool. Use protected storage and restrict operating-system access. On Windows, configure a private NTFS ACL; POSIX mode flags alone do not restrict inherited Windows permissions.

## Runtime ownership

The command-line server and maintenance acquire `.runtime-lock.json` before opening data. A second owner is refused. Locks have no age-based expiry. Normal shutdown releases the lock. Maintenance also checks legacy `launch.json` and refuses while its recorded process is alive.

After a crash, confirm every classroom and maintenance process for the directory has stopped, inspect the recorded pid/host, then remove only the stale `.runtime-lock.json` before retrying. Investigate unreadable or foreign-host locks. A recycled pid can conservatively block legacy maintenance; verify the actual process before removing an obsolete launch record. Never remove a live owner's lock.

## Teacher accounts and recovery

There is no public teacher registration endpoint. Stop the service and run the operator command locally. The output must be a new private file; passwords are generated and never printed.

```sh
node accounts.mjs create-teacher --data /private/classroom-data --username alex.teacher --name "Alex Teacher" --output /private/alex-credentials.json
node accounts.mjs reset-teacher --data /private/classroom-data --username teacher --output /private/recovered-credentials.json
```

A reset revokes all teacher sessions. The initial bootstrap file is not updated after password changes; use the recovery output or sign in normally. Share credentials privately, then remove temporary copies according to your operating policy.

## Verification

Run `node --test test/maintenance.test.mjs`. The checks cover ownership refusal, SQLite work/media round trip, restored-session revocation, tamper rejection and refusal to overwrite data. Rehearse restoration with your actual private state before relying on a backup policy.
