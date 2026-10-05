import { uploadMetadata, readUpload, extractSource } from './sources.mjs'
import { draftTeachingPlan, planningInput } from './planner.mjs'
import http from 'node:http'
import https from 'node:https'
import { createReadStream, readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isIP } from 'node:net'
import { randomUUID, createHash } from 'node:crypto'
import { ClassroomStore } from './store.mjs'
import { Tutor, followupLesson } from './tutor.mjs'
import { lessonHtml } from './lesson.mjs'
import { renderVideo } from './media.mjs'
import { acquireRuntimeLock } from './runtime-lock.mjs'
const root = fileURLToPath(new URL('.', import.meta.url))
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.txt': 'text/plain' }
const statusError = (message, status = 400) => Object.assign(new Error(message), { status })
const loopback = host => ['127.0.0.1', '::1', 'localhost'].includes(host)
export function transportSettings(config = {}) {
  const host = config.host || '127.0.0.1'
  if (host !== 'localhost' && !isIP(host)) throw new Error('Set server.host to a local IP address.')
  const tls = config.tls
  if (tls && (!tls.certFile || !tls.keyFile)) throw new Error('HTTPS requires both certificate and private-key files.')
  let publicOrigin = ''
  if (config.publicOrigin) {
    const url = new URL(config.publicOrigin)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('server.publicOrigin must be an HTTPS origin without a path or credentials.')
    publicOrigin = url.origin
  }
  if (!loopback(host) && (!tls || !publicOrigin))
    throw new Error('Network listening requires HTTPS certificate files and an explicit HTTPS publicOrigin.')
  if (tls && !publicOrigin) throw new Error('Set publicOrigin for the HTTPS classroom.')
  return { host, tls, publicOrigin }
}
function requestId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(value)) throw statusError('A valid request identifier is required.')
  return value
}
export function createClassroom({ dataDir = join(root, 'data'), config = {}, tutor = new Tutor(config.ai, { edition:config.edition || 'school' }), render = renderVideo, extract = extractSource } = {}) {
  const transport = transportSettings(config.server)
  const tlsOptions = transport.tls ? { cert: readFileSync(transport.tls.certFile), key: readFileSync(transport.tls.keyFile), minVersion: 'TLSv1.2' } : null
  const instanceId = randomUUID()
  const store = new ClassroomStore(dataDir, {edition:config.edition || 'school'})
  const mediaDir = join(dataDir, 'media')
  mkdirSync(mediaDir, { recursive: true })
  store.db.prepare("UPDATE media SET status='error',detail='Rendering was interrupted. Try again.' WHERE status='rendering'").run()
  let extracting = false
  const extractions = new Map()
  const jobs = new Map(), cooldowns = new Map(), pendingHelp = new Map(), loginAttempts = new Map()
  let loginActive = 0, origin = '', localOrigin = '', closing = false
  function json(res, value, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(value))
  }
  async function body(req,limit=32768) {
    if (!String(req.headers['content-type']).startsWith('application/json')) throw statusError('JSON is required.', 415)
    let bytes = 0
    const parts = []
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > limit) throw statusError('Request too large.', 413)
      parts.push(chunk)
    }
    let value
    try { value = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { throw statusError('Invalid JSON.') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw statusError('A JSON object is required.')
    return value
  }
  const teacher = p => { if (p.role !== 'teacher') throw statusError('Teacher access required.', 403) }
  const student = p => { if (p.role !== 'student') throw statusError('Student access required.', 403) }
  async function signIn(req, data) {
    const now = Date.now(), address = req.socket.remoteAddress || 'unknown'
    for (const [key, entry] of loginAttempts) if (now - entry.start > 900000) loginAttempts.delete(key)
    // Use the socket address; never trust client-supplied forwarding headers.
    const username = typeof data.username === 'string' ? data.username.trim().toLowerCase().slice(0, 80) : ''
    const accountKey = address + ':' + username
    const entry = loginAttempts.get(accountKey) || { start: now, count: 0 }
    const totalKey = address + ':*', total = loginAttempts.get(totalKey) || { start: now, count: 0 }
    if (entry.count >= 10 || total.count >= 200) throw statusError('Too many sign-in attempts. Wait a few minutes and try again.', 429)
    if (loginActive >= 32) throw statusError('Sign-in is busy. Try again in a moment.', 429)
    entry.count++; total.count++; loginAttempts.set(accountKey, entry); loginAttempts.set(totalKey, total); loginActive++
    try {
      const signedIn = await store.login(data)
      entry.count = 0; total.count = Math.max(0, total.count - 1)
      return signedIn
    } finally { loginActive-- }
  }
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' http://127.0.0.1:* file:")
    if (transport.tls) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    try {
      if (closing) throw statusError('The classroom is restarting. Your saved work is safe. Try again shortly.', 503)
      const accepted = [origin, ...(loopback(transport.host) && !transport.tls ? [localOrigin] : [])]
      const allowedHosts = accepted.map(url => new URL(url).host.toLowerCase())
      if (!allowedHosts.includes(String(req.headers.host || '').toLowerCase())) throw statusError('Use the configured classroom address.', 403)
      if (req.headers.origin && !accepted.includes(req.headers.origin)) throw statusError('Origin not allowed.', 403)
      if (req.headers['sec-fetch-site'] === 'cross-site' && req.url.startsWith('/api/')) throw statusError('Cross-site requests are not allowed.', 403)
      const url = new URL(req.url, origin), path = url.pathname
      if (req.method === 'GET' && path === '/health') {
        json(res, { service: 'chalkline-classroom', version: 2, edition:store.edition, instanceId, mode: transport.publicOrigin ? 'synthetic-shared' : 'synthetic-local' }); return
      }
      if (req.method === 'GET' && path === '/api/info') {
        json(res, { version: 2, edition:store.edition, templates:store.templates(), mode: 'synthetic', origin, signIn: 'password', remote: Boolean(transport.publicOrigin) }); return
      }
      if (!path.startsWith('/api/')) {
        const routes = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/planner.js': 'planner.js' }
        if (req.method !== 'GET' || !routes[path]) throw statusError('Not found.', 404)
        const file = routes[path], ext = file.slice(file.lastIndexOf('.'))
        res.writeHead(200, { 'Content-Type': types[ext] + '; charset=utf-8' }); res.end(readFileSync(join(root, 'public', file))); return
      }
      if (req.method === 'POST' && path === '/api/login') { json(res, await signIn(req, await body(req))); return }
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1]
      const p = store.principal(bearer)
      if (!p) throw statusError('Sign in to your classroom. Your session may have expired.', 401)
      const liveSession = () => { if (!store.principal(bearer)) throw statusError('Your session ended. Sign in again.', 401) }
      if(req.method==='GET'&&path==='/api/sources'){teacher(p);const classId=url.searchParams.get('classId');json(res,{sources:store.listSources(p,classId),plan:store.teachingPlan(p,classId)});return}
      if(req.method==='GET'&&path==='/api/source'){teacher(p);json(res,{source:store.getSources(p,{classId:url.searchParams.get('classId'),sourceIds:[url.searchParams.get('id')]})[0]});return}
      if(req.method==='POST'&&path==='/api/source-upload'){
        teacher(p);const classId=url.searchParams.get('classId');store.draft(p,classId)
        const metadata=uploadMetadata(url.searchParams)
        if(extracting)throw statusError('Another document is being extracted. Try again shortly.',429)
        extracting=true;const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort()}
        res.on('close',cancel)
        const task=(async()=>{const buffer=await readUpload(req);liveSession();const existing=store.listSources(p,classId),hash=createHash('sha256').update(buffer).digest('hex'),duplicate=existing.find(s=>s.hash===hash);if(duplicate)return {source:duplicate,duplicate:true};if(existing.length>=24)throw statusError('This class already has 24 sources. Remove an unused source first.',409);const source=await extract(buffer,metadata,{signal:controller.signal});liveSession();return store.addSource(p,{classId,source})})()
        extractions.set(controller,task)
        try{json(res,await task)}finally{extracting=false;extractions.delete(controller);res.off('close',cancel)}
        return
      }
      if (req.method === 'GET' && path === '/api/state') { json(res, { ...store.state(p, url.searchParams.get('classId') || undefined), classroomUrl: origin }); return }
      if (req.method === 'GET' && path === '/api/lesson-html') {
        let lesson
        if (url.searchParams.has('assignment')) lesson = store.assignment(url.searchParams.get('assignment'), p).lesson
        else { teacher(p); lesson = store.draft(p, url.searchParams.get('classId') || undefined).lesson }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="chalkline-lesson.html"' })
        res.end(lessonHtml(lesson)); return
      }
      if (req.method === 'GET' && path === '/api/media-file') {
        const asset = url.searchParams.get('asset'), file = url.searchParams.get('file')
        if (!/^lesson-\d+$/.test(asset || '') || !['explanation.mp4', 'captions.vtt', 'transcript.txt'].includes(file) || !store.canAccessAsset(p, asset)) throw statusError('Not found.', 404)
        const target = join(mediaDir, asset, file)
        if (!existsSync(target)) throw statusError('Video is not ready.', 404)
        const size = statSync(target).size
        res.writeHead(200, { 'Content-Type': types[file.slice(file.lastIndexOf('.'))], 'Content-Length': size })
        const stream = createReadStream(target)
        stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return
      }
      if (req.method !== 'POST') throw statusError('Not found.', 404)
      const data = await body(req,path==='/api/plan'?100000:32768)
      liveSession()
      const actions = {
        '/api/source-delete':()=>{teacher(p);return store.deleteSource(p,data)},
        '/api/plan':()=>{teacher(p);return store.saveTeachingPlan(p,data)},
        '/api/plan-generate':async()=>{
          teacher(p);planningInput(data);const sources=store.getSources(p,{classId:data.classId,sourceIds:data.sourceIds})
          let plan;try{plan=await draftTeachingPlan(tutor,data,sources)}catch{throw statusError('AI could not produce a complete, valid plan. Your sources are saved. Try again with a shorter brief.',503)}
          liveSession();store.getSources(p,{classId:data.classId,sourceIds:data.sourceIds});return {plan}
        },
        '/api/logout': () => { store.logout(bearer); return { signedOut: true } },
        '/api/password': () => store.changePassword(p, data),
        '/api/classes': () => { teacher(p); return store.createClass(p, data) },
        '/api/students': () => { teacher(p); return store.addStudent(p, data) },
        '/api/students/enroll': () => { teacher(p); return store.enrollExistingStudent(p,data) },
        '/api/template': () => { teacher(p); return store.template(p,data) },
        '/api/students/reset': () => { teacher(p); return store.resetStudent(p, data) },
        '/api/students/remove': () => { teacher(p); return store.removeStudent(p, data) },
        '/api/lesson': () => { teacher(p); return store.save(p, data) },
        '/api/publish': () => { teacher(p); requestId(data.requestId); return store.publish(p, data) },
        '/api/progress': () => { student(p); requestId(data.requestId); return store.saveWork(p, data) },
        '/api/feedback': () => { teacher(p); return store.feedback(p, data) },
        '/api/generate': async () => {
          teacher(p); const draft = store.draft(p, data.classId)
          if (typeof data.brief !== 'string' || !data.brief.trim() || data.brief.length > 1800) throw statusError('Describe the lesson in up to 1,800 characters.')
          let lesson
          try { lesson = await tutor.generate(data.brief,draft.lesson) } catch { throw statusError('AI drafting is unavailable. You can edit the ready-made lesson and all narration below.', 503) }
          liveSession(); return { lesson }
        },
        '/api/help': async () => {
          student(p); requestId(data.requestId)
          const assignment = store.assignment(data.assignmentId, p)
          if (typeof data.question !== 'string' || !data.question.trim() || data.question.length > 1200) throw statusError('Ask a question in up to 1,200 characters.')
          const question = data.question.trim(), existing = store.getHelpByRequest(p, assignment.id, data.requestId)
          if (existing) {
            if (existing.question !== question) throw statusError('This request was already used for another question.', 409)
            return existing
          }
          const key = p.id + ':' + assignment.id + ':' + data.requestId
          if (pendingHelp.has(key)) {
            const pending = pendingHelp.get(key)
            if (pending.question !== question) throw statusError('This request was already used for another question.', 409)
            const result = await pending.promise; liveSession(); return result
          }
          if (Date.now() - (cooldowns.get(p.id) || 0) < 1500) throw statusError('Give your helper a moment before asking again.', 429)
          cooldowns.set(p.id, Date.now())
          const promise = (async () => {
            const history = store.listHelp(p, assignment.id, 3)
            const result = await tutor.help(assignment, question, history)
            liveSession()
            return store.addHelp(p, assignment.id, question, result, data.requestId)
          })()
          pendingHelp.set(key, { question, promise })
          try { return await promise } finally { pendingHelp.delete(key) }
        },
        '/api/media': () => {
          teacher(p)
          const draft = store.draft(p, data.classId)
          if (data.revision !== draft.revision) throw statusError('Save and reload the current lesson before making the video.', 409)
          const existing = store.getMedia(p, { classId: data.classId, revision: draft.revision })
          if (existing?.status === 'ready') return existing
          if (jobs.size) throw statusError('A video is already rendering. Please wait.', 409)
          store.saveMedia(p, { classId: data.classId, revision: draft.revision, status: 'rendering', detail: 'Creating narration and animation…' })
          const job = Promise.resolve().then(() => render(draft.lesson, draft.revision, mediaDir, {...(config.media || {}),edition:store.edition}))
            .then(asset => store.saveMedia(p, { classId: data.classId, revision: draft.revision, status: 'ready', detail: 'Narrated video, captions and transcript ready.', asset }))
            .catch(error => {
              console.error('Video rendering failed:', error.message)
              store.saveMedia(p, { classId: data.classId, revision: draft.revision, status: 'error', detail: 'Video rendering failed. Check the service log, then retry.' })
            }).finally(() => jobs.delete(draft.revision))
          jobs.set(draft.revision, job)
          return { status: 'rendering' }
        },
        '/api/followup': () => {
          teacher(p)
          const a = store.assignment(data.assignmentId, p), questions = store.listHelp(p, a.id, 6)
          if (!questions.length) throw statusError('There are no student questions for this assignment yet.')
          return { lesson: followupLesson(a,questions) }
        }
      }
      if (!actions[path]) throw statusError('Not found.', 404)
      json(res, await actions[path]())
    } catch (error) {
      const status = error.status || (error.code?.includes('SQLITE') ? 500 : 400)
      if (status === 429) res.setHeader('Retry-After', '60')
      json(res, { error: status >= 500 && status !== 503 ? 'The classroom service could not finish that action. Please try again.' : error.message }, status)
    }
  }
  const server = transport.tls ? https.createServer(tlsOptions, handler) : http.createServer(handler)
  server.requestTimeout = 60000
  server.headersTimeout = 15000
  return {
    server, store, jobs, instanceId,
    listen: async (port = Number(config.server?.port || 5195)) => {
      await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, transport.host, ok) })
      const address = transport.host === '::1' ? '[::1]' : '127.0.0.1'
      localOrigin = (transport.tls ? 'https' : 'http') + '://' + address + ':' + server.address().port
      origin = transport.publicOrigin || localOrigin
      return origin
    },
    close: async () => {
      closing = true
      for(const controller of extractions.keys())controller.abort()
      server.closeAllConnections()
      await new Promise(ok => server.close(ok))
      await Promise.allSettled([...extractions.values(), ...jobs.values(), ...[...pendingHelp.values()].map(v => v.promise)])
      store.close()
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = (name, fallback) => { const n = args.indexOf(name); return n >= 0 ? args[n + 1] : fallback }
  const dataDir = resolve(value('--data', join(root, 'data')))
  const configFile = value('--config', join(dataDir, 'config.json'))
  const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')) : {}
  const release = acquireRuntimeLock(dataDir)
  let app
  try {
    app = createClassroom({ dataDir, config })
    const origin = await app.listen(Number(value('--port', config.server?.port || '5195')))
    writeFileSync(join(dataDir, 'launch.json'), JSON.stringify({ origin, teacherUrl: origin, bootstrapFile: join(dataDir, 'bootstrap.json'), pid: process.pid, version: 2, edition:app.store.edition, instanceId: app.instanceId }, null, 2), { mode: 0o600 })
    console.log('Chalkline classroom ready at ' + origin + ' (synthetic classroom; initial credentials are in the private bootstrap file).')
    let stopping = false
    const stop = async () => { if (stopping) return; stopping = true; await app.close(); release(); process.exit(0) }
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
  } catch (error) {
    if (app) await app.close()
    release()
    throw error
  }
}
