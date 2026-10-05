import { randomBytes, scryptSync, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
const derive = promisify(scrypt)
const options = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export const newPassword = () => randomBytes(18).toString('base64url')
export function normalizeUsername(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value.trim()))
    throw Object.assign(new Error('Use a username of 3–64 letters, numbers, dots, dashes or underscores.'), { status: 400 })
  return value.trim().toLowerCase()
}
export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256)
    throw Object.assign(new Error('Use a password between 12 and 256 characters.'), { status: 400 })
  return value
}
export function passwordRecord(password) {
  validatePassword(password)
  const salt = randomBytes(16).toString('hex')
  return { salt, password_hash: scryptSync(password, salt, 32, options).toString('hex') }
}
export async function checkPassword(password, record) {
  if (typeof password !== 'string' || password.length > 256) return false
  const salt = record?.salt || '00000000000000000000000000000000'
  const expected = Buffer.from(record?.password_hash || '0'.repeat(64), 'hex')
  const actual = await derive(password, salt, 32, options)
  return expected.length === actual.length && timingSafeEqual(expected, actual) && Boolean(record)
}
