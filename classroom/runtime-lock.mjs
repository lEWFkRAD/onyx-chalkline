import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
export const LOCK_FILE = '.runtime-lock.json'
export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  try { process.kill(pid, 0); return true } catch (e) { return e.code !== 'ESRCH' }
}
const locked = message => Object.assign(new Error(message), { code: 'CLASSROOM_LOCKED' })
export function acquireRuntimeLock(dataDir) {
  const dir = resolve(dataDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (lstatSync(dir).isSymbolicLink()) throw locked('Use a regular data directory, not a symbolic link.')
  const path = join(dir, LOCK_FILE)
  const owner = { version: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), created: new Date().toISOString() }
  try { writeFileSync(path, JSON.stringify(owner), { flag: 'wx', mode: 0o600 }) }
  catch (e) {
    if (e.code !== 'EEXIST') throw e
    let current
    try { if (lstatSync(path).isSymbolicLink()) throw new Error('Symlink'); current = JSON.parse(readFileSync(path, 'utf8')) }
    catch { throw locked('The classroom lock cannot be verified. Stop the service and inspect the data directory.') }
    if (current.host === hostname() && !processAlive(current.pid))
      throw locked('A stopped process left a classroom lock. Verify all classroom processes are stopped, remove only .runtime-lock.json, then retry.')
    throw locked('The classroom data is in use or its owner cannot be verified. Stop the service before maintenance or another startup.')
  }
  let released = false
  return () => {
    if (released) return
    try {
      if (lstatSync(path).isSymbolicLink()) throw locked('The lock file changed unexpectedly.')
      const current = JSON.parse(readFileSync(path, 'utf8'))
      if (current.nonce === owner.nonce && current.pid === owner.pid) unlinkSync(path)
    } catch (e) { if (e.code !== 'ENOENT') throw e }
    released = true
  }
}
export function assertLegacyServiceStopped(dataDir) {
  const path = join(resolve(dataDir), 'launch.json')
  if (!existsSync(path)) return
  let launch
  try { launch = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) }
  catch { throw locked('The service launch record cannot be verified. Stop the service and inspect launch.json.') }
  if (processAlive(launch.pid)) throw locked('A classroom process recorded in launch.json is still running. Stop it before maintenance.')
}
