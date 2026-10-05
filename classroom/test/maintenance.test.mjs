import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { acquireRuntimeLock, LOCK_FILE } from '../runtime-lock.mjs'
import { createBackup, restoreBackup, validateBackup } from '../maintenance.mjs'
function workspace(t) {
  const parent = resolve(tmpdir()), dir = mkdtempSync(join(parent, 'chalkline-maintenance-'))
  t.after(() => { assert.ok(resolve(dir).startsWith(parent + sep)); assert.match(dir.slice(parent.length + 1), /^chalkline-maintenance-[^\\/]+$/); rmSync(dir, { recursive: true, force: true }) })
  return dir
}
function fixture(root) {
  const data = join(root, 'data')
  mkdirSync(join(data, 'media', 'lesson-1'), { recursive: true })
  const db = new DatabaseSync(join(data, 'classroom.sqlite'))
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE assignments(id TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE work(assignment TEXT, student TEXT, reasoning TEXT, submitted TEXT, feedback TEXT);
    CREATE TABLE help(question TEXT, reply TEXT);
    CREATE TABLE sessions(id TEXT PRIMARY KEY);
    INSERT INTO assignments VALUES('a1','{"revision":1,"title":"Approved lesson"}');
    INSERT INTO work VALUES('a1','student-1','A fourth is bigger','2026-10-04','Explain the equal whole.');
    INSERT INTO help VALUES('Why is a fourth bigger?','Compare the same whole.');
    INSERT INTO sessions VALUES('old-session');`)
  for (const name of ['access.json', 'bootstrap.json', 'config.json']) writeFileSync(join(data, name), JSON.stringify({ fixture: name, secret: 'fixture-only-secret' }))
  writeFileSync(join(data, 'media', 'lesson-1', 'explanation.mp4'), 'immutable-video-fixture')
  writeFileSync(join(data, 'service.log'), 'not part of backup')
  return { data, db }
}
test('runtime lock refuses live, unknown and stale owners without removing their locks', t => {
  const root = workspace(t), data = join(root, 'lock-data'), release = acquireRuntimeLock(data), path = join(data, LOCK_FILE), initial = readFileSync(path, 'utf8')
  assert.throws(() => acquireRuntimeLock(data), { code: 'CLASSROOM_LOCKED' })
  assert.equal(readFileSync(path, 'utf8'), initial)
  release(); release(); assert.equal(existsSync(path), false)
  const stale = JSON.stringify({ host: hostname(), pid: 2147483647, nonce: 'stale' })
  writeFileSync(path, stale); assert.throws(() => acquireRuntimeLock(data), { code: 'CLASSROOM_LOCKED' }); assert.equal(readFileSync(path, 'utf8'), stale)
  writeFileSync(path, '{bad json'); assert.throws(() => acquireRuntimeLock(data), { code: 'CLASSROOM_LOCKED' }); assert.equal(readFileSync(path, 'utf8'), '{bad json')
})
test('snapshot round trip preserves committed WAL work, questions, private files and media, revokes sessions', async t => {
  const root = workspace(t), { data, db } = fixture(root), output = join(root, 'backup'), restored = join(root, 'restored')
  try { await createBackup(data, output) } finally { db.close() }
  const check = await validateBackup(output)
  assert.ok(check.manifest.files.some(f => f.path === 'classroom.sqlite'))
  for (const name of ['service.log', LOCK_FILE, 'classroom.sqlite-wal']) assert.equal(existsSync(join(output, name)), false)
  assert.equal((await restoreBackup(output, restored)).revokedSessions, 1)
  const next = new DatabaseSync(join(restored, 'classroom.sqlite'))
  try {
    assert.equal(next.prepare('SELECT reasoning FROM work').get().reasoning, 'A fourth is bigger')
    assert.equal(next.prepare('SELECT feedback FROM work').get().feedback, 'Explain the equal whole.')
    assert.equal(next.prepare('SELECT question FROM help').get().question, 'Why is a fourth bigger?')
    assert.equal(next.prepare('SELECT count(*) AS n FROM sessions').get().n, 0)
    assert.equal(next.prepare('PRAGMA quick_check').get().quick_check, 'ok')
  } finally { next.close() }
  for (const name of ['access.json', 'bootstrap.json', 'config.json', 'media/lesson-1/explanation.mp4']) assert.deepEqual(readFileSync(join(restored, name)), readFileSync(join(data, name)))
  await validateBackup(output)
})
test('maintenance refuses live or legacy services and never clobbers destinations', async t => {
  const root = workspace(t), { data, db } = fixture(root)
  db.close()
  const output = join(root, 'backup'), release = acquireRuntimeLock(data)
  await assert.rejects(createBackup(data, output), { code: 'CLASSROOM_LOCKED' }); assert.equal(existsSync(output), false)
  release()
  writeFileSync(join(data, 'launch.json'), JSON.stringify({ pid: process.pid }))
  await assert.rejects(createBackup(data, output), { code: 'CLASSROOM_LOCKED' }); unlinkSync(join(data, 'launch.json'))
  await createBackup(data, output)
  await assert.rejects(createBackup(data, output), /new directory/)
  await assert.rejects(restoreBackup(output, data), /new or empty/)
  assert.equal(existsSync(join(data, 'classroom.sqlite')), true)
  await assert.rejects(createBackup(data, join(data, 'nested-backup')), /separate/)
})
test('checksums reject changed media before restore creates a destination', async t => {
  const root = workspace(t), { data, db } = fixture(root)
  db.close()
  const output = join(root, 'backup'), restored = join(root, 'restored')
  await createBackup(data, output)
  writeFileSync(join(output, 'media', 'lesson-1', 'explanation.mp4'), 'tampered-video')
  await assert.rejects(validateBackup(output), /checksum/)
  await assert.rejects(restoreBackup(output, restored), /checksum/)
  assert.equal(existsSync(restored), false)
})
