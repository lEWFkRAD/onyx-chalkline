import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClassroomStore } from '../store.mjs'
import { seedLesson } from '../lesson.mjs'
const fails = (fn, status) => assert.throws(fn, e => e.status === status)
async function fixture(t, before, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalkline-store-v2-'))
  if (before) await before(dir)
  const ctx = { dir, store: new ClassroomStore(dir, options) }
  t.after(async () => {
    ctx.store.close()
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected temporary path')
    await rm(dir, { recursive: true, force: true })
  })
  ctx.login = async credentials => { const result = await ctx.store.login(credentials); return { ...result, p: ctx.store.principal(result.token) } }
  ctx.teacher = await ctx.login(ctx.store.bootstrap.teacher)
  ctx.maya = await ctx.login(ctx.store.bootstrap.students.find(s => s.id === 'maya'))
  return ctx
}
const publish = (s, p, overrides = {}) => {
  const draft = s.draft(p)
  return s.publish(p, { classId: draft.classId, revision: draft.revision, students: ['maya'], due: '2026-12-10', mode: 'hints', reviewed: true, requestId: randomUUID(), ...overrides })
}
test('v1 migration preserves snapshots, work, questions, feedback, media and draft while retiring bearer links', async t => {
  const legacyLesson = { ...seedLesson, title: 'Reviewed legacy lesson' }, draftLesson = { ...seedLesson, title: 'Next draft' }
  const ctx = await fixture(t, async dir => {
    await writeFile(join(dir, 'access.json'), JSON.stringify({ teacher: 't'.repeat(43), students: [{ id: 'maya', name: 'Maya B.', token: 'm'.repeat(43) }] }))
    const db = new DatabaseSync(join(dir, 'classroom.sqlite'))
    db.exec(`CREATE TABLE draft(id INTEGER PRIMARY KEY,revision INTEGER,body TEXT); CREATE TABLE assignments(id TEXT PRIMARY KEY,title TEXT,body TEXT,revision INTEGER,due TEXT,mode TEXT,created TEXT,media TEXT); CREATE TABLE memberships(assignment TEXT,student TEXT,PRIMARY KEY(assignment,student)); CREATE TABLE work(assignment TEXT,student TEXT,answer INTEGER,reasoning TEXT,submitted TEXT,feedback TEXT,PRIMARY KEY(assignment,student)); CREATE TABLE help(id TEXT PRIMARY KEY,assignment TEXT,student TEXT,question TEXT,reply TEXT,engine TEXT,topic TEXT,created TEXT); CREATE TABLE media(revision INTEGER PRIMARY KEY,status TEXT,detail TEXT,asset TEXT);`)
    db.prepare('INSERT INTO draft VALUES(1,8,?)').run(JSON.stringify(draftLesson))
    db.prepare('INSERT INTO assignments VALUES(?,?,?,?,?,?,?,?)').run('legacy', legacyLesson.title, JSON.stringify(legacyLesson), 3, '2026-12-10', 'hints', '2026-10-01T12:00:00.000Z', 'lesson-3')
    db.exec("INSERT INTO memberships VALUES('legacy','maya'); INSERT INTO work VALUES('legacy','maya',0,'Equal whole, fewer parts.','2026-10-01T12:10:00.000Z','Explain the drawing.'); INSERT INTO help VALUES('help-legacy','legacy','maya','Why sixths?','Compare equal wholes.','saved-hint','Fractions','2026-10-01T12:05:00.000Z'); INSERT INTO media VALUES(3,'ready','Complete','lesson-3'); INSERT INTO media VALUES(10,'error','Interrupted',NULL);")
    db.close()
  })
  const { store: s, teacher, maya } = ctx
  assert.equal(s.principal('t'.repeat(43)), null); assert.equal(s.principal('m'.repeat(43)), null)
  const state = s.state(teacher.p), learner = s.state(maya.p)
  assert.equal(state.draft.revision, 8); assert.equal(state.draft.lesson.title, draftLesson.title)
  assert.deepEqual(state.students.map(x => x.id).sort(), ['ava', 'eli', 'luis', 'maya'])
  assert.equal(learner.assignments[0].title, legacyLesson.title)
  assert.equal(learner.assignments[0].work[0].feedback, 'Explain the drawing.')
  assert.equal(learner.assignments[0].work[0].submitted, '2026-10-01T12:10:00.000Z')
  assert.equal(learner.assignments[0].help[0].id, 'help-legacy')
  assert.equal(s.canAccessAsset(maya.p, 'lesson-3'), true)
  const a = s.assignment('legacy', maya.p)
  assert.equal(a.body, undefined); assert.equal(a.lesson.correctIndex, undefined); assert.equal(a.lesson.teacherNotes, undefined)
  assert.ok(s.save(teacher.p, { classId: state.currentClassId, lesson: draftLesson, revision: 8 }).revision > 10)
  const bootstrapBefore = await readFile(join(ctx.dir, 'bootstrap.json'), 'utf8')
  s.close(); ctx.store = new ClassroomStore(ctx.dir)
  assert.equal(await readFile(join(ctx.dir, 'bootstrap.json'), 'utf8'), bootstrapBefore)
  assert.equal(ctx.store.state(ctx.store.principal(maya.token)).assignments[0].help.length, 1)
  assert.equal(ctx.store.db.prepare('PRAGMA user_version').get().user_version, 2)
})
test('classes, drafts, assets and enrollment remain isolated between teachers', async t => {
  const { store: s, teacher, maya, login } = await fixture(t)
  s.createTeacher({ name: 'Second Teacher', username: 'second-teacher', password: 'Correct-horse-2026-staple' })
  const second = await login({ username: 'second-teacher', password: 'Correct-horse-2026-staple' })
  const firstState = s.state(teacher.p), otherState = s.state(second.p)
  assert.notEqual(otherState.currentClassId, firstState.currentClassId)
  assert.notEqual(otherState.draft.revision, firstState.draft.revision)
  const revision = firstState.draft.revision, classId = firstState.currentClassId
  s.saveMedia(teacher.p, { classId, revision, status: 'rendering', detail: 'Started' })
  s.save(teacher.p, { classId, revision, lesson: { ...seedLesson, title: 'Newer draft' } })
  s.saveMedia(teacher.p, { classId, revision, status: 'ready', detail: 'Finished after newer save', asset: 'lesson-' + revision })
  assert.equal(s.canAccessAsset(teacher.p, 'lesson-' + revision), true)
  assert.equal(s.canAccessAsset(second.p, 'lesson-' + revision), false)
  assert.equal(s.canAccessAsset(maya.p, 'lesson-' + revision), false)
  const { id } = publish(s, teacher.p)
  for (const fn of [() => s.state(second.p, classId), () => s.assignment(id, second.p), () => s.getMedia(second.p, { classId, revision }), () => s.resetStudent(second.p, { classId, studentId: 'maya' }), () => s.feedback(second.p, { assignmentId: id, studentId: 'maya', feedback: 'No' })]) fails(fn, 404)
  fails(() => s.publish(second.p, { classId: otherState.currentClassId, revision: otherState.draft.revision, students: ['maya'], due: '2026-12-10', mode: 'hints', reviewed: true, requestId: randomUUID() }), 400)
  assert.equal(s.state(second.p).assignments.length, 0)
})
test('expiry, logout, password changes, resets and removal revoke access without deleting history', async t => {
  let now = Date.parse('2026-10-04T12:00:00Z')
  const ctx = await fixture(t, null, { now: () => now, sessionTtlMs: 1000 })
  const { store: s, teacher, maya } = ctx
  assert.equal(s.principal(maya.token).id, 'maya')
  assert.notEqual(s.db.prepare('SELECT * FROM sessions WHERE user_id=?').get('maya').digest, maya.token)
  assert.ok(!JSON.stringify(s.state(teacher.p)).includes('password_hash'))
  now += 1000; assert.equal(s.principal(maya.token), null)
  const freshTeacher = await ctx.login(s.bootstrap.teacher), freshMaya = await ctx.login(s.bootstrap.students[0])
  s.logout(freshMaya.token); assert.equal(s.principal(freshMaya.token), null)
  const secondMaya = await ctx.login(s.bootstrap.students[0])
  await s.changePassword(secondMaya.p, { currentPassword: s.bootstrap.students[0].password, newPassword: 'New-unique-student-password-2026' })
  assert.equal(s.principal(secondMaya.token), null)
  await assert.rejects(s.login(s.bootstrap.students[0]), e => e.status === 401)
  const changed = await ctx.login({ username: 'MAYA', password: 'New-unique-student-password-2026' })
  const classId = s.state(freshTeacher.p).currentClassId, { id } = publish(s, freshTeacher.p)
  s.saveWork(changed.p, { assignmentId: id, answer: 0, reasoning: 'My work is retained.', submit: true, revision: 0, requestId: randomUUID() })
  const reset = s.resetStudent(freshTeacher.p, { classId, studentId: 'maya' })
  assert.equal(s.principal(changed.token), null)
  const restored = await ctx.login(reset)
  assert.equal(s.state(restored.p).assignments[0].work[0].reasoning, 'My work is retained.')
  s.removeStudent(freshTeacher.p, { classId, studentId: 'maya' })
  assert.equal(s.principal(restored.token), null)
  await assert.rejects(s.login(reset), e => e.status === 401)
  assert.equal(s.state(freshTeacher.p).students.find(x => x.id === 'maya').active, false)
  assert.equal(s.state(freshTeacher.p).assignments[0].work.length, 1)
  fails(() => s.addStudent(freshTeacher.p, { classId, name: 'Another Maya', username: 'maya' }), 409)
  fails(() => publish(s, freshTeacher.p), 400)
  const audit = s.db.prepare('SELECT * FROM audit').all()
  assert.ok(audit.some(a => a.action === 'student-removed')); assert.ok(!JSON.stringify(audit).includes(reset.password))
  s.resetTeacherCredentials({ username: 'teacher', password: 'Operator-recovered-teacher-2026' })
  assert.equal(s.principal(freshTeacher.token), null)
  await assert.rejects(s.login(s.bootstrap.teacher), e => e.status === 401)
  assert.equal((await s.login({ username: 'teacher', password: 'Operator-recovered-teacher-2026' })).user.role, 'teacher')
})
test('publication, work and help retries survive restart and protect immutable submissions', async t => {
  const ctx = await fixture(t), { store: s, teacher, maya } = ctx, draft = s.draft(teacher.p)
  const publication = { classId: draft.classId, revision: draft.revision, students: ['maya'], due: '2026-12-10', mode: 'hints', reviewed: true, requestId: randomUUID() }
  const assigned = s.publish(teacher.p, publication)
  s.save(teacher.p, { classId: draft.classId, revision: draft.revision, lesson: { ...seedLesson, title: 'Next version' } })
  assert.deepEqual(s.publish(teacher.p, publication), assigned)
  fails(() => s.publish(teacher.p, { ...publication, mode: 'teacher' }), 409)
  const first = { assignmentId: assigned.id, answer: 0, reasoning: 'First saved explanation.', submit: false, revision: 0, requestId: randomUUID() }
  assert.equal(s.saveWork(maya.p, first).revision, 1)
  fails(() => s.saveWork(maya.p, { ...first, requestId: randomUUID(), reasoning: 'Stale overwrite' }), 409)
  const submitted = { ...first, reasoning: 'Final explanation.', submit: true, revision: 1, requestId: randomUUID() }, receipt = s.saveWork(maya.p, submitted)
  assert.equal(receipt.revision, 2); assert.ok(receipt.submitted)
  assert.deepEqual(s.saveWork(maya.p, submitted), receipt)
  fails(() => s.saveWork(maya.p, { ...submitted, reasoning: 'Changed using same request' }), 409)
  fails(() => s.saveWork(maya.p, { ...submitted, requestId: randomUUID(), revision: 2 }), 409)
  const helpId = randomUUID(), result = { reply: 'Compare equal wholes.', engine: 'saved-hint', topic: 'Fractions' }
  const help = s.addHelp(maya.p, assigned.id, 'Why is that?', result, helpId)
  assert.deepEqual(s.addHelp(maya.p, assigned.id, 'Why is that?', { ...result, reply: 'Repeated generation.' }, helpId), help)
  assert.equal(s.getHelpByRequest(maya.p, assigned.id, helpId).id, help.id)
  fails(() => s.addHelp(maya.p, assigned.id, 'Different question', result, helpId), 409)
  s.close(); ctx.store = new ClassroomStore(ctx.dir)
  const p = ctx.store.principal(maya.token)
  assert.deepEqual(ctx.store.saveWork(p, submitted), receipt)
  assert.equal(ctx.store.listHelp(p, assigned.id).length, 1)
  assert.equal(ctx.store.state(p).assignments[0].work[0].reasoning, 'Final explanation.')
})
test('in-flight password changes and logins cannot resurrect revoked credentials or sessions', async t => {
  let now = Date.parse('2026-10-04T12:00:00Z')
  const ctx = await fixture(t, null, { now: () => now, sessionTtlMs: 1000 }), s = ctx.store, original = s.bootstrap.students.find(x => x.id === 'maya')
  let pending = s.changePassword(ctx.maya.p, { currentPassword: original.password, newPassword: 'Rejected-logout-password-2026' })
  s.logout(ctx.maya.token); await assert.rejects(pending, e => e.status === 401)
  const again = await ctx.login(original)
  pending = s.changePassword(again.p, { currentPassword: original.password, newPassword: 'Rejected-expiry-password-2026' })
  now += 1001; await assert.rejects(pending, e => e.status === 401)
  const teacher = await ctx.login(s.bootstrap.teacher), classId = s.state(teacher.p).currentClassId
  pending = s.login(original)
  const reset = s.resetStudent(teacher.p, { classId, studentId: 'maya' })
  await assert.rejects(pending, e => e.status === 401)
  assert.equal((await ctx.login(reset)).p.id, 'maya')
})
test('future database is rejected before schema or journal changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chalkline-future-schema-'))
  t.after(async () => { if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected temporary path'); await rm(dir, { recursive: true, force: true }) })
  const path = join(dir, 'classroom.sqlite'), before = new DatabaseSync(path)
  before.exec("CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES('Keep this'); PRAGMA user_version=99;"); before.close()
  assert.throws(() => new ClassroomStore(dir), /newer application/)
  const after = new DatabaseSync(path)
  try {
    assert.equal(after.prepare('PRAGMA user_version').get().user_version, 99)
    assert.equal(after.prepare('PRAGMA journal_mode').get().journal_mode, 'delete')
    assert.deepEqual(after.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name), ['future_data'])
    assert.equal(after.prepare('SELECT value FROM future_data').get().value, 'Keep this')
  } finally { after.close() }
})
