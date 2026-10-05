import test from 'node:test'
import { request } from 'node:http'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClassroom, transportSettings } from '../server.mjs'
import { seedLesson, lessonHtml } from '../lesson.mjs'
import { Tutor } from '../tutor.mjs'
async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalkline-http-v2-'))
  const app = createClassroom({ dataDir: dir, tutor: new Tutor(), ...options })
  const origin = await app.listen(0)
  const call = async (path, token, data, extra = {}) => {
    const response = await fetch(origin + '/api/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    })
    const text = await response.text()
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text }
  }
  const login = async credentials => { const r = await call('login', null, credentials); assert.equal(r.status, 200); return r.body.token }
  const teacher = await login(app.store.bootstrap.teacher)
  const maya = await login(app.store.bootstrap.students.find(s => s.id === 'maya'))
  const eli = await login(app.store.bootstrap.students.find(s => s.id === 'eli'))
  const state = (await call('state', teacher)).body
  const publish = async (students = ['maya'], overrides = {}) => {
    const r = await call('publish', teacher, { classId: state.currentClassId, revision: state.draft.revision, students, due: '2026-12-10', mode: 'hints', reviewed: true, requestId: randomUUID(), ...overrides })
    assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.id
  }
  t.after(async () => {
    await app.close()
    if (!resolve(dir).startsWith(resolve(tmpdir()) + '/') && !resolve(dir).startsWith(resolve(tmpdir()) + '\\')) throw new Error('Unexpected test directory')
    await rm(dir, { recursive: true, force: true })
  })
  return { app, origin, dir, call, login, teacher, maya, eli, state, publish }
}
test('authenticated classroom cycle preserves reviewed content and makes ambiguous retries safe', async t => {
  const { call, teacher, maya, eli, state, publish } = await setup(t)
  assert.equal((await call('state', 'invalid')).status, 401)
  assert.equal((await call('classes', maya, { name: 'No' })).status, 403)
  assert.equal((await call('links', teacher)).status, 404)
  assert.equal((await call('publish', teacher, { classId: state.currentClassId, revision: state.draft.revision, students: ['maya'], reviewed: false, requestId: randomUUID() })).status, 409)
  const id = await publish()
  assert.equal((await call('lesson', teacher, { classId: state.currentClassId, revision: state.draft.revision, lesson: { ...seedLesson, title: 'A changed draft' } })).status, 200)
  const learner = (await call('state', maya)).body
  assert.equal(learner.assignments[0].title, seedLesson.title)
  assert.equal(learner.assignments[0].lesson.correctIndex, undefined)
  assert.equal(learner.assignments[0].lesson.teacherNotes, undefined)
  assert.equal(learner.draft, undefined)
  assert.equal((await call('state', eli)).body.assignments.length, 0)
  assert.equal((await call('lesson-html?assignment=' + id, eli)).status, 404)
  const question = { assignmentId: id, question: 'Why are sixths smaller?', requestId: randomUUID() }
  const [first, retry] = await Promise.all([call('help', maya, question), call('help', maya, question)])
  assert.equal(first.status, 200); assert.equal(retry.status, 200); assert.equal(first.body.id, retry.body.id)
  const answer = { assignmentId: id, answer: 0, reasoning: 'The wholes are equal; fewer parts makes each part larger.', submit: true, revision: 0, requestId: randomUUID() }
  const submitted = await call('progress', maya, answer)
  assert.equal(submitted.status, 200)
  assert.equal((await call('progress', maya, answer)).status, 200)
  assert.equal((await call('progress', maya, { ...answer, answer: 1 })).status, 409)
  assert.equal((await call('feedback', teacher, { assignmentId: id, studentId: 'maya', feedback: 'Show the equal wholes in your drawing.' })).status, 200)
  const updated = (await call('state', maya)).body.assignments[0]
  assert.equal(updated.work[0].feedback, 'Show the equal wholes in your drawing.')
  assert.equal(updated.help.length, 1)
  assert.equal((await call('logout', maya, {})).status, 200)
  assert.equal((await call('state', maya)).status, 401)
})
test('classes, accounts, media and feedback are isolated between teachers and removed learners lose access', async t => {
  const { app, call, login, teacher, maya, state, publish } = await setup(t)
  await app.store.createTeacher({ name: 'Teacher Two', username: 'second-teacher', password: 'Correct-horse-2026-staple' })
  const second = await login({ username: 'second-teacher', password: 'Correct-horse-2026-staple' })
  const secondState = (await call('state', second)).body
  const id = await publish()
  assert.equal((await call('state?classId=' + state.currentClassId, second)).status, 404)
  assert.equal((await call('lesson-html?assignment=' + id, second)).status, 404)
  assert.equal((await call('students/reset', second, { classId: state.currentClassId, studentId: 'maya' })).status, 404)
  assert.equal((await call('feedback', second, { assignmentId: id, studentId: 'maya', feedback: 'No' })).status, 404)
  assert.equal(secondState.assignments.length, 0)
  app.store.saveMedia(app.store.principal(teacher), { classId: state.currentClassId, revision: state.draft.revision, status: 'ready', detail: 'Fixture', asset: 'lesson-' + state.draft.revision })
  assert.equal(app.store.canAccessAsset(app.store.principal(second), 'lesson-' + state.draft.revision), false)
  assert.equal((await call('students/remove', teacher, { classId: state.currentClassId, studentId: 'maya' })).status, 200)
  assert.equal((await call('state', maya)).status, 401)
  assert.equal((await call('help', maya, { assignmentId: id, question: 'Still here?', requestId: randomUUID() })).status, 401)
})
test('pending AI work cannot write after its student session is revoked', async t => {
  let release
  const tutor = { help: () => new Promise(ok => { release = ok }) }
  const { call, teacher, maya, state, publish } = await setup(t, { tutor })
  const id = await publish()
  const pending = call('help', maya, { assignmentId: id, question: 'Help please', requestId: randomUUID() })
  for (let n = 0; n < 100 && !release; n++) await new Promise(ok => setTimeout(ok, 10))
  assert.ok(release)
  assert.equal((await call('students/reset', teacher, { classId: state.currentClassId, studentId: 'maya' })).status, 200)
  release({ reply: 'A late reply', engine: 'ai', topic: 'Fractions' })
  assert.equal((await pending).status, 401)
  assert.equal((await call('state', teacher)).body.assignments[0].help.length, 0)
})
test('HTTP and publication boundaries reject forged origins, direct access files and executable authored text', async t => {
  const { origin, call, teacher, app, state } = await setup(t)
  assert.equal((await call('state', teacher, undefined, { Origin: 'https://unrelated.example' })).status, 403)
  assert.equal((await call('state', teacher, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  assert.equal((await fetch(origin + '/', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 200)
  const forged = await new Promise((ok, fail) => { const req = request(origin + '/api/info', { headers: { Host: 'forged.example' } }, res => { res.resume(); ok(res.statusCode) }); req.on('error', fail); req.end() })
  assert.equal(forged, 403)
  for (const file of ['access.json', 'bootstrap.json', 'classroom.sqlite', 'launch.json']) assert.equal((await fetch(origin + '/data/' + file)).status, 404)
  assert.equal((await call('state', app.store.access?.teacher || 'old-permanent-link')).status, 401)
  const payload = '<img src=x onerror=alert(1)>'
  const html = lessonHtml({ ...seedLesson, title: payload, teacherNotes: 'PRIVATE_NOTES' })
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes(payload)); assert.ok(!html.includes('PRIVATE_NOTES')); assert.ok(!html.includes('correctIndex'))
  assert.equal((await call('lesson', teacher, { classId: state.currentClassId, revision: state.draft.revision, lesson: { ...seedLesson, scenes: [] } })).status, 400)
  assert.equal((await fetch(origin + '/api/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415)
  assert.equal((await call('login', null, { username: 'teacher', password: 'wrong' })).status, 401)
})
test('network mode fails closed without HTTPS and a pinned public origin', () => {
  assert.throws(() => transportSettings({ host: '0.0.0.0' }), /HTTPS/)
  assert.throws(() => transportSettings({ publicOrigin: 'http://classroom.example' }), /HTTPS/)
  assert.throws(() => transportSettings({ publicOrigin: 'https://classroom.example/path' }), /without a path/)
  assert.throws(() => transportSettings({ tls: { certFile: 'cert.pem' } }), /both/)
  assert.equal(transportSettings({ publicOrigin: 'https://classroom.example' }).host, '127.0.0.1')
  assert.equal(transportSettings({ host: '0.0.0.0', publicOrigin: 'https://classroom.example', tls: { certFile: 'cert.pem', keyFile: 'key.pem' } }).publicOrigin, 'https://classroom.example')
})
test('teacher-only help never invokes a model and student model context excludes private keys and notes', async () => {
  let seen
  const tutor = new Tutor()
  tutor.complete = async messages => { seen = messages; return 'Compare two equal wholes. What do you notice?' }
  const assignment = { mode: 'teacher', lesson: seedLesson }
  assert.equal((await tutor.help(assignment, 'Help')).engine, 'teacher-request'); assert.equal(seen, undefined)
  assert.equal((await tutor.help({ ...assignment, mode: 'examples' }, 'What is a denominator?')).engine, 'ai')
  assert.ok(!JSON.stringify(seen).includes('correctIndex')); assert.ok(!JSON.stringify(seen).includes(seedLesson.teacherNotes))
})
