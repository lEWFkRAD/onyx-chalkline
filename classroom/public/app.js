const root = document.querySelector('#app')
let edition = 'school'
const college = () => edition === 'college'
const wording = (school, adult) => college() ? adult : school
const E = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
const incomingSession = new URLSearchParams(location.hash.slice(1)).get('access')
let token = incomingSession || sessionStorage.getItem('chalkline-access') || ''
if (incomingSession) sessionStorage.removeItem('chalkline-expires')
if (location.hash) history.replaceState(null, '', location.pathname)
if (token) sessionStorage.setItem('chalkline-access', token)
let state, tab = 'overview', selected = '', working = null, previewed = 0, dirty = false, mediaTimer, blobs = []
let currentClassId = '', credentials = null, expiryTimer, busyOperations = 0
const notice = (message, error = false) => {
  const n = document.querySelector('#notice')
  n.textContent = message
  n.classList.add('visible')
  n.setAttribute('role', error ? 'alert' : 'status')
  clearTimeout(notice.timer)
  notice.timer = setTimeout(() => n.classList.remove('visible'), 8000)
}
function forgetSession() {
  token = ''; state = null; selected = ''; currentClassId = ''; working = null; dirty = false; credentials = null
  sessionStorage.removeItem('chalkline-access'); sessionStorage.removeItem('chalkline-expires')
  clearTimeout(mediaTimer); clearTimeout(expiryTimer)
}
function scheduleExpiry(expiresAt) {
  clearTimeout(expiryTimer)
  if (!expiresAt) return
  sessionStorage.setItem('chalkline-expires', expiresAt)
  const ms = Date.parse(expiresAt) - Date.now()
  if (!Number.isFinite(ms)) return
  expiryTimer = setTimeout(() => {
    captureWork(); forgetSession(); login()
    notice('Your session ended. Sign in again to continue. Any unsent work is still kept in this browser.', true)
  }, Math.max(0, Math.min(ms, 2147483647)))
}
async function api(path, data, raw = false) {
  const requestToken = token
  let response
  try {
    response = await fetch('/api/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + requestToken, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    })
  } catch {
    const error = new Error('The connection was interrupted. Your input is still here. Reconnect and retry.')
    error.ambiguous = true; throw error
  }
  if (path !== 'login' && token !== requestToken) throw new Error('The workspace changed. Please try again.')
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    if (path !== 'login' && token !== requestToken) { const stale = new Error('The workspace changed. Sign in again to confirm this request.'); stale.ambiguous = true; throw stale }
    const error = new Error(body.error || 'Please try again.')
    error.status = response.status; error.ambiguous = response.status >= 500
    if (response.status === 401 && path !== 'login') {
      captureWork(); forgetSession(); login()
      error.message = 'Please sign in again. Any unsent work is still kept in this browser.'
    }
    throw error
  }
  if (raw) return response
  let result
  try { result = await response.json() }
  catch { const error = new Error('The reply was interrupted. Reconnect and retry the saved request.'); error.ambiguous = true; throw error }
  if (path !== 'login' && token !== requestToken) { const error = new Error('The workspace changed. Sign in again to confirm this request.'); error.ambiguous = true; throw error }
  return result
}
function scoped(path) { return path + (path.includes('?') ? '&' : '?') + 'classId=' + encodeURIComponent(currentClassId) }
async function load() {
  const next = await api(scoped('state'))
  state = next; edition = state.edition || edition; document.body.dataset.edition = edition; currentClassId = state.currentClassId || ''
  if (state.expiresAt) scheduleExpiry(state.expiresAt)
}
const draftKey = id => 'chalkline:draft:' + state.user.id + ':' + id
const requestKey = (path, id) => 'chalkline:request:' + state.user.id + ':' + path + ':' + id
const memoryBackup = new Map()
function readLocal(key) { if (memoryBackup.has(key)) return memoryBackup.get(key); try { return JSON.parse(localStorage.getItem(key)) } catch { return null } }
function removeLocal(key) { memoryBackup.set(key, null); try { localStorage.removeItem(key) } catch { /* Keep the in-memory tombstone. */ } }
function writeLocal(key, value) {
  memoryBackup.set(key, value)
  try { localStorage.setItem(key, JSON.stringify(value)) }
  catch { notice('This browser cannot keep a backup. Keep this tab open and save your work when connected.', true) }
}
function pending(path, id) { return readLocal(requestKey(path, id)) }
async function mutate(path, data, id) {
  const key = requestKey(path, id), previous = readLocal(key), signature = JSON.stringify(data)
  if (previous && previous.signature !== signature) throw new Error('An earlier request is waiting. Use its Retry button before sending something new.')
  const request = previous || { signature, body: { ...data, requestId: crypto.randomUUID() } }
  writeLocal(key, request)
  try { const result = await api(path, request.body); removeLocal(key); return result }
  catch (error) { if (!error.ambiguous) removeLocal(key); throw error }
}
function captureWork() {
  const form = document.querySelector('#work'), a = state?.assignments.find(a => a.id === selected)
  if (!form || !a || a.work[0]?.submitted) return
  const data = new FormData(form), old = readLocal(draftKey(selected))
  const answer = data.get('answer') === null ? null : Number(data.get('answer')), reasoning = String(data.get('reasoning') || '')
  if (!old && answer === (a.work[0]?.answer ?? null) && reasoning === (a.work[0]?.reasoning || '')) return
  writeLocal(draftKey(selected), { answer, reasoning, revision: old?.revision ?? a.work[0]?.revision ?? 0, updatedAt: new Date().toISOString(), conflict: old?.conflict || false })
  const status = document.querySelector('#work-status')
  if (status) status.textContent = wording('Kept in this browser · Save to share your progress with your teacher.', 'Kept in this browser · Save to share with your instructor.')
}
function retryBanner(path, id) {
  return pending(path, id) ? '<div class="notice-inline retry"><p>The connection ended before we could confirm this request. Retry safely to check it.</p>' + button('retry-' + path, 'Retry ' + ({ progress: 'pending save', help: 'help request', publish: 'assignment' }[path]), 'data-id="' + E(id) + '"', true) + '</div>' : ''
}
function button(action, text, extra = '', secondary = false) {
  return (
    '<button type="button" data-action="' +
    action +
    '" ' +
    extra +
    ' class="' +
    (secondary ? 'secondary' : '') +
    '">' +
    text +
    '</button>'
  )
}
function login() {
  if (college()) { root.innerHTML = collegeLogin(); return }
  root.innerHTML = '<main class="login"><div class="brand"><span class="brandmark">c</span>chalkline</div><p class="eyebrow">A little help. A new understanding.</p><h1>Learning starts together.</h1><p>Sign in to your own learning space.</p><form id="login"><label>Username<input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64"></label><label>Password<input name="password" required autocomplete="current-password" type="password"></label><button>Sign in</button></form><p class="notice-inline">Students: use the username and password your teacher shared. This release uses synthetic classroom accounts.</p></main>'
}
function shell(content) {
  const teacher = state.user.role === 'teacher', classes = state.classes || []
  const nav = college() ? [['overview', 'Course overview'], ['studio', 'Module Studio'], ['assignments', 'Coursework'], ['insights', 'Questions & support'], ['classmates', 'Courses & enrollment']] : [['overview', 'Classroom'], ['studio', 'Lesson Studio'], ['assignments', 'Assignments'], ['insights', 'Questions & support'], ['classmates', 'Class & people']]
  const picker = classes.length ? '<label class="class-picker">' + wording('Your class', 'Your course') + '<select id="class-select">' + classes.map(c => '<option value="' + E(c.id) + '" ' + (c.id === currentClassId ? 'selected' : '') + '>' + E(c.name) + '</option>').join('') + '</select></label>' : ''
  root.innerHTML = '<header><div class="brand"><span class="brandmark">c</span>chalkline' + (college() ? ' <small class="college-wordmark">COLLEGE</small>' : '') + ' <span class="pill">' + (teacher ? wording('Teacher', 'Instructor') : 'Student') + '</span></div><div class="identity"><span>' + E(state.user.name) + '</span>' + button('account', 'Account', '', true) + button('logout', 'Sign out', '', true) + '</div></header>' + (teacher ? '<div class="layout"><nav aria-label="Teacher workspace">' + picker + nav.map(([id, label]) => '<button type="button" data-tab="' + id + '" class="' + (tab === id ? 'active' : '') + '" ' + (tab === id ? 'aria-current="page"' : '') + '>' + label + '</button>').join('') + (college() ? '<div class="note"><b>Learning with evidence.</b><br>Explore. Question. Reflect.<br><br><span class="pill">Fictional course demo</span></div></nav><main>' : '<div class="note"><b>Learning, together.</b><br>Reviewed lessons.<br>Questions worth hearing.<br><br><span class="pill">Synthetic classroom</span></div></nav><main>') : '<main class="student-main">' + picker) + content + '</main>' + (teacher ? '</div>' : '')
}
function account() {
  return head('Your account', 'Keep your workspace yours.', 'Changing your password signs out every open session, including this one.') + '<section class="panel account-panel"><p>Signed in as <b>' + E(state.user.username || state.user.name) + '</b>.</p><form id="password"><label>Current password<input type="password" name="currentPassword" autocomplete="current-password" required></label><label>New password<input type="password" name="newPassword" autocomplete="new-password" minlength="12" maxlength="256" required></label><p><small>Use at least 12 characters.</small></p><button>Change password and sign out</button></form>' + button('account-back', 'Back to my workspace', '', true) + '</section>'
}
function credentialCard() {
  return credentials ? '<section class="panel credential-card" aria-label="New sign-in details"><p class="eyebrow">Share privately with this student</p><h2>New sign-in details</h2><p>This password is shown only now. A password reset signs out their previous sessions.</p><label>Student username<input id="new-username" readonly value="' + E(credentials.username) + '"></label><label>Temporary student password<input id="new-password" readonly value="' + E(credentials.password) + '"></label><p><small>Sign-in page: ' + E(state.classroomUrl || location.origin) + '</small></p><div class="actions">' + button('copy-credentials', 'Copy sign-in details') + button('dismiss-credentials', 'I have saved these details', '', true) + '</div></section>' : ''
}
function classmates() {
  if (college()) return collegeClassmates()
  return head('Class & people', 'A place for every learner.', 'Create a class, then share individual sign-in details privately with each learner.') + credentialCard() + '<div class="grid"><section class="panel"><h2>Your learners</h2><p class="muted">Students only see lessons assigned to them in their own classes.</p>' + studentLinks() + '</section><aside><section class="panel"><h2>Add a student</h2><form id="student-add"><label>Student name<input name="name" maxlength="100" required autocomplete="off"></label><label>Student username<input name="username" maxlength="64" minlength="3" required autocomplete="off" autocapitalize="none" spellcheck="false"></label><p><small>Use 3–64 letters, numbers, dots, underscores or dashes. A private password is created for you.</small></p><button>Create student sign-in</button></form></section><section class="panel"><h2>Start another class</h2><form id="class-create"><label>Class name<input name="name" maxlength="100" required placeholder="Grade 3 · Maple"></label><button>Create class</button></form></section></aside></div>'
}
function head(kicker, title, description, action = '') {
  return (
    '<div class="pagehead"><div><p class="eyebrow">' +
    kicker +
    '</p><h1>' +
    title +
    '</h1><p>' +
    description +
    '</p></div>' +
    action +
    '</div>'
  )
}
function assignmentRows() {
  return state.assignments.length
    ? state.assignments
        .map(
          a =>
            '<div class="row"><div><h3>' +
            E(a.title) +
            '</h3><small>Version ' +
            a.revision +
            ' · Due ' +
            E(a.due) +
            ' · ' +
            a.students.length +
            ' learners</small></div><div class="actions"><span class="pill">' +
            a.work.filter(w => w.submitted).length +
            ' submitted</span>' +
            button('inspect', 'Review', 'data-id="' + a.id + '"', true) +
            '</div></div>'
        )
        .join('')
    : '<div class="empty">' + wording('Your first lesson is ready to make your own.<br>Open Lesson Studio, preview it, then assign it.', 'Your first module is ready to adapt.<br>Open Module Studio, review it, then publish to students.') + '</div>'
}
function overview() {
  if (college()) return collegeOverview()
  const questions = state.assignments.reduce((n, a) => n + a.help.length, 0),
    submitted = state.assignments.reduce((n, a) => n + a.work.filter(w => w.submitted).length, 0)
  return (
    '<section class="hero"><div><p class="eyebrow">Your connected classroom</p><h1>Every question opens a door.</h1><p>Create an explanation, give students room to explore, and see where a little more help could make a difference.</p>' +
    button('studio', 'Make a lesson →') +
    '</div><div class="art" aria-hidden="true"><span></span><span></span><span></span><span></span></div></section>' +
    '<div class="stats"><div class="stat"><b>' +
    state.assignments.length +
    '</b><small>Published assignments</small></div><div class="stat"><b>' +
    submitted +
    '</b><small>Submitted pieces of work</small></div><div class="stat"><b>' +
    questions +
    '</b><small>Questions shared with you</small></div></div><section class="panel"><div class="pagehead"><h2>Learning in motion</h2>' +
    button('refresh', 'Refresh', '', 'true') +
    '</div>' +
    assignmentRows() +
    '</section><section class="panel"><p class="eyebrow">Your class</p><h2>Ready to learn together.</h2><p class="muted">Add learners and share their sign-in details, then assign a reviewed lesson.</p>' + button('manage-class', 'Manage class & people', '', true) + '<div class="divider">' + button('desktop-link', 'Copy expiring desktop session link', '', true) + '<p><small>This private link shares your current teacher session. It expires when you sign out or the session ends. Paste it into the native Classroom tab.</small></p><div id="desktop-link-result"></div></div></section>'
  )
}
function studentLinks() {
  return state.students.length ? state.students.map(s => '<div class="row"><div><h3>' + E(s.name) + '</h3><small>' + E(s.username) + (s.active === false ? ' · Removed from this class' : '') + '</small></div>' + (s.active === false ? '' : '<div class="actions">' + button('reset-student', 'Reset password', 'data-id="' + E(s.id) + '"', true) + button('remove-student', 'Remove from class', 'data-id="' + E(s.id) + '"', true) + '</div>') + '</div>').join('') : '<div class="empty">No learners yet. Add your first student to this class.</div>'
}

function field(name, label, value, multiline = false, type = 'text') {
  return (
    '<label>' +
    label +
    (multiline
      ? '<textarea name="' + name + '" required>' + E(value) + '</textarea>'
      : '<input name="' + name + '" type="' + type + '" value="' + E(value) + '" required>') +
    '</label>'
  )
}
function studio() {
  const l = working || state.draft.lesson,
    r = state.draft.revision,
    m = state.media.find(m => m.revision === r)
  return (
    head(
      wording('Lesson Studio', 'Module Studio'),
      wording('Make understanding visible.', 'Build a module worth exploring.'),
      wording('Shape the explanation, preview it as a learner, then send a reviewed version to your class.', 'Prepare the explanation, readings, and assessment. Preview the saved module before publishing it.'),
      '<span class="pill" id="save-status">' + (dirty ? 'Unsaved changes' : 'Saved version ' + r) + '</span>'
    ) +
    (college() ? '<div class="grid"><div>' + collegeStudioStart(l) : '<div class="grid"><div><section class="panel"><p class="eyebrow">Start with an idea</p><h2>A familiar world. A new concept.</h2><form id="generate"><label>How should we explain unit fractions?<textarea name="brief" placeholder="Use a soccer field to explain why one fourth is bigger than one sixth." maxlength="1800"></textarea></label><div class="actions"><button>Draft with AI</button><small>Or edit the ready-made lesson below.</small></div></form></section>') +
    '<form id="lesson-form"><section class="panel"><h2>The lesson</h2>' +
    (college() ? collegeMetaEditor(l) : '') +
    field('title', 'Title', l.title) +
    field('objective', 'Learning objective', l.objective, true) +
    '<div class="split">' +
    field('audience', 'Audience', l.audience) +
    field('theme', 'Theme', l.theme) +
    '</div>' +
    field('introduction', 'Opening explanation', l.introduction, true) +
    (college() ? '</section><section class="panel"><h2>Readings & source material</h2><p class="muted">Add up to three readings. Paste the passage students should examine; links are references and are not fetched by AI.</p>' + collegeReadingEditor(l) : '') +
    '</section><section class="panel"><p class="eyebrow">Short explanatory video</p><h2>Three scenes. One clear idea.</h2><p class="muted">' + wording('Edit the script and the number of equal parts shown. Chalkline makes a narrated animation with captions.', 'Edit the narration. Chalkline creates a three-scene video with academic explanation cards, captions, and a transcript.') + '</p>' +
    l.scenes
      .map(
        (s, i) =>
          '<div class="scene"><div class="scene-number">SCENE 0' +
          (i + 1) +
          '</div><div class="split">' +
          field('heading' + i, 'Heading', s.heading) +
          (college() ? '' : field('parts' + i, 'Equal parts', s.denominator, false, 'number')) +
          '</div>' +
          field('narration' + i, 'Narration', s.narration, true) +
          '</div>'
      )
      .join('') +
    '</section><section class="panel"><h2>Check understanding</h2>' +
    field('question', 'Question', l.question) +
    l.options.map((o, i) => field('option' + i, 'Choice ' + (i + 1), o)).join('') +
    '<label>Answer key · ' + wording('teacher', 'instructor') + ' only<select name="correctIndex">' +
    l.options
      .map(
        (_, i) =>
          '<option value="' + i + '" ' + (i === l.correctIndex ? 'selected' : '') + '>Choice ' + (i + 1) + '</option>'
      )
      .join('') +
    '</select></label>' +
    field('teacherNotes', wording('Your private teaching notes', 'Private instructor notes / assessment criteria'), l.teacherNotes, true) +
    '<button>Save lesson</button></section></form></div>' +
    '<aside><section class="panel"><p class="eyebrow">Student preview</p><h2>Try the exploration.</h2><p class="muted">Preview uses saved version ' +
    r +
    '. Save your edits before reviewing.</p>' +
    button('preview', 'Preview saved lesson', '', 'true') +
    '<div id="preview-host"></div><div class="actions divider">' +
    button('export-html', 'Download HTML', '', 'true') +
    '</div></section>' +
    '<section class="panel"><p class="eyebrow">Narrated explanation</p><h2>Watch it come together.</h2><div id="media-status"><p>' +
    E(m?.detail || 'Save your script, then render the video on this computer.') +
    '</p></div><div class="actions">' +
    button('render', 'Make video', m?.status === 'rendering' ? 'disabled' : '') +
    '</div><div id="video-host"></div></section>' +
    '<section class="panel">' + retryBanner('publish', currentClassId) + '<p class="eyebrow">Publish a reviewed version</p><h2>Who is this for?</h2><form id="publish">' +
    state.students.filter(s => s.active !== false)
      .map(
        s =>
          '<label class="check"><input type="checkbox" name="students" value="' +
          s.id +
          '" checked>' +
          E(s.name) +
          '</label>'
      )
      .join('') +
    field('due', 'Due date', new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10), false, 'date') +
    '<label>Help available<select name="mode"><option value="hints">Hints and explanations</option><option value="examples">Hints and similar worked examples</option><option value="teacher">Instructor / teacher questions only</option></select></label><label class="check"><input name="reviewed" type="checkbox" required>I reviewed this saved lesson, its answer key, and any video included.</label><p><small>Preview the saved lesson first. Published versions stay unchanged when you edit your next draft.</small></p><button>Assign lesson</button></form></section></aside></div>'
  )
}
function insights() {
  const events = state.assignments.flatMap(a => a.help.map(h => ({ ...h, title: a.title })))
  const topics = [...new Set(events.map(h => h.topic))]
  return (
    head(
      'Questions & support',
      'Listen for the next lesson.',
      'These groups come from words in students’ questions. Open the original exchanges before deciding what to reteach.',
      button('refresh', 'Refresh', '', 'true')
    ) +
    (!events.length
      ? '<section class="panel empty">Student questions will appear here after they ask for help in an assigned lesson.</section>'
      : topics
          .map(topic => {
            const list = events.filter(h => h.topic === topic)
            return (
              '<section class="panel"><div class="pagehead"><div><p class="eyebrow">' +
              new Set(list.map(h => h.student)).size +
              ' learners · ' +
              list.length +
              ' questions</p><h2>' +
              E(topic) +
              '</h2></div></div>' +
              list
                .map(
                  h =>
                    '<details><summary>' +
                    E(state.students.find(s => s.id === h.student)?.name || h.student) +
                    ' — ' +
                    E(h.question) +
                    '</summary><p class="muted">' +
                    E(h.title) +
                    ' · ' +
                    new Date(h.created).toLocaleString() +
                    '</p><div class="question"><p><b>Student</b></p><p>' +
                    E(h.question) +
                    '</p><p><b>' +
                    engineLabel(h.engine) +
                    '</b></p><p>' +
                    E(h.reply) +
                    '</p></div>' +
                    button('followup', 'Draft a follow-up lesson', 'data-id="' + h.assignment + '"', true) +
                    '</details>'
                )
                .join('') +
              '</section>'
            )
          })
          .join('')) +
    '<p class="notice-inline">Help-seeking is part of learning. Question counts are not grades, diagnoses, or ability scores.</p>'
  )
}
function assignments() {
  const a = state.assignments.find(a => a.id === selected)
  return (
    head(
      'Assignments',
      'From lesson to learning.',
      'See saved work, student reasoning, and the help they requested.',
      button('refresh', 'Refresh', '', 'true')
    ) +
    '<section class="panel">' +
    assignmentRows() +
    '</section>' +
    (a
      ? '<section class="panel"><p class="eyebrow">Version ' +
        a.revision +
        ' · ' +
        E(a.mode) +
        '</p><h2>' +
        E(a.title) +
        '</h2><p><b>Published answer key:</b> ' +
        E(a.lesson.options[a.answerKey]) +
        '</p><details><summary>Private teaching notes</summary><p>' +
        E(a.teacherNotes) +
        '</p></details>' +
        a.students
          .map(id => {
            const s = state.students.find(s => s.id === id),
              w = a.work.find(w => w.student === id),
              help = a.help.filter(h => h.student === id)
            return (
              '<details open><summary>' +
              E(s?.name || 'Former class member') +
              ' · ' +
              (w?.submitted ? 'Submitted' : w ? 'Draft saved' : 'Not started') +
              '</summary><p><b>Answer:</b> ' +
              E(w?.answer !== null && w?.answer !== undefined ? a.lesson.options[w.answer] : 'No answer yet') +
              '</p><p><b>Thinking:</b> ' +
              E(w?.reasoning || 'No explanation yet') +
              '</p><small>' +
              help.length +
              ' help questions</small>' +
              help
                .map(
                  h =>
                    '<div class="question"><b>' +
                    E(h.question) +
                    '</b><p>' +
                    E(h.reply) +
                    '</p><small>' +
                    engineLabel(h.engine) +
                    '</small></div>'
                )
                .join('') +
              (w
                ? '<form data-feedback="' +
                  id +
                  '" data-assignment="' +
                  a.id +
                  '"><label>Your feedback<textarea name="feedback" maxlength="3000">' +
                  E(w.feedback) +
                  '</textarea></label><button>Share feedback</button></form>'
                : '') +
              '</details>'
            )
          })
          .join('') +
        '</section>'
      : '')
  )
}
function engineLabel(engine) {
  return (
    {
      ai: 'AI explanation',
      'saved-hint': 'Saved lesson hint · AI unavailable',
      'teacher-request': 'Question for your teacher'
    }[engine] || 'Lesson help'
  )
}
function studentHome() {
  if (college()) return collegeStudentHome()
  return (
    head(
      'Today & homework',
      'Hi, ' + E(state.user.name.split(' ')[0]) + '.',
      'A question is a good place to start. Choose a lesson and take it one step at a time.'
    ) +
    '<p class="notice-inline">Your teacher can see your work and the questions you ask for help with in these lessons.</p>' +
    (state.assignments.length
      ? state.assignments
          .map(
            a =>
              '<section class="panel divider"><p class="eyebrow">Due ' +
              E(a.due) +
              ' · ' +
              E(a.lesson.audience) +
              ' · ' + (a.work[0]?.submitted ? 'Complete' : a.due < new Date().toLocaleDateString('en-CA') ? 'Past due · You can still work on it' : a.due === new Date().toLocaleDateString('en-CA') ? 'Due today' : 'Upcoming') +
              '</p><h2>' +
              E(a.title) +
              '</h2><p>' +
              E(a.lesson.objective) +
              '</p><div class="actions">' +
              button('learn', a.work[0]?.submitted ? 'See your work' : 'Open lesson →', 'data-id="' + a.id + '"') +
              '<span class="pill">' +
              (a.work[0]?.submitted ? 'Submitted' : a.work.length ? 'In progress' : 'Ready for you') +
              '</span></div>' +
              (a.work[0]?.feedback
                ? '<p class="notice-inline"><b>From your teacher:</b> ' + E(a.work[0].feedback) + '</p>'
                : '') +
              '</section>'
          )
          .join('')
      : '<section class="panel empty">Your teacher hasn’t assigned a lesson yet.<br>Come back when they share your first activity.</section>') +
    button('refresh', 'Check for new lessons', '', 'true')
  )
}
function studentLesson() {
  const a = state.assignments.find(a => a.id === selected)
  if (!a) {
    selected = ''
    return studentHome()
  }
  const w = a.work[0], submitted = !!w?.submitted
  const draft = submitted ? null : readLocal(draftKey(a.id))
  const shown = draft || w
  const conflict = !!draft && (draft.conflict || draft.revision !== (w?.revision || 0))
  return (
    '<div class="actions">' +
    button('student-home', wording('← My lessons', '← My coursework'), '', 'true') +
    '<span class="pill">Due ' +
    E(a.due) +
    '</span></div>' +
    head(E(a.lesson.audience), E(a.title), E(a.lesson.objective)) +
    (college() ? collegeModuleMeta(a.lesson) + collegeReadingPanel(a.lesson) : '') +
    '<div class="grid"><div><section class="panel"><p class="eyebrow">' + wording('01 · Watch & wonder', '01 · Concept briefing') + '</p><h2>' + wording('A new way to see it.', 'Understand the argument.') + '</h2>' +
    (a.media ? '<div id="video-host"></div>' : '<p>' + E(a.lesson.introduction) + '</p>') +
    '<details><summary>Read the explanation</summary>' +
    a.lesson.scenes.map(s => '<h3 class="divider">' + E(s.heading) + '</h3><p>' + E(s.narration) + '</p>').join('') +
    '</details></section>' +
    '<section class="panel"><p class="eyebrow">02 · Explore</p><h2>' + wording('Move the pieces. Notice what changes.', 'Examine the evidence.') + '</h2><div id="preview-host"></div></section>' +
    '<section class="panel"><p class="eyebrow">03 · Show your thinking</p><h2>' +
    E(a.lesson.question) +
    '</h2><form id="work"><div id="work-notices">' + retryBanner('progress', a.id) + (conflict ? conflictNotice() : '') + '</div><fieldset ' +
    (submitted ? 'disabled' : '') +
    '><legend class="muted">Choose an answer</legend>' +
    a.lesson.options
      .map(
        (o, i) =>
          '<label class="choice"><input type="radio" name="answer" value="' +
          i +
          '" ' +
          (shown?.answer === i ? 'checked' : '') +
          '>' +
          E(o) +
          '</label>'
      )
      .join('') +
    '<label>' + wording('How do you know?', 'Your analysis') + '<textarea name="reasoning" maxlength="3000" placeholder="' + wording('I noticed that…', 'Explain your reasoning, cite a supplied passage or data point, and address an alternative explanation.') + '">' +
    E(shown?.reasoning || '') +
    '</textarea></label></fieldset>' +
    (!submitted
      ? '<div class="actions"><button name="intent" value="save" class="secondary">Save my progress</button><button name="intent" value="submit">' + wording('Turn in my work', 'Submit analysis') + '</button></div>'
      : '<p class="notice-inline">' + wording('Your work is turned in. Your teacher can see your explanation.', 'Your analysis is submitted. Your instructor can review your response.') + '</p>') +
    '<p id="work-status" role="status" class="save-status">' + (submitted ? wording('Shared with your teacher.', 'Shared with your instructor.') : draft ? wording('Restored from this browser · Save to share your progress with your teacher.', 'Restored from this browser · Save to share with your instructor.') : w ? wording('Saved with your teacher.', 'Saved with your instructor.') : wording('Choose Save to keep your progress with your teacher.', 'Choose Save to keep your progress with your instructor.')) + '</p></form>' +
    (w?.feedback ? '<p class="notice-inline"><b>' + wording('From your teacher:', 'Instructor feedback:') + '</b> ' + E(w.feedback) + '</p>' : '') +
    '</section></div>' +
    '<aside class="sticky"><section class="panel"><p class="eyebrow">' + wording('A little help along the way', 'Course study support') + '</p><h2>' + wording('Let’s think it through.', 'Work through the question.') + '</h2><p class="notice-inline">' + wording('Your teacher can read the questions and replies here. You can ask for help as often as you need.', 'Your instructor can read every question and reply in this course. AI supports your reasoning; you remain the author of your submission. Assistance: ' + (a.mode === 'teacher' ? 'instructor questions only' : a.mode === 'hints' ? 'hints and explanations' : 'hints and different worked examples') + '.') + '</p><div class="chatlog" id="chatlog">' +
    a.help
      .map(
        h =>
          '<div class="bubble student">' +
          E(h.question) +
          '</div><div class="bubble"><small>' +
          engineLabel(h.engine) +
          '</small><br>' +
          E(h.reply) +
          '</div>'
      )
      .join('') +
    '</div><form id="help"><div id="help-notices">' + retryBanner('help', a.id) + '</div><label>What would you like help with?<textarea name="question" maxlength="1200" required placeholder="' + wording('Why do more parts make smaller pieces?', 'Which assumption should I examine? How can I evaluate this evidence?') + '"></textarea></label><button>' +
    (a.mode === 'teacher' ? wording('Ask my teacher', 'Ask my instructor') : 'Help me understand') +
    '</button><p><small>Help may take a moment. A saved lesson hint is available if AI cannot connect.</small></p></form></section></aside></div>'
  )
}
async function showPreview(assignment) {
  const host = document.querySelector('#preview-host')
  if (!host) return
  const html = await (
    await api(scoped('lesson-html' + (assignment ? '?assignment=' + assignment : '')), undefined, true)
  ).text()
  const frame = document.createElement('iframe')
  frame.className = 'preview'
  frame.title = wording('Interactive equal-parts lesson', 'Interactive college module')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.srcdoc = html
  host.replaceChildren(frame)
}
async function video(asset) {
  const host = document.querySelector('#video-host')
  if (!host) return
  const source = await (await api('media-file?asset=' + asset + '&file=explanation.mp4', undefined, true)).blob()
  const captions = await (await api('media-file?asset=' + asset + '&file=captions.vtt', undefined, true)).blob()
  const src = URL.createObjectURL(source),
    vtt = URL.createObjectURL(captions)
  blobs.push(src, vtt)
  host.innerHTML =
    '<video controls preload="metadata"><source src="' +
    src +
    '" type="video/mp4"><track kind="captions" label="English" srclang="en" src="' +
    vtt +
    '" default></video><div class="actions">' +
    (state.user.role === 'teacher'
      ? button('download-video', 'Download MP4', 'data-asset="' + asset + '"', true) +
        button('download-captions', 'Captions', 'data-asset="' + asset + '"', true)
      : '') +
    '</div>'
}
async function render() {
  clearTimeout(mediaTimer)
  for (const b of blobs) URL.revokeObjectURL(b)
  blobs = []
  shell(tab === 'account' ? account() :
    state.user.role === 'teacher'
      ? ({ overview, studio, assignments, insights, classmates }[tab] || overview)()
      : selected
        ? studentLesson()
        : studentHome()
  )
  if (tab !== 'account' && state.user.role === 'student' && selected) {
    await showPreview(selected)
    const a = state.assignments.find(a => a.id === selected)
    if (a?.media) await video(a.media)
  }
  if (state.user.role === 'teacher' && tab === 'studio') {
    const m = state.media.find(m => m.revision === state.draft.revision)
    if (m?.status === 'ready') await video(m.asset)
    if (m?.status === 'rendering') pollMedia()
  }
}
function pollMedia() {
  mediaTimer = setTimeout(async () => {
    if (tab !== 'studio') return
    try {
      const requestedClass = currentClassId
      const fresh = await api(scoped('state'))
      if (currentClassId !== requestedClass) return
      state.media = fresh.media
      const m = state.media.find(m => m.revision === state.draft.revision)
      const status = document.querySelector('#media-status')
      if (status) status.textContent = m?.detail || ''
      if (m?.status === 'rendering') pollMedia()
      else {
        document.querySelector('[data-action="render"]')?.removeAttribute('disabled')
        if (m?.status === 'ready') await video(m.asset)
      }
    } catch (e) {
      notice(e.message, true)
    }
  }, 2000)
}
function collectLesson() {
  const f = new FormData(document.querySelector('#lesson-form'))
  return {
    ...(college() ? { kind: (working || state.draft.lesson).kind, courseCode: f.get('courseCode'), module: f.get('module'), estimatedMinutes: Number(f.get('estimatedMinutes')), readings: [0,1,2].map(i => ({ title: f.get('readingTitle'+i), url: f.get('readingUrl'+i), excerpt: f.get('readingExcerpt'+i) })).filter(r => r.title || r.url || r.excerpt) } : {}),
    title: f.get('title'),
    objective: f.get('objective'),
    audience: f.get('audience'),
    theme: f.get('theme'),
    introduction: f.get('introduction'),
    scenes: [0, 1, 2].map(i => ({
      heading: f.get('heading' + i),
      narration: f.get('narration' + i),
      ...(college() ? {} : { denominator: Number(f.get('parts' + i)) })
    })),
    question: f.get('question'),
    options: [0, 1, 2].map(i => f.get('option' + i)),
    correctIndex: Number(f.get('correctIndex')),
    teacherNotes: f.get('teacherNotes')
  }
}
async function download(path, name) {
  const response = await api(path, undefined, true),
    blob = await response.blob(),
    url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function markDirty() {
  dirty = true
  previewed = 0
  const s = document.querySelector('#save-status')
  if (s) s.textContent = 'Unsaved changes'
  const reviewed = document.querySelector('[name="reviewed"]')
  if (reviewed) reviewed.checked = false
}
function conflictNotice() {
  return '<div class="notice-inline conflict" role="alert"><p>Your work changed in another session. Your answer here is still kept. Reload the saved work before continuing.</p>' + button('reload-work', 'Reload saved work', '', true) + '</div>'
}
async function finishProgress(result, assignmentId, submitted, attempted) {
  const key = draftKey(assignmentId), draft = readLocal(key)
  const unchanged = !draft || (draft.answer === attempted.answer && draft.reasoning === attempted.reasoning)
  if (unchanged || submitted) removeLocal(key)
  await load()
  if (!unchanged && !submitted) {
    const a = state.assignments.find(a => a.id === assignmentId)
    writeLocal(key, { ...draft, revision: a?.work[0]?.revision || result.revision, conflict: false })
  }
  await render()
  notice(submitted ? 'Your work is turned in.' : unchanged ? 'Your progress is saved with your teacher.' : 'The earlier save is confirmed. Your newer edits are still kept in this browser.')
}
function appendHelp(result, assignmentId) {
  const a = state.assignments.find(a => a.id === assignmentId), already = a?.help.some(h => h.id === result.id)
  if (a && !already) a.help.push(result)
  const log = document.querySelector('#chatlog')
  if (selected !== assignmentId || !log) { notice('Your help reply is saved with the lesson.'); return }
  if (!already) log.insertAdjacentHTML('beforeend', '<div class="bubble student">' + E(result.question) + '</div><div class="bubble"><small>' + engineLabel(result.engine) + '</small><br>' + E(result.reply) + '</div>')
  document.querySelector('#help-notices').innerHTML = ''
  document.querySelector('#help').reset()
  log.scrollTop = log.scrollHeight
}
async function retryRequest(path, id) {
  const key = requestKey(path, id), request = readLocal(key)
  if (!request) return
  const requestToken = token
  try {
    const result = await api(path, request.body)
    if (token !== requestToken) return
    removeLocal(key)
    if (path === 'progress') await finishProgress(result, id, request.body.submit, request.body)
    if (path === 'help') appendHelp({ ...result, question: request.body.question }, id)
    if (path === 'publish') { await load(); tab = 'assignments'; await render(); notice('The assignment is confirmed. Students can open it now.') }
  } catch (error) {
    if (!error.ambiguous) removeLocal(key)
    showMutationError(path, id, error); throw error
  }
}
function showMutationError(path, id, error) {
  if (!state) return
  if (path === 'progress') {
    const draft = readLocal(draftKey(id))
    if (error.status === 409 && draft) writeLocal(draftKey(id), { ...draft, conflict: true })
    const host = document.querySelector('#work-notices')
    if (host) host.innerHTML = retryBanner(path, id) + (error.status === 409 ? conflictNotice() : '')
    const status = document.querySelector('#work-status')
    if (status) status.textContent = 'Not confirmed with your teacher · Your answer is still kept in this browser.'
  } else if (path === 'help') {
    const host = document.querySelector('#help-notices')
    if (host) host.innerHTML = retryBanner(path, id)
  } else if (path === 'publish') {
    const form = document.querySelector('#publish')
    if (form && !form.querySelector('.retry')) form.insertAdjacentHTML('afterbegin', retryBanner(path, id))
  }
}
root.addEventListener('input', e => {
  if (e.target.closest('#lesson-form')) { working = collectLesson(); markDirty() }
  if (e.target.closest('#work')) captureWork()
})
root.addEventListener('change', async e => {
  if (e.target.id !== 'class-select') return
  const next = e.target.value
  if (busyOperations) { e.target.value = currentClassId; notice('Wait for the current request to finish before switching classes.'); return }
  if (dirty && !confirm('Leave your unsaved lesson edits and switch classes?')) { e.target.value = currentClassId; return }
  captureWork()
  const previous = currentClassId; currentClassId = next; busyOperations++; e.target.disabled = true
  try { await load(); working = null; dirty = false; previewed = 0; selected = ''; credentials = null; await render() }
  catch (error) { currentClassId = previous; e.target.value = previous; notice(error.message, true) }
  finally { busyOperations--; e.target.disabled = false }
})
root.addEventListener('click', async e => {
  const clicked = e.target.closest('button')
  if (!clicked) return
  const action = clicked.dataset.action, nav = clicked.dataset.tab
  if (!action && !nav) return
  if (busyOperations) { notice('Wait for the current request to finish.'); return }
  busyOperations++
  try {
    captureWork()
    if (nav) { tab = nav; credentials = null; await render(); return }
    clicked.disabled = true
    const actions = {
      'desktop-link': async () => {
        const link = 'http://127.0.0.1:5195/#access=' + token
        try { await navigator.clipboard.writeText(link); notice('Expiring teacher session link copied. Keep it private.') }
        catch { document.querySelector('#desktop-link-result').innerHTML = '<label>Expiring teacher session link<input readonly value="' + E(link) + '"></label>' }
      },
      logout: async () => { await api('logout', {}); forgetSession(); tab = 'overview'; login() },
      account: async () => { tab = 'account'; await render() },
      'account-back': async () => { tab = 'overview'; await render() },
      'manage-class': async () => { tab = 'classmates'; await render() },
      'copy-credentials': async () => { await navigator.clipboard.writeText('Chalkline: ' + (state.classroomUrl || location.origin) + '\nUsername: ' + credentials.username + '\nPassword: ' + credentials.password); notice('Sign-in details copied. Share them privately with this student.') },
      'dismiss-credentials': async () => { credentials = null; await render() },
      'reset-student': async () => {
        const s = state.students.find(s => s.id === clicked.dataset.id)
        if (!confirm('Reset ' + s.name + '’s password? Their open sessions will be signed out. You will need to share the new password privately.')) return
        const result = await api('students/reset', { classId: currentClassId, studentId: s.id })
        credentials = result.credentials || result; await render()
      },
      'remove-student': async () => {
        const s = state.students.find(s => s.id === clicked.dataset.id)
        if (!confirm('Remove ' + s.name + ' from this class? They will lose access to this class and its assignments. Their existing work stays in teacher records.')) return
        await api('students/remove', { classId: currentClassId, studentId: s.id })
        credentials = null; await load(); await render(); notice('Student removed from this class.')
      },
      refresh: async () => { await load(); await render(); notice('Classroom updated.') },
      studio: async () => { tab = 'studio'; await render() },
      inspect: async () => { selected = clicked.dataset.id; tab = 'assignments'; await render() },
      learn: async () => { selected = clicked.dataset.id; await render() },
      'student-home': async () => { selected = ''; await load(); await render() },
      preview: async () => { if (dirty) throw new Error('Save your edits before previewing this version.'); await showPreview(); previewed = state.draft.revision; notice('Preview ready. Review the activity and script before assigning.') },
      'export-html': () => { if (dirty) throw new Error('Save your changes before exporting.'); return download(scoped('lesson-html'), 'chalkline-lesson.html') },
      render: async () => { if (dirty) throw new Error('Save your changes before making the video.'); await api('media', { classId: currentClassId, revision: state.draft.revision }); await load(); await render() },
      'download-video': () => download('media-file?asset=' + clicked.dataset.asset + '&file=explanation.mp4', 'chalkline-explanation.mp4'),
      'download-captions': () => download('media-file?asset=' + clicked.dataset.asset + '&file=captions.vtt', 'chalkline-captions.vtt'),
      followup: async () => { const result = await api('followup', { classId: currentClassId, assignmentId: clicked.dataset.id }); working = result.lesson; dirty = true; previewed = 0; tab = 'studio'; await render(); notice('Follow-up draft created. Review and save before assigning.') },
      'retry-progress': () => retryRequest('progress', clicked.dataset.id),
      'retry-help': () => retryRequest('help', clicked.dataset.id),
      'retry-publish': () => retryRequest('publish', clicked.dataset.id),
      'reload-work': async () => {
        if (!confirm('Replace the answer kept in this browser with the latest saved work? Copy any thinking you want to keep first.')) return
        removeLocal(draftKey(selected)); removeLocal(requestKey('progress', selected))
        await load(); await render(); notice('Latest saved work loaded.')
      }
    }
    if (actions[action]) await actions[action]()
  } catch (error) { notice(error.message, true) }
  finally { busyOperations--; clicked.disabled = false }
})
root.addEventListener('submit', async e => {
  e.preventDefault()
  const form = e.target, submitter = e.submitter, data = new FormData(form), requestToken = token
  if (form.dataset.busy || busyOperations) return
  busyOperations++
  form.dataset.busy = 'true'
  if (submitter) submitter.disabled = true
  try {
    if (form.id === 'login') {
      const result = await api('login', { username: String(data.get('username')).trim(), password: String(data.get('password')) })
      token = result.token; sessionStorage.setItem('chalkline-access', token); scheduleExpiry(result.expiresAt)
      currentClassId = ''; tab = 'overview'; selected = ''; working = null; dirty = false
      await load(); await render(); return
    }
    if (form.id === 'password') {
      await api('password', { currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') })
      forgetSession(); login(); notice('Password changed. Sign in with your new password.'); return
    }
    if (form.id === 'class-create') {
      const result = await api('classes', { name: data.get('name'), ...(college() ? { kind: data.get('kind') } : {}) })
      currentClassId = result.id || result.class?.id; selected = ''; working = null; dirty = false; previewed = 0; credentials = null
      await load(); await render(); notice('Class created. Add its first learner.'); return
    }
    if (form.id === 'student-enroll') {
      await api('students/enroll', { classId: currentClassId, username: data.get('username') })
      await load(); await render(); notice('Student enrolled with their existing sign-in.'); return
    }
    if (form.id === 'template-load') {
      if (dirty && !confirm('Replace your unsaved module draft?')) return
      const result = await api('template', { classId: currentClassId, kind: data.get('kind') })
      working = result.lesson; dirty = true; previewed = 0; await render(); notice('Template loaded as an unsaved draft. Review and save it.'); return
    }
    if (form.id === 'student-add') {
      const result = await api('students', { classId: currentClassId, name: data.get('name'), username: data.get('username') })
      credentials = result.credentials; await load(); await render(); notice('Student sign-in created. Save and share these details privately.'); return
    }
    if (form.id === 'lesson-form') {
      state.draft = await api('lesson', { classId: currentClassId, lesson: collectLesson(), revision: state.draft.revision })
      working = null; dirty = false; previewed = 0; await render(); notice('Lesson saved. Preview the new version before assigning.')
    }
    if (form.id === 'generate') {
      if (college() && dirty) throw new Error('Save your module and readings before drafting with AI.')
      const result = await api('generate', { classId: currentClassId, brief: data.get('brief') })
      working = result.lesson; dirty = true; previewed = 0; await render(); notice('AI draft ready. Check the explanation and answer key, then save.')
    }
    if (form.id === 'publish') {
      if (dirty || previewed !== state.draft.revision) throw new Error('Preview the current saved lesson before assigning it.')
      const media = state.media.find(m => m.revision === state.draft.revision)
      if (media?.status === 'rendering') throw new Error('Wait for the video to finish so it can be included.')
      try { await mutate('publish', { classId: currentClassId, revision: state.draft.revision, students: data.getAll('students'), due: data.get('due'), mode: data.get('mode'), reviewed: data.get('reviewed') === 'on' }, currentClassId) }
      catch (error) { showMutationError('publish', currentClassId, error); throw error }
      await load(); tab = 'assignments'; await render(); notice('Assigned. Students can open this reviewed version now.')
    }
    if (form.id === 'work') {
      const assignmentId = selected
      captureWork()
      const draft = readLocal(draftKey(assignmentId))
      const body = { assignmentId, revision: draft?.revision ?? state.assignments.find(a => a.id === assignmentId).work[0]?.revision ?? 0, answer: data.get('answer') === null ? null : Number(data.get('answer')), reasoning: String(data.get('reasoning') || ''), submit: submitter?.value === 'submit' }
      if (body.submit) form.querySelector('fieldset').disabled = true
      try { const result = await mutate('progress', body, assignmentId); if (token === requestToken) await finishProgress(result, assignmentId, body.submit, body) }
      catch (error) { showMutationError('progress', assignmentId, error); throw error }
    }
    if (form.id === 'help') {
      const assignmentId = selected, question = data.get('question')
      try { const result = await mutate('help', { assignmentId, question }, assignmentId); if (token === requestToken) appendHelp({ ...result, question }, assignmentId) }
      catch (error) { showMutationError('help', assignmentId, error); throw error }
    }
    if (form.dataset.feedback) {
      await api('feedback', { classId: currentClassId, assignmentId: form.dataset.assignment, studentId: form.dataset.feedback, feedback: data.get('feedback') })
      await load(); notice('Feedback shared with the student.')
    }
  } catch (error) { notice(error.message, true) }
  finally { busyOperations--; delete form.dataset.busy; if (form.id === 'work' && form.isConnected) form.querySelector('fieldset').disabled = false; if (submitter) submitter.disabled = false }
})
window.addEventListener('offline', () => { captureWork(); notice('You are offline. Keep this tab open or return later; your typed work is kept in this browser.', true) })
window.addEventListener('online', () => notice('Connection restored. Save your progress or retry any request that was interrupted.'))
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = '' } })
async function start(){const info=await api("info");edition=info.edition||"school";document.body.dataset.edition=edition;document.title=college()?"Chalkline College · Course workspace":"Chalkline · Learn together";if(token){if(!incomingSession)scheduleExpiry(sessionStorage.getItem("chalkline-expires"));await load();await render()}else login()}
start().catch(error=>{login();notice(error.message,true)})

function collegeLogin() {
  return '<main class="login college-login"><div class="brand"><span class="brandmark">c</span>chalkline <small class="college-wordmark">COLLEGE</small></div><p class="eyebrow">A workspace for deeper understanding</p><h1>Explore the concept.<br>Develop your argument.</h1><p>Course modules, evidence, and study support in one place.</p><form id="login"><label>Username<input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64"></label><label>Password<input name="password" required autocomplete="current-password" type="password"></label><button>Sign in</button></form><p class="notice-inline">Use the account your instructor shared. This private demonstration uses fictional college courses and students.</p></main>'
}
function collegeTemplateOptions(kind) {
  return (state.templates || []).map(t => '<option value="' + E(t.kind) + '" ' + (t.kind === kind ? 'selected' : '') + '>' + E(t.label) + '</option>').join('')
}
function collegeModuleMeta(l) {
  return '<div class="module-meta"><span class="pill">' + E(l.courseCode) + '</span><span>' + E(l.module) + '</span><span>' + E(l.estimatedMinutes) + ' min suggested study time</span></div>'
}
function collegeOverview() {
  const submitted = state.assignments.reduce((n,a) => n + a.work.filter(w => w.submitted).length,0)
  const questions = state.assignments.reduce((n,a) => n + a.help.length,0)
  return '<section class="hero college-hero"><div><p class="eyebrow">Chalkline College / Instructor workspace</p><h1>Make room for<br>deeper thinking.</h1><p>Turn course material into an explanation, an exploration, and a question worth investigating.</p>' + button('studio','Build a course module →') + '</div><div class="college-art" aria-hidden="true"><span>01 / EXPLORE</span><strong>Evidence<br>before<br>conclusions.</strong><span>02 / QUESTION &nbsp; 03 / REFLECT</span></div></section>' +
    '<div class="stats"><div class="stat"><b>' + state.assignments.length + '</b><small>Published modules</small></div><div class="stat"><b>' + submitted + '</b><small>Submitted analyses</small></div><div class="stat"><b>' + questions + '</b><small>Course questions</small></div></div>' +
    '<section class="panel"><div class="pagehead"><div><p class="eyebrow">Current course</p><h2>' + E(state.classes.find(c=>c.id===currentClassId)?.name) + '</h2></div>' + button('refresh','Refresh','',true) + '</div>' + assignmentRows() + '</section>' +
    '<div class="split"><section class="panel"><p class="eyebrow">A starting point</p><h2>Two ways to investigate.</h2><p>Explore correlation and confounding with a fictional dataset, or build a close-reading seminar from a supplied passage.</p>' + button('studio','Open Module Studio','',true) + '</section><section class="panel"><p class="eyebrow">Connected coursework</p><h2>One account. Multiple courses.</h2><p>Enroll students, publish reviewed modules, and respond to the actual questions and analyses they share.</p>' + button('manage-class','Manage courses & enrollment','',true) + '</section></div>'
}
function collegeClassmates() {
  return head('Courses & enrollment','Bring your course together.','Create courses and share individual accounts privately. A student can use the same sign-in across your courses.') + credentialCard() +
    '<div class="grid"><section class="panel"><h2>Enrolled students</h2><p class="muted">Students can only access modules assigned to them in courses where they are enrolled.</p>' + studentLinks() + '</section><aside><section class="panel"><h2>Add a new student</h2><form id="student-add"><label>Student name<input name="name" maxlength="100" required></label><label>Student username<input name="username" maxlength="64" minlength="3" required autocapitalize="none" spellcheck="false"></label><button>Create student sign-in</button></form></section>' +
    '<section class="panel"><h2>Enroll an existing student</h2><p class="muted">Use a username from another course you own. Their password stays the same.</p><form id="student-enroll"><label>Existing student username<input name="username" required maxlength="64" autocapitalize="none"></label><button>Enroll in this course</button></form></section>' +
    '<section class="panel"><h2>Create another course</h2><form id="class-create"><label>Course name<input name="name" maxlength="100" required placeholder="ENG 101 · Academic Writing"></label><label>Starting module<select name="kind">' + collegeTemplateOptions('college-seminar') + '</select></label><button>Create course</button></form></section></aside></div>'
}
function collegeStudioStart(l) {
  return '<section class="panel"><p class="eyebrow">Choose your teaching format</p><h2>Start with evidence.</h2><form id="template-load"><label>Module format<select name="kind">' + collegeTemplateOptions(l.kind) + '</select></label><button class="secondary">Load template as draft</button></form><p class="muted">The statistics lab uses fixed, explicitly fictional data. The reading seminar uses your supplied passages.</p><form id="generate" class="divider"><label>What should this explanation focus on?<textarea name="brief" maxlength="1800" placeholder="Explain an assumption, compare interpretations, or adapt the discussion for this course."></textarea></label><button>Draft with AI</button><p><small>AI uses your saved module and readings. Save edits first, then check the generated draft before publishing.</small></p></form></section>'
}
function collegeMetaEditor(l) {
  return '<div class="split">' + field('courseCode','Course code',l.courseCode) + field('module','Module / week',l.module) + '</div>' + field('estimatedMinutes','Suggested study time (minutes)',l.estimatedMinutes,false,'number')
}
function collegeReadingEditor(l) {
  return [0,1,2].map(i => {
    const r = l.readings?.[i] || {}
    return '<details ' + (r.title ? 'open' : '') + '><summary>Reading ' + (i+1) + (r.title ? ' · '+E(r.title) : ' · Optional') + '</summary><label>Reading '+(i+1)+' title<input name="readingTitle'+i+'" maxlength="160" value="'+E(r.title)+'"></label><label>Reading '+(i+1)+' HTTPS link (optional)<input type="url" name="readingUrl'+i+'" maxlength="2000" value="'+E(r.url)+'"></label><label>Reading '+(i+1)+' excerpt<textarea name="readingExcerpt'+i+'" maxlength="1800">'+E(r.excerpt)+'</textarea></label></details>'
  }).join('')
}
function collegeReadingPanel(l) {
  if (!l.readings?.length) return ''
  return '<section class="panel readings-panel"><p class="eyebrow">Course readings</p><h2>Read before you respond.</h2><p class="muted">Instructor-supplied material. The AI sees the excerpts shown here; it does not retrieve linked pages.</p>' + l.readings.map((r,i)=>'<details><summary>'+(i+1)+'. '+E(r.title)+'</summary><p class="reading-excerpt">'+E(r.excerpt)+'</p>'+(r.url?'<a href="'+E(r.url)+'" target="_blank" rel="noopener noreferrer">Open reading source ↗</a>':'<small>Passage supplied within this module.</small>')+'</details>').join('')+'</section>'
}
function collegeStudentHome() {
  const rows = [...state.assignments].sort((a,b)=>a.due.localeCompare(b.due))
  const open = rows.filter(a=>!a.work[0]?.submitted)
  const time = open.reduce((n,a)=>n+(a.lesson.estimatedMinutes||0),0)
  return head('Your course workspace','Build your understanding.','Explore the material, test an explanation, and develop your own response.') +
    '<div class="stats"><div class="stat"><b>'+open.length+'</b><small>Modules to complete</small></div><div class="stat"><b>'+time+'</b><small>Suggested study minutes</small></div><div class="stat"><b>'+rows.filter(a=>a.work[0]?.feedback).length+'</b><small>Instructor responses</small></div></div>' +
    '<p class="notice-inline">Your instructor can see your submitted and saved work, plus every study-help question and reply in this course. Follow the assistance policy shown in each module.</p>' +
    (rows.length ? rows.map(a=>{
      const w=a.work[0], today=new Date().toLocaleDateString('en-CA')
      return '<section class="panel course-card"><p class="eyebrow">Due '+E(a.due)+' · '+(w?.submitted?'Submitted':a.due<today?'Past due':a.due===today?'Due today':'Upcoming')+'</p>'+collegeModuleMeta(a.lesson)+'<h2>'+E(a.title)+'</h2><p>'+E(a.lesson.objective)+'</p><div class="actions">'+button('learn',w?.submitted?'Review your submission':'Open module →','data-id="'+E(a.id)+'"')+'<span class="pill">'+(w?.submitted?'Submitted':w?'Draft saved':'Ready to start')+'</span></div>'+(w?.feedback?'<p class="notice-inline"><b>Instructor feedback:</b> '+E(w.feedback)+'</p>':'')+'</section>'
    }).join('') : '<section class="panel empty">No modules have been assigned in this course yet.</section>')+button('refresh','Refresh coursework','',true)
}
