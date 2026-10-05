import { writeFileSync, existsSync, lstatSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { ClassroomStore } from './store.mjs'
import { acquireRuntimeLock } from './runtime-lock.mjs'
import { newPassword, normalizeUsername } from './identity.mjs'
const args = process.argv.slice(2), command = args.shift()
function arg(name) {
  const i = args.indexOf('--' + name)
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing --' + name)
  return args[i + 1]
}
let release, store, createdOutput = false, output
try {
  if (!['create-teacher', 'reset-teacher'].includes(command)) throw new Error('Use create-teacher or reset-teacher with --data DIR --username NAME --output NEW_PRIVATE_FILE; create-teacher also needs --name DISPLAY_NAME.')
  const dataDir = resolve(arg('data')), username = normalizeUsername(arg('username'))
  output = resolve(arg('output'))
  if (!existsSync(join(dataDir, 'classroom.sqlite'))) throw new Error('Initialize the classroom before managing its accounts.')
  try { lstatSync(output); throw new Error('The credential output must be a new file.') } catch (error) { if (error.code !== 'ENOENT') throw error }
  release = acquireRuntimeLock(dataDir)
  store = new ClassroomStore(dataDir, {edition:args.includes('--edition') ? arg('edition') : 'school'})
  const password = newPassword(), name = command === 'create-teacher' ? arg('name') : undefined
  writeFileSync(output, JSON.stringify({ username, password, createdAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  createdOutput = true
  if (command === 'create-teacher') store.createTeacher({ name, username, password })
  else store.resetTeacherCredentials({ username, password })
  createdOutput = false
  console.log('Teacher account updated. Sign-in details were written to the requested private file. Protect it and share it privately.')
} catch (error) {
  if (createdOutput) unlinkSync(output)
  console.error(error.message)
  process.exitCode = 1
} finally { store?.close(); release?.() }
