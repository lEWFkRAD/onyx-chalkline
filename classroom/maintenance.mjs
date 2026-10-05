import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, constants, realpathSync } from 'node:fs'
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquireRuntimeLock, assertLegacyServiceStopped, LOCK_FILE } from './runtime-lock.mjs'
const PRIVATE_FILES = ['access.json', 'bootstrap.json', 'identity.json', 'config.json']
const DB = 'classroom.sqlite', MANIFEST = 'backup-manifest.json'
const allowed = name => name === DB || PRIVATE_FILES.includes(name) || name.startsWith('media/')
function directory(path) {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Use a regular directory; symbolic links are not supported for maintenance.')
  return realpathSync(path)
}
function filename(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p)) || !allowed(name))
    throw new Error('Backup contains an invalid file path.')
  return name
}
function filesBelow(root, prefix = '') {
  const result = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isSymbolicLink()) throw new Error('Symbolic links cannot be included in a backup.')
    if (entry.isDirectory()) result.push(...filesBelow(root, name))
    else if (entry.isFile()) result.push(name)
    else throw new Error('Backup contains an unsupported filesystem entry.')
  }
  return result.sort()
}
async function checksum(path) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}
function sqliteCheck(path) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = db.prepare('PRAGMA quick_check').all()
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error('SQLite integrity check failed.')
  } finally { db.close() }
}
function targetPath(path) {
  const target = resolve(path), parent = directory(dirname(target))
  return join(parent, relative(dirname(target), target))
}
function separate(source, destination) {
  for (const [a, b] of [[source, destination], [destination, source]]) {
    const rel = relative(a, b), outside = rel === '..' || rel.startsWith('..' + sep)
    if (!rel || (!outside && !isAbsolute(rel))) throw new Error('Source and destination directories must be separate, not nested.')
  }
}
function copyPrivate(source, target) {
  if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) throw new Error('Only regular files can be copied.')
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  copyFileSync(source, target, constants.COPYFILE_EXCL)
  chmodSync(target, 0o600)
}
export async function validateBackup(backupDir) {
  const root = directory(resolve(backupDir))
  const actual = filesBelow(root).filter(name => name !== MANIFEST)
  let manifest
  try { manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')) }
  catch { throw new Error('A complete backup manifest is required.') }
  if (manifest.format !== 'chalkline-backup' || manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100000)
    throw new Error('Unsupported or incomplete backup manifest.')
  const names = new Set()
  for (const file of manifest.files) {
    const name = filename(file.path)
    if (names.has(name) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('Invalid backup file metadata.')
    names.add(name)
    const path = join(root, name), stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes || await checksum(path) !== file.sha256) throw new Error('Backup checksum verification failed.')
  }
  if (!names.has(DB)) throw new Error('Backup does not contain the classroom database.')
  if (actual.length !== names.size || actual.some(name => !names.has(name))) throw new Error('Backup contains files not covered by the manifest.')
  sqliteCheck(join(root, DB))
  return { root, manifest }
}
export async function createBackup(dataDir, outputDir) {
  const source = directory(resolve(dataDir)), output = targetPath(outputDir)
  separate(source, output)
  if (existsSync(output)) throw new Error('Backup output must be a new directory.')
  assertLegacyServiceStopped(source)
  const release = acquireRuntimeLock(source)
  try {
    assertLegacyServiceStopped(source)
    const dbPath = join(source, DB)
    if (!lstatSync(dbPath).isFile() || lstatSync(dbPath).isSymbolicLink()) throw new Error('A regular classroom database is required.')
    sqliteCheck(dbPath)
    mkdirSync(output, { mode: 0o700 })
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try { await sqliteBackup(db, join(output, DB)) } finally { db.close() }
    const snapshot = new DatabaseSync(join(output, DB))
    try { snapshot.exec('PRAGMA journal_mode=DELETE') } finally { snapshot.close() }
    chmodSync(join(output, DB), 0o600)
    for (const name of PRIVATE_FILES) if (existsSync(join(source, name))) copyPrivate(join(source, name), join(output, name))
    if (existsSync(join(source, 'media'))) {
      directory(join(source, 'media'))
      for (const name of filesBelow(source, 'media')) copyPrivate(join(source, filename(name)), join(output, name))
    }
    const files = []
    for (const name of filesBelow(output)) files.push({ path: filename(name), bytes: lstatSync(join(output, name)).size, sha256: await checksum(join(output, name)) })
    const manifest = { format: 'chalkline-backup', version: 1, created: new Date().toISOString(), files }
    writeFileSync(join(output, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await validateBackup(output)
    return { files: files.length }
  } finally { release() }
}
export async function restoreBackup(backupDir, dataDir) {
  const { root, manifest } = await validateBackup(backupDir), destination = targetPath(dataDir)
  separate(root, destination)
  if (existsSync(destination)) {
    directory(destination)
    if (readdirSync(destination).length) throw new Error('Restore destination must be new or empty. Existing data will not be overwritten.')
  } else mkdirSync(destination, { mode: 0o700 })
  const release = acquireRuntimeLock(destination)
  try {
    if (readdirSync(destination).some(name => name !== LOCK_FILE)) throw new Error('Restore destination changed; existing data will not be overwritten.')
    for (const file of manifest.files) {
      const target = join(destination, filename(file.path))
      copyPrivate(join(root, file.path), target)
      if (lstatSync(target).size !== file.bytes || await checksum(target) !== file.sha256) throw new Error('Restored file checksum verification failed.')
    }
    const db = new DatabaseSync(join(destination, DB))
    let revokedSessions = 0
    try {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'").get())
        revokedSessions = db.prepare('DELETE FROM sessions').run().changes
    } finally { db.close() }
    sqliteCheck(join(destination, DB))
    return { files: manifest.files.length, revokedSessions }
  } finally { release() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2), opts = {}
  try {
    if (args.length % 2) throw new Error('Provide a value for every option.')
    for (let i = 0; i < args.length; i += 2) {
      if (!['--data', '--output', '--backup'].includes(args[i]) || opts[args[i]]) throw new Error('Unknown or repeated option.')
      opts[args[i]] = args[i + 1]
    }
    if (command === 'backup' && opts['--data'] && opts['--output'] && !opts['--backup']) {
      const result = await createBackup(opts['--data'], opts['--output'])
      console.log(`Backup verified: ${result.files} files. Keep this directory private.`)
    } else if (command === 'restore' && opts['--backup'] && opts['--data'] && !opts['--output']) {
      const result = await restoreBackup(opts['--backup'], opts['--data'])
      console.log(`Restore verified: ${result.files} files. All restored sessions were revoked; sign in again.`)
    } else if (command === 'validate' && opts['--backup'] && Object.keys(opts).length === 1) {
      const result = await validateBackup(opts['--backup'])
      console.log(`Backup verified: ${result.manifest.files.length} files.`)
    } else throw new Error('Usage: node maintenance.mjs backup --data DIR --output NEW_DIR | restore --backup DIR --data NEW_EMPTY_DIR | validate --backup DIR')
  } catch (error) { console.error('Maintenance failed: ' + error.message); process.exitCode = 1 }
}
