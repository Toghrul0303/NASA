import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { EMAIL_PATTERN, PASSWORD_MIN_LENGTH } from '../data/authClient'
import { useWorkspaceStore } from '../state/store'
import { AsteriskIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon, UserIcon } from '../ui/icons'
import { Navbar } from '../ui/Navbar'

export type AuthMode = 'login' | 'signup'

const INPUT_CLASS =
  'w-full h-11 rounded-xl bg-[#101116] border border-white/10 hover:border-white/20 focus:border-[rgb(240,255,80)] focus:ring-2 focus:ring-[rgb(240,255,80)]/20 focus:outline-none pl-10 pr-10 text-sm text-white placeholder:text-white/35 transition-all'
const CTA_CLASS =
  'w-full h-11 rounded-full bg-[rgb(240,255,80)] text-black font-semibold text-sm flex items-center justify-center gap-2 hover:brightness-105 transition-all shadow-[0_0_24px_rgba(240,255,80,0.22)] disabled:opacity-60 disabled:cursor-wait'
const SWITCH_LINK_CLASS = 'text-[rgb(240,255,80)] hover:underline font-medium'
const USERNAME_RE = /^[a-z0-9_.-]+$/

function navigate(event: { preventDefault: () => void }, path: string) {
  event.preventDefault()
  if (window.location.pathname === path) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

interface Values {
  username: string
  first_name: string
  last_name: string
  email: string
  password: string
  verify_password: string
  terms: boolean
}

type Errors = Partial<Record<keyof Values, string>>

const EMPTY: Values = {
  username: '',
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  verify_password: '',
  terms: false,
}

function validate(mode: AuthMode, values: Values): Errors {
  const errors: Errors = {}
  const username = values.username.trim()
  if (username.length === 0) errors.username = 'Username is required'
  else if (mode === 'signup') {
    if (username.length < 3) errors.username = 'Username must be at least 3 characters'
    else if (!USERNAME_RE.test(username)) errors.username = 'Use lowercase letters, numbers, and _ - . only'
  }
  if (values.password.length === 0) errors.password = 'Password is required'
  else if (mode === 'signup' && values.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  }
  if (mode === 'signup') {
    if (values.first_name.trim().length === 0) errors.first_name = 'First name is required'
    if (values.last_name.trim().length === 0) errors.last_name = 'Last name is required'
    const email = values.email.trim()
    if (email.length === 0) errors.email = 'Email is required'
    else if (!EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address'
    if (values.verify_password.length === 0) errors.verify_password = 'Please verify your password'
    else if (values.verify_password !== values.password) errors.verify_password = 'Passwords do not match'
    if (!values.terms) errors.terms = 'You must agree to continue'
  }
  return errors
}

function Field({
  label,
  name,
  icon,
  error,
  children,
}: {
  label: string
  name: string
  icon: ReactNode
  error: string | undefined
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={`auth-${name}`} className="block text-xs font-medium text-white/70 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/45 flex items-center">
          {icon}
        </span>
        {children}
      </div>
      {error ? (
        <p id={`auth-${name}-error`} className="text-xs text-rose-400 mt-1.5">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function PasswordInput({
  name,
  value,
  onChange,
  placeholder,
  autoComplete,
  invalid,
}: {
  name: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoComplete: string
  invalid: boolean
}) {
  const [visible, setVisible] = useState(false)
  return (
    <>
      <input
        id={`auth-${name}`}
        name={name}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        aria-invalid={invalid}
        aria-describedby={invalid ? `auth-${name}-error` : undefined}
        className={INPUT_CLASS}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 hover:text-white transition-colors flex items-center"
      >
        {visible ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
      </button>
    </>
  )
}

function AuthForm({ mode }: { mode: AuthMode }) {
  const signUpUser = useWorkspaceStore((state) => state.signUpUser)
  const loginUser = useWorkspaceStore((state) => state.loginUser)
  const [values, setValues] = useState<Values>(EMPTY)
  const [submitted, setSubmitted] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const signup = mode === 'signup'

  const errors = validate(mode, values)
  const shown = (key: keyof Values) => (submitted || touched[key] ? errors[key] : undefined)

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }))
    setFormError(null)
  }
  const blur = (key: keyof Values) => () => setTouched((current) => ({ ...current, [key]: true }))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length > 0 || busy) return
    setBusy(true)
    setFormError(null)
    const username = values.username.trim()
    const error = signup
      ? await signUpUser({
          username,
          first_name: values.first_name.trim(),
          last_name: values.last_name.trim(),
          email: values.email.trim(),
          password: values.password,
        })
      : await loginUser({ username, password: values.password })
    // On success the store flips to authenticated and the page redirects.
    if (error) {
      setFormError(error.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300"
        >
          {formError}
        </div>
      ) : null}

      <Field label="Username" name="username" icon={<UserIcon className="w-4 h-4" />} error={shown('username')}>
        <input
          id="auth-username"
          name="username"
          type="text"
          value={values.username}
          onChange={(event) => set('username', signup ? event.target.value.toLowerCase() : event.target.value)}
          onBlur={blur('username')}
          placeholder={signup ? 'your_username' : 'Username'}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={Boolean(shown('username'))}
          aria-describedby={shown('username') ? 'auth-username-error' : undefined}
          className={INPUT_CLASS}
        />
      </Field>

      {signup ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="First name"
              name="first_name"
              icon={<UserIcon className="w-4 h-4" />}
              error={shown('first_name')}
            >
              <input
                id="auth-first_name"
                name="first_name"
                type="text"
                value={values.first_name}
                onChange={(event) => set('first_name', event.target.value)}
                onBlur={blur('first_name')}
                placeholder="First name"
                autoComplete="given-name"
                required
                aria-invalid={Boolean(shown('first_name'))}
                aria-describedby={shown('first_name') ? 'auth-first_name-error' : undefined}
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Last name"
              name="last_name"
              icon={<UserIcon className="w-4 h-4" />}
              error={shown('last_name')}
            >
              <input
                id="auth-last_name"
                name="last_name"
                type="text"
                value={values.last_name}
                onChange={(event) => set('last_name', event.target.value)}
                onBlur={blur('last_name')}
                placeholder="Last name"
                autoComplete="family-name"
                required
                aria-invalid={Boolean(shown('last_name'))}
                aria-describedby={shown('last_name') ? 'auth-last_name-error' : undefined}
                className={INPUT_CLASS}
              />
            </Field>
          </div>

          <Field label="Email" name="email" icon={<MailIcon className="w-4 h-4" />} error={shown('email')}>
            <input
              id="auth-email"
              name="email"
              type="email"
              value={values.email}
              onChange={(event) => set('email', event.target.value)}
              onBlur={blur('email')}
              placeholder="you@example.com"
              autoComplete="email"
              required
              aria-invalid={Boolean(shown('email'))}
              aria-describedby={shown('email') ? 'auth-email-error' : undefined}
              className={INPUT_CLASS}
            />
          </Field>
        </>
      ) : null}

      <Field label="Password" name="password" icon={<LockIcon className="w-4 h-4" />} error={shown('password')}>
        <PasswordInput
          name="password"
          value={values.password}
          onChange={(value) => set('password', value)}
          placeholder={signup ? `At least ${PASSWORD_MIN_LENGTH} characters` : 'Password'}
          autoComplete={signup ? 'new-password' : 'current-password'}
          invalid={Boolean(shown('password'))}
        />
      </Field>

      {signup ? (
        <>
          <Field
            label="Verify password"
            name="verify_password"
            icon={<LockIcon className="w-4 h-4" />}
            error={shown('verify_password')}
          >
            <PasswordInput
              name="verify_password"
              value={values.verify_password}
              onChange={(value) => set('verify_password', value)}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              invalid={Boolean(shown('verify_password'))}
            />
          </Field>

          <div>
            <label className="flex items-start gap-2.5 text-xs text-white/60 cursor-pointer">
              <input
                type="checkbox"
                name="terms"
                checked={values.terms}
                onChange={(event) => set('terms', event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[rgb(240,255,80)]"
              />
              <span>I agree to the Terms of Service and Privacy Policy</span>
            </label>
            {shown('terms') ? <p className="text-xs text-rose-400 mt-1.5">{errors.terms}</p> : null}
          </div>
        </>
      ) : null}

      <button type="submit" disabled={busy} className={CTA_CLASS}>
        {busy ? (signup ? 'Creating account…' : 'Signing in…') : signup ? 'Create account →' : 'Sign in →'}
      </button>
    </form>
  )
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  const authStatus = useWorkspaceStore((state) => state.authStatus)
  const signup = mode === 'signup'

  useEffect(() => {
    if (authStatus !== 'authenticated') return
    window.history.replaceState(null, '', '/workspace')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [authStatus])

  useEffect(() => {
    const previous = document.title
    document.title = signup ? 'Create your account · ExoTrace' : 'Sign in · ExoTrace'
    return () => {
      document.title = previous
    }
  }, [signup])

  return (
    <div className="min-h-screen bg-[#000000] text-white p-3 sm:p-5 pt-[76px] sm:pt-[76px] flex items-stretch">
      <Navbar surface="home" />
      <div className="w-full rounded-[28px] border border-white/10 bg-[#050507] overflow-hidden grid grid-cols-1 lg:grid-cols-[1.08fr_1fr] relative">
        <section
          aria-label="About ExoTrace"
          className="relative m-3 sm:m-4 rounded-[22px] overflow-hidden border border-white/10 min-h-[300px] lg:min-h-full flex flex-col justify-between p-6 sm:p-8"
        >
          <video
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster="/videos/hero-poster.jpg"
            aria-hidden="true"
          >
            <source src="/videos/hero.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/55" aria-hidden="true" />

          <div className="relative z-10 flex items-center justify-between gap-3">
            <a href="/" onClick={(event) => navigate(event, '/')} className="inline-flex items-center gap-2" aria-label="ExoTrace home">
              <AsteriskIcon className="w-4 h-4 text-white shrink-0" />
              <span className="text-sm font-semibold tracking-tight text-white">ExoTrace</span>
            </a>
            <span className="rounded-full bg-black/45 backdrop-blur-md border border-white/15 px-3.5 py-1.5 text-xs text-white/85 flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full bg-[rgb(240,255,80)] shadow-[0_0_8px_rgb(240,255,80)]"
                aria-hidden="true"
              />
              NASA SPHEREx Time-Domain Lab
            </span>
          </div>

          <div className="relative z-10 mt-24 rounded-2xl bg-[#090A0E]/75 backdrop-blur-xl border border-white/[0.12] p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center gap-1.5 mb-4" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => (
                <AsteriskIcon key={index} className="w-3.5 h-3.5 text-[rgb(240,255,80)]" />
              ))}
            </div>
            <p className="text-lg sm:text-xl leading-snug text-white">
              Explore any sky coordinate in infrared across time—blinking SPHEREx epochs, comparing spectra, and
              cross-checking motion with Gaia DR3 right in your browser.
            </p>
            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 shrink-0 rounded-full bg-white/[0.06] border border-white/15 flex items-center justify-center">
                  <AsteriskIcon className="w-4 h-4 text-white" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">ExoTrace</p>
                  <p className="text-xs text-white/55 truncate">SPHEREx Sky Explorer</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
                <span className="w-5 h-1.5 rounded-full bg-[rgb(240,255,80)]" />
                <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
                <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col justify-between px-6 sm:px-12 lg:px-16 py-7 sm:py-9 relative z-10">
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{ background: 'radial-gradient(circle at 82% 12%, rgba(240, 255, 80, 0.08), transparent 48%)' }}
            aria-hidden="true"
          />

          <p className="text-xs sm:text-sm text-white/60 text-right">
            {signup ? (
              <>
                Already have an account?{' '}
                <a href="/login" onClick={(event) => navigate(event, '/login')} className={SWITCH_LINK_CLASS}>
                  Sign in
                </a>
              </>
            ) : (
              <>
                Don&apos;t have an account?{' '}
                <a href="/signup" onClick={(event) => navigate(event, '/signup')} className={SWITCH_LINK_CLASS}>
                  Create account
                </a>
              </>
            )}
          </p>

          <div className="w-full max-w-[430px] mx-auto my-auto py-6">
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              {signup ? 'Create your account' : 'Sign in to ExoTrace'}
            </h1>
            <p className="text-sm text-white/55 mt-1.5 mb-6">
              {signup
                ? 'Set up your ExoTrace profile to save targets and analysis sessions.'
                : 'Enter your username and password to continue.'}
            </p>
            <AuthForm key={mode} mode={mode} />
          </div>

          <div className="flex items-center justify-between text-xs text-white/40 pt-4">
            <span>© 2026 ExoTrace</span>
            <span className="flex items-center gap-2">
              <a href="/" onClick={(event) => navigate(event, '/')} className="hover:text-white transition-colors">
                Home
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="/workspace"
                onClick={(event) => navigate(event, '/workspace')}
                className="hover:text-white transition-colors"
              >
                Workspace
              </a>
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}
