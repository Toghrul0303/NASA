/**
 * Supabase-compatible local auth client.
 *
 * Types mirror `@supabase/supabase-js` (`User`, `Session`) and a public `profiles` table.
 * Method names and the `{ data, error }` result shape follow `supabase.auth`, so a backend
 * developer can swap this module for the real client without touching any UI component.
 * Nothing here talks to a network. State lives in `localStorage`.
 */

export interface SupabaseUserMetadata {
  username: string
  first_name: string
  last_name: string
  full_name: string
  avatar_url: string | null
}

export interface SupabaseUser {
  id: string // UUID v4
  aud: 'authenticated'
  role: 'authenticated'
  email: string
  created_at: string // ISO-8601
  user_metadata: SupabaseUserMetadata
}

export interface SupabaseSession {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  expires_in: number
  expires_at: number // unix timestamp (seconds)
  user: SupabaseUser
}

export interface SupabaseProfileRow {
  id: string // references auth.users(id)
  username: string
  first_name: string
  last_name: string
  email: string
  avatar_url: string | null
  updated_at: string // ISO-8601
}

export interface SignUpInput {
  username: string
  first_name: string
  last_name: string
  email: string
  password: string
}

export interface SignInWithUsernameInput {
  username: string
  password: string
}

export interface AuthError {
  message: string
}

export type AuthResponse =
  | { data: { user: SupabaseUser; session: SupabaseSession }; error: null }
  | { data: { user: null; session: null }; error: AuthError }

export interface GetSessionResponse {
  data: { session: SupabaseSession | null }
  error: null
}

export interface GetProfileResponse {
  data: { profile: SupabaseProfileRow | null }
  error: null
}

export const USERS_KEY = 'exotrace.sb.users'
export const SESSION_KEY = 'exotrace.sb.session'

export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,24}$/
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const PASSWORD_MIN_LENGTH = 6

const SESSION_TTL_S = 3600
const INVALID_CREDENTIALS = 'Invalid username or password.'

interface StoredUser {
  user: SupabaseUser
  profile: SupabaseProfileRow
  salt: string
  password_hash: string
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to clear.
  }
}

function readUsers(): StoredUser[] {
  const raw = readStorage(USERS_KEY)
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredUser[]) : []
  } catch {
    return []
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest))
}

function failure(message: string): AuthResponse {
  return { data: { user: null, session: null }, error: { message } }
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function createSession(user: SupabaseUser): SupabaseSession {
  return {
    access_token: randomHex(24),
    refresh_token: randomHex(12),
    token_type: 'bearer',
    expires_in: SESSION_TTL_S,
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
    user,
  }
}

/** Stores the session. Returns null when storage refused the write, so a sign-in is never reported as persisted when it was not. */
function persistSession(user: SupabaseUser): SupabaseSession | null {
  const session = createSession(user)
  return writeStorage(SESSION_KEY, JSON.stringify(session)) ? session : null
}

export async function getSession(): Promise<GetSessionResponse> {
  const raw = readStorage(SESSION_KEY)
  if (raw === null) return { data: { session: null }, error: null }
  try {
    const session = JSON.parse(raw) as SupabaseSession
    const valid = typeof session?.user?.id === 'string' && typeof session.expires_at === 'number'
    if (!valid || session.expires_at * 1000 <= Date.now()) {
      removeStorage(SESSION_KEY)
      return { data: { session: null }, error: null }
    }
    return { data: { session }, error: null }
  } catch {
    removeStorage(SESSION_KEY)
    return { data: { session: null }, error: null }
  }
}

export async function getProfile(userId: string): Promise<GetProfileResponse> {
  const entry = readUsers().find((candidate) => candidate.user.id === userId)
  return { data: { profile: entry?.profile ?? null }, error: null }
}

export async function signUp(input: SignUpInput): Promise<AuthResponse> {
  const username = input.username.trim()
  const firstName = input.first_name.trim()
  const lastName = input.last_name.trim()
  const email = input.email.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(username)) {
    return failure('Username must be 3-24 letters, numbers, or _ - .')
  }
  if (firstName.length === 0 || lastName.length === 0) return failure('First and last name are required.')
  if (!EMAIL_PATTERN.test(email)) return failure('Enter a valid email address.')
  if (input.password.length < PASSWORD_MIN_LENGTH) {
    return failure(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  }
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.randomUUID !== 'function') {
    return failure('Secure browser context required.')
  }

  const users = readUsers()
  if (users.some((entry) => sameName(entry.profile.username, username))) return failure('That username is taken.')
  if (users.some((entry) => sameName(entry.profile.email, email))) return failure('That email is already registered.')

  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const user: SupabaseUser = {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    created_at: now,
    user_metadata: {
      username,
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      avatar_url: null,
    },
  }
  const profile: SupabaseProfileRow = {
    id,
    username,
    first_name: firstName,
    last_name: lastName,
    email,
    avatar_url: null,
    updated_at: now,
  }
  const salt = randomHex(16)
  const entry: StoredUser = { user, profile, salt, password_hash: await hashPassword(input.password, salt) }
  if (!writeStorage(USERS_KEY, JSON.stringify([...users, entry]))) {
    return failure('Could not save your account. Browser storage is unavailable.')
  }
  const session = persistSession(user)
  if (!session) return failure('Account created, but the session could not be saved. Try signing in.')
  return { data: { user, session }, error: null }
}

export async function signInWithUsername(input: SignInWithUsernameInput): Promise<AuthResponse> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return failure('Secure browser context required.')
  const entry = readUsers().find((candidate) => sameName(candidate.profile.username, input.username))
  if (!entry) return failure(INVALID_CREDENTIALS)
  const hash = await hashPassword(input.password, entry.salt)
  if (hash !== entry.password_hash) return failure(INVALID_CREDENTIALS)
  const session = persistSession(entry.user)
  if (!session) return failure('Could not save your session. Browser storage is unavailable.')
  return { data: { user: entry.user, session }, error: null }
}

export async function signOut(): Promise<{ error: null }> {
  removeStorage(SESSION_KEY)
  return { error: null }
}

export const authClient = { getSession, getProfile, signUp, signInWithUsername, signOut }
