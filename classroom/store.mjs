import { validateTeachingPlan } from './planner.mjs'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { seedLesson, publicLesson, validateLesson } from './lesson.mjs'
import { seedCollegeLesson, seedSeminarLesson } from './college-lesson.mjs'
import { newPassword, normalizeUsername, passwordRecord, checkPassword } from './identity.mjs'
export const hash = value => createHash('sha256').update(value).digest('hex')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const label = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) fail('Enter a name of 1–100 characters.')
  return value.trim()
}
const safeUser = a => ({ id: a.id, name: a.name, role: a.role, username: a.username })
const defaults = [{ id: 'maya', name: 'Maya B.' }, { id: 'eli', name: 'Eli R.' }, { id: 'luis', name: 'Luis S.' }, { id: 'ava', name: 'Ava H.' }]
const collegeDefaults = [{ id:'alex', name:'Alex Morgan' },{ id:'jordan', name:'Jordan Lee' },{ id:'sam', name:'Sam Rivera' },{ id:'taylor', name:'Taylor Chen' }]
const collegeKinds = new Set(['college-statistics','college-seminar'])
export class ClassroomStore {
  constructor(dir, { now = Date.now, sessionTtlMs = 8 * 60 * 60 * 1000, edition = 'school' } = {}) {
    if (!['school','college'].includes(edition)) throw new Error('Choose the school or college edition.')
    this.edition = edition
    this.now = now
    if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1 || sessionTtlMs > 30 * 86400000) throw new Error('Invalid session lifetime.')
    this.sessionTtlMs = sessionTtlMs
    mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(join(dir, 'classroom.sqlite'))
    try {
    const version = this.db.prepare('PRAGMA user_version').get().user_version
    if (version > 2) throw new Error('This classroom database needs a newer application.')
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    const marker = tables.some(t => t.name === 'application_meta') ? this.db.prepare("SELECT value FROM application_meta WHERE key='edition'").get()?.value : undefined
    if ((marker && marker !== edition) || (!marker && tables.length && edition !== 'school'))
      throw new Error('This data directory belongs to another Chalkline edition. Use a separate data directory.')
    if (!tables.length) this._transaction(() => {
      this.db.exec('CREATE TABLE application_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
      this.db.prepare("INSERT INTO application_meta VALUES('edition',?)").run(this.edition)
    })
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS draft(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assignments(id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL, due TEXT NOT NULL, mode TEXT NOT NULL, created TEXT NOT NULL, media TEXT);
      CREATE TABLE IF NOT EXISTS memberships(assignment TEXT NOT NULL REFERENCES assignments(id), student TEXT NOT NULL, PRIMARY KEY(assignment,student));
      CREATE TABLE IF NOT EXISTS work(assignment TEXT NOT NULL, student TEXT NOT NULL, answer INTEGER, reasoning TEXT NOT NULL DEFAULT '', submitted TEXT, feedback TEXT NOT NULL DEFAULT '', PRIMARY KEY(assignment,student), FOREIGN KEY(assignment,student) REFERENCES memberships(assignment,student));
      CREATE TABLE IF NOT EXISTS help(id TEXT PRIMARY KEY, assignment TEXT NOT NULL, student TEXT NOT NULL, question TEXT NOT NULL, reply TEXT NOT NULL, engine TEXT NOT NULL, topic TEXT NOT NULL, created TEXT NOT NULL, FOREIGN KEY(assignment,student) REFERENCES memberships(assignment,student));
      CREATE TABLE IF NOT EXISTS media(revision INTEGER PRIMARY KEY, status TEXT NOT NULL, detail TEXT NOT NULL, asset TEXT);
    `)
    if (version < 2) this._migrate(dir)
    this.db.exec("CREATE TABLE IF NOT EXISTS source_documents(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),hash TEXT NOT NULL,body TEXT NOT NULL,page_count INTEGER NOT NULL,char_count INTEGER NOT NULL,created TEXT NOT NULL,UNIQUE(class_id,hash)); CREATE TABLE IF NOT EXISTS teaching_plans(class_id TEXT PRIMARY KEY REFERENCES classes(id),revision INTEGER NOT NULL CHECK(revision>0),body TEXT NOT NULL,updated TEXT NOT NULL);")
    const bootstrapPath = join(dir, 'bootstrap.json')
    this.bootstrap = existsSync(bootstrapPath) ? JSON.parse(readFileSync(bootstrapPath, 'utf8')) : null
    } catch (error) { this.db.close(); throw error }
  }
  _sourceDocument(row) { return {...JSON.parse(row.body),id:row.id,classId:row.class_id,hash:row.hash,pageCount:row.page_count,charCount:row.char_count,createdAt:row.created} }
  _sourceSummary(row) { const value=this._sourceDocument(row);delete value.pages;return value }
  listSources(p,classId) { this._actor(p,'teacher');const c=this._class(p,classId);return this.db.prepare('SELECT * FROM source_documents WHERE class_id=? ORDER BY created DESC,id').all(c.id).map(row=>this._sourceSummary(row)) }
  getSources(p,{classId,sourceIds}) {
    this._actor(p,'teacher');const c=this._class(p,classId)
    if(!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>3||new Set(sourceIds).size!==sourceIds.length||sourceIds.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))fail('Choose one to three distinct sources.')
    return sourceIds.map(id=>{const row=this.db.prepare('SELECT * FROM source_documents WHERE id=? AND class_id=?').get(id,c.id);if(!row)fail('Source not found.',404);return this._sourceDocument(row)})
  }
  addSource(p,{classId,source}) {
    this._actor(p,'teacher');const c=this._class(p,classId)
    if(!source||typeof source.hash!=='string'||!/^[a-f0-9]{64}$/.test(source.hash)||!['pdf','docx','txt','md'].includes(source.format))fail('Invalid extracted source.')
    for(const [key,max,required]of [['title',160,true],['publisher',160,false],['filename',240,true]])if(typeof source[key]!=='string'||source[key].length>max||(required&&!source[key].trim()))fail('Check source '+key+'.')
    if(!Array.isArray(source.pages)||!source.pages.length||source.pages.length>60)fail('Invalid source sections.')
    let charCount=0;const labels=new Set()
    const pages=source.pages.map(page=>{if(!page||typeof page.text!=='string'||!/^([ps])[1-9][0-9]{0,2}$/.test(page.label)||labels.has(page.label))fail('Invalid source page.');labels.add(page.label);charCount+=page.text.length;return {label:page.label,text:page.text}})
    if(charCount>90000||!pages.some(p=>p.text.trim()))fail('Source must contain readable text under 90,000 characters.')
    if(!Array.isArray(source.warnings)||source.warnings.length>20||source.warnings.some(w=>typeof w!=='string'||w.length>500))fail('Invalid source warnings.')
    const clean={title:source.title,publisher:source.publisher,filename:source.filename,format:source.format,hash:source.hash,pages,warnings:source.warnings}
    return this._transaction(()=>{
      const existing=this.db.prepare('SELECT * FROM source_documents WHERE class_id=? AND hash=?').get(c.id,source.hash)
      if(existing)return {source:this._sourceSummary(existing),duplicate:true}
      if(this.listSources(p,c.id).length>=24)fail('This class already has 24 sources. Remove an unused source first.',409)
      const id=randomUUID();this.db.prepare('INSERT INTO source_documents VALUES(?,?,?,?,?,?,?)').run(id,c.id,source.hash,JSON.stringify(clean),pages.length,charCount,this._stamp())
      this._audit(p.id,'source-added',id,c.id);return {source:this._sourceSummary(this.db.prepare('SELECT * FROM source_documents WHERE id=?').get(id)),duplicate:false}
    })
  }
  teachingPlan(p,classId) { this._actor(p,'teacher');const c=this._class(p,classId),row=this.db.prepare('SELECT * FROM teaching_plans WHERE class_id=?').get(c.id);return {classId:c.id,revision:row?.revision||0,plan:row?JSON.parse(row.body):null,updatedAt:row?.updated||null} }
  saveTeachingPlan(p,{classId,revision,plan}) {
    this._actor(p,'teacher');const c=this._class(p,classId)
    if(!Number.isSafeInteger(revision)||revision<0)fail('Reload the saved teaching plan.')
    if(plan!==null&&(!plan||typeof plan!=='object'||Array.isArray(plan)))fail('Provide a plan or explicitly clear it.')
    return this._transaction(()=>{
      const old=this.teachingPlan(p,c.id);if(old.revision!==revision)fail('This plan changed in another window. Your edits are still here. Download them, then reload the saved plan.',409)
      const clean=plan===null?null:validateTeachingPlan(plan,this.getSources(p,{classId:c.id,sourceIds:plan.sourceIds}))
      this.db.prepare('INSERT INTO teaching_plans VALUES(?,?,?,?) ON CONFLICT(class_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,updated=excluded.updated').run(c.id,revision+1,JSON.stringify(clean),this._stamp())
      this._audit(p.id,plan===null?'teaching-plan-cleared':'teaching-plan-saved',c.id,c.id);return this.teachingPlan(p,c.id)
    })
  }
  deleteSource(p,{classId,id}) {
    this._actor(p,'teacher');const c=this._class(p,classId)
    return this._transaction(()=>{this.getSources(p,{classId:c.id,sourceIds:[id]});if(this.teachingPlan(p,c.id).plan?.sourceIds.includes(id))fail('Clear the saved plan before deleting a source it uses.',409);this.db.prepare('DELETE FROM source_documents WHERE id=? AND class_id=?').run(id,c.id);this._audit(p.id,'source-deleted',id,c.id);return {deleted:true}})
  }
  _stamp() { return new Date(this.now()).toISOString() }
  _transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result } catch (error) { try { this.db.exec('ROLLBACK') } catch { /* SQLite may already have rolled back. */ } throw error }
  }
  _migrate(dir) {
    this._transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS application_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('teacher','student')), username TEXT NOT NULL UNIQUE COLLATE NOCASE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id), name TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS class_memberships(class_id TEXT NOT NULL REFERENCES classes(id), student TEXT NOT NULL REFERENCES accounts(id), active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(class_id,student));
        CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS class_drafts(class_id TEXT PRIMARY KEY REFERENCES classes(id), revision INTEGER NOT NULL UNIQUE, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS lesson_versions(revision INTEGER PRIMARY KEY AUTOINCREMENT, class_id TEXT NOT NULL REFERENCES classes(id), body TEXT, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS requests(actor TEXT NOT NULL, kind TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(actor,kind,request_id));
        CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, class_id TEXT, created TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS help_assignment ON help(assignment,student,created);
      `)
      for (const [table, column, definition] of [['assignments', 'class_id', "TEXT NOT NULL DEFAULT 'demo-class'"], ['media', 'class_id', "TEXT NOT NULL DEFAULT 'demo-class'"], ['work', 'revision', 'INTEGER NOT NULL DEFAULT 0']]) {
        if (!this.db.prepare('PRAGMA table_info(' + table + ')').all().some(r => r.name === column)) this.db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition)
      }
      if (!this.db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) {
        this.db.prepare("INSERT OR IGNORE INTO application_meta VALUES('edition',?)").run(this.edition)
        let legacy = null
        const accessPath = join(dir, 'access.json')
        if (this.edition === 'school' && existsSync(accessPath)) legacy = JSON.parse(readFileSync(accessPath, 'utf8'))
        const students = (this.edition === 'college' ? collegeDefaults : defaults).map(s => ({ ...s, name: legacy?.students?.find(old => old.id === s.id)?.name || s.name, username: s.id, password: newPassword() }))
        const teacher = { id:'teacher', name:this.edition === 'college' ? 'Dr. Jamie Reed' : 'Jamie', username:this.edition === 'college' ? 'instructor' : 'teacher', password:newPassword() }
        this._insertAccount({ ...teacher, role: 'teacher' })
        for (const s of students) this._insertAccount({ ...s, role: 'student' })
        this.db.prepare('INSERT INTO classes VALUES(?,?,?,?)').run('demo-class', 'teacher', this.edition === 'college' ? 'Research Methods · Demonstration' : 'Grade 3 demo class', this._stamp())
        for (const s of students) this.db.prepare('INSERT INTO class_memberships VALUES(?,?,1)').run('demo-class', s.id)
        this.db.prepare('INSERT OR IGNORE INTO draft VALUES(1,1,?)').run(JSON.stringify(this._seedForKind()))
        const draft = this.db.prepare('SELECT revision,body FROM draft WHERE id=1').get()
        this.db.prepare('INSERT INTO class_drafts VALUES(?,?,?)').run('demo-class', draft.revision, draft.body)
        this.db.prepare('INSERT OR IGNORE INTO lesson_versions VALUES(?,?,?,?)').run(draft.revision, 'demo-class', draft.body, this._stamp())
        for (const a of this.db.prepare('SELECT revision,body,created FROM assignments').all()) this.db.prepare('INSERT OR IGNORE INTO lesson_versions VALUES(?,?,?,?)').run(a.revision, 'demo-class', a.body, a.created)
        for (const m of this.db.prepare('SELECT revision FROM media').all()) this.db.prepare('INSERT OR IGNORE INTO lesson_versions VALUES(?,?,NULL,?)').run(m.revision, 'demo-class', this._stamp())
        writeFileSync(join(dir, 'bootstrap.json'), JSON.stringify({ edition:this.edition, createdAt: this._stamp(), teacher, students }, null, 2), { mode: 0o600 })
        this._audit('operator', 'migration-v2', 'demo-class', 'demo-class')
      }
      this.db.exec('PRAGMA user_version=2')
    })
  }
  _insertAccount({ id = randomUUID(), name, username, password, role }) {
    name = label(name); username = normalizeUsername(username)
    if (this.db.prepare('SELECT 1 FROM accounts WHERE username=?').get(username)) fail('That username is already in use.', 409)
    const record = passwordRecord(password)
    this.db.prepare('INSERT INTO accounts(id,name,role,username,salt,password_hash,created) VALUES(?,?,?,?,?,?,?)').run(id, name, role, username, record.salt, record.password_hash, this._stamp())
    return { id, name, username, role }
  }
  _audit(actor, action, target, classId = null) { this.db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(randomUUID(), actor, action, target, classId, this._stamp()) }
  _actor(p, role) {
    const account = p && this.db.prepare('SELECT * FROM accounts WHERE id=? AND active=1').get(p.id)
    if (!account || account.role !== p.role) fail('Sign in again.', 401)
    if (role && account.role !== role) fail(role === 'teacher' ? 'Teacher access required.' : 'Student access required.', 403)
    return account
  }
  _class(p, classId) {
    this._actor(p)
    const row = classId
      ? this.db.prepare('SELECT * FROM classes WHERE id=?').get(classId)
      : this.db.prepare(p.role === 'teacher' ? 'SELECT * FROM classes WHERE owner=? ORDER BY created,id LIMIT 1' : 'SELECT c.* FROM classes c JOIN class_memberships m ON c.id=m.class_id WHERE m.student=? AND m.active=1 ORDER BY c.created,c.id LIMIT 1').get(p.id)
    if (!row || (p.role === 'teacher' ? row.owner !== p.id : !this.db.prepare('SELECT 1 FROM class_memberships WHERE class_id=? AND student=? AND active=1').get(row.id, p.id))) fail('Class not found.', 404)
    return row
  }
  async login({ username, password } = {}) {
    let normalized = ''
    try { normalized = normalizeUsername(username) } catch { /* Generic authentication failure. */ }
    const account = normalized ? this.db.prepare('SELECT * FROM accounts WHERE username=?').get(normalized) : null
    const valid = await checkPassword(password, account)
    const fresh = account && this.db.prepare('SELECT * FROM accounts WHERE id=? AND active=1').get(account.id)
    if (!valid || !fresh || fresh.password_hash !== account.password_hash) fail('Username or password is incorrect.', 401)
    const token = randomBytes(32).toString('base64url'), expires = this.now() + this.sessionTtlMs
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,0,?)').run(hash(token), fresh.id, expires, this._stamp())
    return { token, expiresAt: new Date(expires).toISOString(), user: safeUser(fresh) }
  }
  principal(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
    const row = this.db.prepare('SELECT a.*,s.digest AS session_id FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.digest=? AND s.revoked=0 AND s.expires>? AND a.active=1').get(hash(token), this.now())
    return row ? { ...safeUser(row), sessionId: row.session_id } : null
  }
  logout(token) {
    if (typeof token === 'string' && token.length <= 256) this.db.prepare('UPDATE sessions SET revoked=1 WHERE digest=?').run(hash(token))
    return { signedOut: true }
  }
  async changePassword(p, { currentPassword, newPassword: replacement } = {}) {
    const account = this._actor(p), record = passwordRecord(replacement)
    if (!(await checkPassword(currentPassword, account))) fail('Current password is incorrect.', 403)
    return this._transaction(() => {
      if (p.sessionId && !this.db.prepare('SELECT 1 FROM sessions WHERE digest=? AND user_id=? AND revoked=0 AND expires>?').get(p.sessionId,p.id,this.now())) fail('Your session ended. Sign in again.',401)
      const fresh = this._actor(p)
      if (fresh.password_hash !== account.password_hash) fail('Your account changed. Sign in again.', 409)
      this.db.prepare('UPDATE accounts SET salt=?,password_hash=? WHERE id=?').run(record.salt, record.password_hash, p.id)
      this.db.prepare('UPDATE sessions SET revoked=1 WHERE user_id=?').run(p.id)
      this._audit(p.id, 'password-changed', p.id)
      return { saved: true }
    })
  }
  createTeacher({ name, username, password }) {
    return this._transaction(() => {
      const account = this._insertAccount({ name, username, password, role: 'teacher' })
      this._newClass(account, label(name).slice(0, 85) + "'s class")
      this._audit('operator', 'teacher-created', account.id)
      return account
    })
  }
  resetTeacherCredentials({ username, password }) {
    username = normalizeUsername(username)
    const record = passwordRecord(password)
    return this._transaction(() => {
      const account = this.db.prepare("SELECT * FROM accounts WHERE username=? AND role='teacher' AND active=1").get(username)
      if (!account) fail('Teacher account not found.', 404)
      this.db.prepare('UPDATE accounts SET salt=?,password_hash=? WHERE id=?').run(record.salt, record.password_hash, account.id)
      this.db.prepare('UPDATE sessions SET revoked=1 WHERE user_id=?').run(account.id)
      this._audit('operator', 'teacher-password-reset', account.id)
      return safeUser(account)
    })
  }
  _newVersion(classId, lesson) {
    const body = JSON.stringify(lesson)
    const result = this.db.prepare('INSERT INTO lesson_versions(class_id,body,created) VALUES(?,?,?)').run(classId, body, this._stamp())
    const revision = Number(result.lastInsertRowid)
    this.db.prepare('INSERT INTO class_drafts VALUES(?,?,?) ON CONFLICT(class_id) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(classId, revision, body)
    return { revision, lesson }
  }
  _seedForKind(kind) {
    if (this.edition === 'college') {
      if (!kind || kind === 'college-statistics') return seedCollegeLesson
      if (kind === 'college-seminar') return seedSeminarLesson
      fail('Choose a college lesson template.')
    }
    if (kind && kind !== 'school-fractions') fail('Choose a school lesson template.')
    return seedLesson
  }
  _assertLessonEdition(lesson) {
    if (collegeKinds.has(lesson.kind) !== (this.edition === 'college')) fail('This lesson belongs to another Chalkline edition.')
  }
  templates() {
    return this.edition === 'college'
      ? [{kind:'college-statistics',label:'Correlation and causation'},{kind:'college-seminar',label:'Academic close reading'}]
      : [{kind:'school-fractions',label:'Unit fractions'}]
  }
  template(p, {classId,kind}) { this.draft(p,classId); return {lesson:structuredClone(this._seedForKind(kind))} }
  _newClass(p, name, kind) {
    const row = { id: randomUUID(), name: label(name), owner: p.id, created: this._stamp() }
    this.db.prepare('INSERT INTO classes VALUES(?,?,?,?)').run(row.id, row.owner, row.name, row.created)
    this._newVersion(row.id, this._seedForKind(kind))
    this._audit(p.id, 'class-created', row.id, row.id)
    return row
  }
  createClass(p, { name, kind }) { this._actor(p, 'teacher'); return this._transaction(() => this._newClass(p, name, kind)) }
  addStudent(p, { classId, name, username }) {
    this._actor(p, 'teacher'); const classroom = this._class(p, classId), password = newPassword()
    return this._transaction(() => {
      const account = this._insertAccount({ name, username, password, role: 'student' })
      this.db.prepare('INSERT INTO class_memberships VALUES(?,?,1)').run(classroom.id, account.id)
      this._audit(p.id, 'student-created', account.id, classroom.id)
      return { student: { ...account, active: true }, credentials: { username: account.username, password } }
    })
  }
  enrollExistingStudent(p, {classId,username}) {
    this._actor(p,'teacher')
    const classroom=this._class(p,classId),normalized=normalizeUsername(username)
    return this._transaction(()=>{
      const student=this.db.prepare("SELECT DISTINCT a.id,a.name,a.username,a.role FROM accounts a JOIN class_memberships m ON m.student=a.id JOIN classes c ON c.id=m.class_id WHERE a.username=? AND a.role='student' AND a.active=1 AND m.active=1 AND c.owner=? AND c.id<>?").get(normalized,p.id,classroom.id)
      if(!student)fail('Use an active student account already enrolled in another course you own.',404)
      const old=this.db.prepare('SELECT active FROM class_memberships WHERE class_id=? AND student=?').get(classroom.id,student.id)
      this.db.prepare('INSERT INTO class_memberships(class_id,student,active) VALUES(?,?,1) ON CONFLICT(class_id,student) DO UPDATE SET active=1').run(classroom.id,student.id)
      if(!old?.active)this._audit(p.id,'student-enrolled',student.id,classroom.id)
      return {student:{...student,active:true}}
    })
  }
  _student(p, classId, studentId) {
    this._actor(p, 'teacher'); const classroom = this._class(p, classId)
    const student = this.db.prepare("SELECT a.* FROM accounts a JOIN class_memberships m ON m.student=a.id WHERE m.class_id=? AND a.id=? AND a.role='student' AND a.active=1 AND m.active=1").get(classroom.id, studentId)
    if (!student) fail('Student not found.', 404)
    return { classroom, student }
  }
  resetStudent(p, { classId, studentId }) {
    const { classroom, student } = this._student(p, classId, studentId), password = newPassword(), record = passwordRecord(password)
    return this._transaction(() => {
      this.db.prepare('UPDATE accounts SET salt=?,password_hash=? WHERE id=?').run(record.salt, record.password_hash, student.id)
      this.db.prepare('UPDATE sessions SET revoked=1 WHERE user_id=?').run(student.id)
      this._audit(p.id, 'student-password-reset', student.id, classroom.id)
      return { username: student.username, password }
    })
  }
  removeStudent(p, { classId, studentId }) {
    const { classroom, student } = this._student(p, classId, studentId)
    return this._transaction(() => {
      this.db.prepare('UPDATE class_memberships SET active=0 WHERE class_id=? AND student=?').run(classroom.id, student.id)
      if (!this.db.prepare('SELECT 1 FROM class_memberships WHERE student=? AND active=1').get(student.id)) this.db.prepare('UPDATE accounts SET active=0 WHERE id=?').run(student.id)
      this.db.prepare('UPDATE sessions SET revoked=1 WHERE user_id=?').run(student.id)
      this._audit(p.id, 'student-removed', student.id, classroom.id)
      return { removed: true }
    })
  }
  _requestKey(requestId) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) fail('A valid request ID is required.')
    return requestId
  }
  _remember(p, kind, requestId, payload, operation) {
    this._requestKey(requestId)
    const fingerprint = hash(JSON.stringify(payload))
    return this._transaction(() => {
      const old = this.db.prepare('SELECT * FROM requests WHERE actor=? AND kind=? AND request_id=?').get(p.id, kind, requestId)
      if (old) {
        if (old.fingerprint !== fingerprint) fail('This request ID was already used for different content.', 409)
        return JSON.parse(old.response)
      }
      const result = operation()
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(p.id, kind, requestId, fingerprint, JSON.stringify(result), this._stamp())
      return result
    })
  }
  draft(p, classId) {
    this._actor(p, 'teacher'); const classroom = this._class(p, classId)
    const row = this.db.prepare('SELECT * FROM class_drafts WHERE class_id=?').get(classroom.id)
    return { classId: classroom.id, revision: row.revision, lesson: JSON.parse(row.body) }
  }
  save(p, { classId, lesson, revision }) {
    this._actor(p, 'teacher'); const classroom = this._class(p, classId), clean = validateLesson(lesson)
    this._assertLessonEdition(clean)
    return this._transaction(() => {
      const current = this.draft(p, classroom.id)
      if (current.revision !== revision) fail('This draft changed in another window. Reload before saving.', 409)
      return { classId: classroom.id, ...this._newVersion(classroom.id, clean) }
    })
  }
  publish(p, { classId, revision, students, due, mode, reviewed, requestId }) {
    this._actor(p, 'teacher'); const classroom = this._class(p, classId)
    return this._remember(p, 'publish', requestId, { classId: classroom.id, revision, students, due, mode, reviewed }, () => {
      const draft = this.draft(p, classroom.id)
      if (reviewed !== true || draft.revision !== revision) fail('Preview and approve the current saved version first.', 409)
      if (!Array.isArray(students) || !students.length || students.length > 500 || students.some(id => typeof id !== 'string' || !this.db.prepare('SELECT 1 FROM class_memberships m JOIN accounts a ON a.id=m.student WHERE m.class_id=? AND m.student=? AND m.active=1 AND a.active=1').get(classroom.id, id))) fail('Choose active students in this class.')
      if (!['hints', 'examples', 'teacher'].includes(mode)) fail('Choose an assistance level.')
      if (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due) fail('Choose a due date.')
      const id = randomUUID(), media = this.db.prepare("SELECT asset FROM media WHERE revision=? AND class_id=? AND status='ready'").get(revision, classroom.id)?.asset || null
      this.db.prepare('INSERT INTO assignments(id,title,body,revision,due,mode,created,media,class_id) VALUES(?,?,?,?,?,?,?,?,?)').run(id, draft.lesson.title, JSON.stringify(draft.lesson), revision, due, mode, this._stamp(), media, classroom.id)
      for (const student of new Set(students)) this.db.prepare('INSERT INTO memberships VALUES(?,?)').run(id, student)
      return { id }
    })
  }
  assignment(id, p) {
    this._actor(p)
    const row = this.db.prepare('SELECT a.* FROM assignments a JOIN classes c ON c.id=a.class_id WHERE a.id=? AND ' + (p.role === 'teacher' ? 'c.owner=?' : 'EXISTS(SELECT 1 FROM memberships m JOIN class_memberships cm ON cm.student=m.student AND cm.class_id=a.class_id WHERE m.assignment=a.id AND m.student=? AND cm.active=1)')).get(id, p.id)
    if (!row) fail('Assignment not found.', 404)
    const result = { ...row, classId: row.class_id, lesson: p.role === 'teacher' ? JSON.parse(row.body) : publicLesson(JSON.parse(row.body)) }
    delete result.body
    return result
  }
  saveWork(p, { assignmentId, answer, reasoning, submit = false, revision = 0, requestId }) {
    this._actor(p, 'student'); this.assignment(assignmentId, p)
    return this._remember(p, 'work', requestId, { assignmentId, answer, reasoning, submit, revision }, () => {
      if (answer !== null && (!Number.isInteger(answer) || answer < 0 || answer > 2)) fail('Choose one answer.')
      if (typeof reasoning !== 'string' || reasoning.length > 3000) fail('Keep your explanation under 3,000 characters.')
      if (typeof submit !== 'boolean') fail('Choose whether to submit the work.')
      if (!Number.isSafeInteger(revision) || revision < 0) fail('Reload the current saved work.')
      if (submit && (answer === null || !reasoning.trim())) fail('Choose an answer and explain your thinking before submitting.')
      const old = this.db.prepare('SELECT * FROM work WHERE assignment=? AND student=?').get(assignmentId, p.id)
      if (old?.submitted) fail('Already submitted. Your teacher can review this work.', 409)
      if ((old?.revision || 0) !== revision) fail('Your work changed in another window. Reload before saving.', 409)
      const next = revision + 1, submitted = submit ? this._stamp() : null
      this.db.prepare(`INSERT INTO work(assignment,student,answer,reasoning,submitted,revision) VALUES(?,?,?,?,?,?) ON CONFLICT(assignment,student) DO UPDATE SET answer=excluded.answer,reasoning=excluded.reasoning,submitted=excluded.submitted,revision=excluded.revision`).run(assignmentId, p.id, answer, reasoning, submitted, next)
      return { saved: true, revision: next, submitted }
    })
  }
  feedback(p, { assignmentId, studentId, feedback }) {
    this._actor(p, 'teacher'); this.assignment(assignmentId, p)
    if (typeof feedback !== 'string' || feedback.length > 3000) fail('Keep feedback under 3,000 characters.')
    const result = this.db.prepare('UPDATE work SET feedback=? WHERE assignment=? AND student=?').run(feedback, assignmentId, studentId)
    if (!result.changes) fail('There is no saved work for this student yet.', 404)
    return { saved: true }
  }
  getHelpByRequest(p, assignmentId, requestId) {
    this._actor(p, 'student'); this.assignment(assignmentId, p); this._requestKey(requestId)
    const old = this.db.prepare("SELECT response FROM requests WHERE actor=? AND kind='help' AND request_id=?").get(p.id, requestId)
    if (!old) return null
    const row = JSON.parse(old.response)
    if (row.assignment !== assignmentId) fail('This request ID was already used for another assignment.', 409)
    return row
  }
  addHelp(p, assignmentId, question, result, requestId) {
    this._actor(p, 'student'); this.assignment(assignmentId, p)
    if (typeof question !== 'string' || !question.trim() || question.length > 1200) fail('Ask a question in up to 1,200 characters.')
    return this._remember(p, 'help', requestId, { assignmentId, question: question.trim() }, () => {
      if (!result || typeof result.reply !== 'string' || result.reply.length > 12000 || typeof result.engine !== 'string' || result.engine.length > 100 || typeof result.topic !== 'string' || result.topic.length > 200) fail('Invalid help response.')
      const row = { id: randomUUID(), assignment: assignmentId, student: p.id, question: question.trim(), reply: result.reply, engine: result.engine, topic: result.topic, created: this._stamp() }
      this.db.prepare('INSERT INTO help VALUES(?,?,?,?,?,?,?,?)').run(row.id, assignmentId, p.id, row.question, row.reply, row.engine, row.topic, row.created)
      return row
    })
  }
  listHelp(p, assignmentId, limit = 100) {
    this.assignment(assignmentId, p)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('Invalid help history limit.')
    const sql = 'SELECT * FROM help WHERE assignment=?' + (p.role === 'teacher' ? '' : ' AND student=?') + ' ORDER BY created DESC,rowid DESC LIMIT ?'
    return this.db.prepare(sql).all(...(p.role === 'teacher' ? [assignmentId, limit] : [assignmentId, p.id, limit])).reverse()
  }
  getMedia(p, { classId, revision }) {
    this._actor(p, 'teacher'); const classroom = this._class(p, classId)
    return this.db.prepare('SELECT * FROM media WHERE revision=? AND class_id=?').get(revision, classroom.id) || null
  }
  saveMedia(p, { classId, revision, status, detail, asset = null }) {
    this._actor(p, 'teacher'); const classroom = this._class(p, classId)
    if (!['rendering', 'ready', 'error'].includes(status) || typeof detail !== 'string' || detail.length > 1500) fail('Invalid video status.')
    if ((status === 'ready' && asset !== 'lesson-' + revision) || (asset !== null && asset !== 'lesson-' + revision)) fail('Invalid video asset.')
    const existing = this.getMedia(p, { classId: classroom.id, revision })
    const version = this.db.prepare('SELECT 1 FROM lesson_versions WHERE revision=? AND class_id=?').get(revision, classroom.id)
    if (!version || (!existing && this.draft(p, classroom.id).revision !== revision)) fail('Save and reload the current lesson before making the video.', 409)
    this.db.prepare('INSERT INTO media(revision,status,detail,asset,class_id) VALUES(?,?,?,?,?) ON CONFLICT(revision) DO UPDATE SET status=excluded.status,detail=excluded.detail,asset=excluded.asset').run(revision, status, detail, asset, classroom.id)
    return this.getMedia(p, { classId: classroom.id, revision })
  }
  canAccessAsset(p, asset) {
    this._actor(p)
    if (typeof asset !== 'string' || !/^lesson-\d+$/.test(asset)) return false
    if (p.role === 'teacher') return Boolean(this.db.prepare("SELECT 1 FROM media m JOIN classes c ON c.id=m.class_id WHERE m.asset=? AND m.status='ready' AND c.owner=?").get(asset, p.id))
    return Boolean(this.db.prepare("SELECT 1 FROM assignments a JOIN memberships m ON m.assignment=a.id JOIN class_memberships cm ON cm.class_id=a.class_id AND cm.student=m.student JOIN media v ON v.asset=a.media AND v.class_id=a.class_id WHERE a.media=? AND m.student=? AND cm.active=1 AND v.status='ready'").get(asset, p.id))
  }
  state(p, classId) {
    const account = this._actor(p), classroom = this._class(p, classId)
    const classes = this.db.prepare(p.role === 'teacher'
      ? 'SELECT c.*,(SELECT COUNT(*) FROM class_memberships m WHERE m.class_id=c.id AND m.active=1) AS studentCount FROM classes c WHERE c.owner=? ORDER BY c.created,c.id'
      : 'SELECT c.* FROM classes c JOIN class_memberships m ON m.class_id=c.id WHERE m.student=? AND m.active=1 ORDER BY c.created,c.id').all(p.id)
    const rows = this.db.prepare('SELECT a.id FROM assignments a WHERE a.class_id=?' + (p.role === 'teacher' ? '' : ' AND EXISTS(SELECT 1 FROM memberships m WHERE m.assignment=a.id AND m.student=?)') + ' ORDER BY a.created DESC,a.rowid DESC').all(...(p.role === 'teacher' ? [classroom.id] : [classroom.id, p.id]))
    const assignments = rows.map(({ id }) => {
      const a = this.assignment(id, p), lesson = a.lesson
      return {
        id: a.id, classId: a.classId, title: a.title, revision: a.revision, due: a.due, mode: a.mode, created: a.created, media: a.media, lesson: publicLesson(lesson),
        work: this.db.prepare('SELECT * FROM work WHERE assignment=?' + (p.role === 'teacher' ? '' : ' AND student=?')).all(...(p.role === 'teacher' ? [a.id] : [a.id, p.id])),
        help: this.listHelp(p, a.id, 1000),
        ...(p.role === 'teacher' ? { answerKey: lesson.correctIndex, teacherNotes: lesson.teacherNotes, students: this.db.prepare('SELECT student FROM memberships WHERE assignment=?').all(a.id).map(s => s.student) } : {})
      }
    })
    const session = p.sessionId && this.db.prepare('SELECT expires FROM sessions WHERE digest=?').get(p.sessionId)
    return {
      edition:this.edition, templates:this.templates(), user: safeUser(account), classes, currentClassId: classroom.id, assignments,
      ...(session ? { expiresAt: new Date(session.expires).toISOString() } : {}),
      ...(p.role === 'teacher' ? {
        draft: this.draft(p, classroom.id),
        students: this.db.prepare('SELECT a.id,a.name,a.username,m.active FROM accounts a JOIN class_memberships m ON m.student=a.id WHERE m.class_id=? ORDER BY a.name,a.id').all(classroom.id).map(s => ({ ...s, active: Boolean(s.active) })),
        media: this.db.prepare('SELECT * FROM media WHERE class_id=? ORDER BY revision DESC LIMIT 8').all(classroom.id)
      } : {})
    }
  }
  close() { this.db.close() }
}
