import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

// Hash SHA-256 de la contraseña de acceso (la contraseña en claro no está en el bundle).
// OJO: protección cosmética para una herramienta interna de pruebas — la publishable key
// y las políticas RLS de anon siguen expuestas en el cliente.
// TODO: sustituir por autenticación real (Supabase Auth) antes de producción.
const PASSWORD_HASH = '011efea0cac926232add733f86e3d9f6ab53c237be9e40f9e6a2e255ba33abc3'
const STORAGE_KEY = 'pdapp_gate'

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(STORAGE_KEY) === PASSWORD_HASH,
  )
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password || checking) return
    setChecking(true)
    const hash = await sha256Hex(password)
    setChecking(false)
    if (hash === PASSWORD_HASH) {
      sessionStorage.setItem(STORAGE_KEY, hash)
      setUnlocked(true)
    } else {
      setError(true)
      setPassword('')
    }
  }

  if (unlocked) return <>{children}</>

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={handleSubmit}>
        <h1>PDApp</h1>
        <p className="hint">Consola de mensajería WhatsApp · acceso restringido</p>
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(false)
          }}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={checking || !password}>
          {checking ? 'Comprobando…' : 'Entrar'}
        </button>
        {error && <p className="notice notice-error">Contraseña incorrecta</p>}
      </form>
    </div>
  )
}
