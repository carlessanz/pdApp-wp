import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, supabaseUrl } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Modo = 'login' | 'recuperar' | 'recovery'

export default function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useT()
  const [session, setSession] = useState<Session | null>(null)
  const [cargando, setCargando] = useState(true)
  const [modo, setModo] = useState<Modo>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCargando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((evento, nueva) => {
      if (evento === 'PASSWORD_RECOVERY') setModo('recovery')
      setSession(nueva)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function entrar(e: FormEvent) {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setOcupado(false)
    if (authError) {
      setError(authError.message === 'Invalid login credentials' ? t('login.bad_creds') : authError.message)
      setPassword('')
    }
  }

  async function solicitarRecuperacion(e: FormEvent) {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true)
    setError(null)
    await fetch(`${supabaseUrl}/functions/v1/recuperar-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => null)
    setOcupado(false)
    toast.success(t('login.recover_sent'))
    setModo('login')
  }

  async function cambiarPassword(e: FormEvent) {
    e.preventDefault()
    if (ocupado) return
    if (password.length < 6) {
      setError(t('login.pw_short'))
      return
    }
    setOcupado(true)
    setError(null)
    const { error: updError } = await supabase.auth.updateUser({ password })
    setOcupado(false)
    if (updError) {
      setError(updError.message)
      return
    }
    toast.success(t('login.pw_updated'))
    setModo('login')
    setPassword('')
  }

  const ojo = (
    <button
      type="button"
      onClick={() => setVerPassword((v) => !v)}
      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      tabIndex={-1}
      aria-label={verPassword ? t('login.hide') : t('login.show')}
    >
      {verPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  )

  if (cargando) {
    return (
      <div className="grid min-h-screen place-items-center bg-primary">
        <p className="text-secondary/80">{t('login.checking')}</p>
      </div>
    )
  }

  if (session && modo !== 'recovery') {
    return <>{children}</>
  }

  return (
    <div className="grid min-h-screen place-items-center bg-primary px-4 py-10">
      <div className="w-full max-w-sm">
        <img src="/logo-poma.svg" alt="POMA" className="mx-auto mb-8 h-11 w-auto" />
        <Card className="rounded-2xl">
          {modo === 'recovery' ? (
            <>
              <CardHeader><CardTitle>{t('login.new_password')}</CardTitle></CardHeader>
              <CardContent>
                <form className="grid gap-4" onSubmit={cambiarPassword}>
                  <div className="grid gap-2">
                    <Label htmlFor="np">{t('login.new_password')}</Label>
                    <div className="relative">
                      <Input id="np" type={verPassword ? 'text' : 'password'} value={password}
                        onChange={(e) => { setPassword(e.target.value); setError(null) }}
                        autoComplete="new-password" autoFocus required className="pr-9" />
                      {ojo}
                    </div>
                  </div>
                  <Button type="submit" disabled={ocupado || !password}>
                    {ocupado ? t('c.saving') : t('login.save_password')}
                  </Button>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </form>
              </CardContent>
            </>
          ) : modo === 'recuperar' ? (
            <>
              <CardHeader><CardTitle>{t('login.recover_title')}</CardTitle></CardHeader>
              <CardContent>
                <form className="grid gap-4" onSubmit={solicitarRecuperacion}>
                  <div className="grid gap-2">
                    <Label htmlFor="re">{t('login.email')}</Label>
                    <Input id="re" type="email" value={email}
                      onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
                  </div>
                  <Button type="submit" disabled={ocupado || !email.trim()}>
                    {ocupado ? t('c.sending') : t('login.send_link')}
                  </Button>
                  <button type="button" className="text-sm text-muted-foreground underline"
                    onClick={() => { setModo('login'); setError(null) }}>
                    {t('login.back_login')}
                  </button>
                </form>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>{t('login.title')}</CardTitle>
                <p className="text-sm text-muted-foreground">{t('login.subtitle')}</p>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4" onSubmit={entrar}>
                  <div className="grid gap-2">
                    <Label htmlFor="em">{t('login.email')}</Label>
                    <Input id="em" type="email" value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(null) }}
                      autoComplete="username" autoFocus required />
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="pw">{t('login.password')}</Label>
                      <button type="button" className="text-xs text-muted-foreground underline"
                        onClick={() => { setModo('recuperar'); setError(null) }}>
                        {t('login.forgot')}
                      </button>
                    </div>
                    <div className="relative">
                      <Input id="pw" type={verPassword ? 'text' : 'password'} value={password}
                        onChange={(e) => { setPassword(e.target.value); setError(null) }}
                        autoComplete="current-password" required className="pr-9" />
                      {ojo}
                    </div>
                  </div>
                  <Button type="submit" disabled={ocupado || !email.trim() || !password}>
                    {ocupado ? t('login.entering') : t('login.enter')}
                  </Button>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </form>
              </CardContent>
            </>
          )}
        </Card>
        <p className="mt-4 text-center text-xs text-secondary/70">{t('login.foot')}</p>
      </div>
    </div>
  )
}
