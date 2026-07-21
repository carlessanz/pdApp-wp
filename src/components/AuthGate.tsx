import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

// Autenticación real con Supabase Auth (sustituye al PasswordGate cosmético).
//
// A propósito NO hay registro ni recuperación de contraseña: las cuentas se
// crean con la Admin API y esos dos flujos enviarían correos, que en fase de
// pruebas no queremos que salgan a nadie.

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [cargando, setCargando] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [entrando, setEntrando] = useState(false)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCargando(false)
    })
    // Mantiene la sesión al día: renovación del token, cierre en otra pestaña…
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, nueva) => {
      setSession(nueva)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (entrando) return
    setEntrando(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setEntrando(false)
    if (authError) {
      setError(
        authError.message === 'Invalid login credentials'
          ? 'Email o contraseña incorrectos'
          : authError.message,
      )
      setPassword('')
    }
  }

  if (cargando) {
    return (
      <div className="gate">
        <p className="hint">Comprobando sesión…</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="gate">
        <form className="gate-card" onSubmit={handleSubmit}>
          <h1>PDApp</h1>
          <p className="hint">Consola de mensajería WhatsApp · acceso restringido</p>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            autoComplete="username"
            autoFocus
            required
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            autoComplete="current-password"
            required
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={entrando || !email.trim() || !password}
          >
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
          {error && <p className="notice notice-error">{error}</p>}
          <p className="hint gate-nota">
            Si necesitas acceso, pídelo al equipo: las cuentas se crean manualmente.
          </p>
        </form>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        className="btn-link logout"
        onClick={() => void supabase.auth.signOut()}
        title={session.user.email ?? undefined}
      >
        Cerrar sesión
      </button>
      {children}
    </>
  )
}
