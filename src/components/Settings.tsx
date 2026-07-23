import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import type { Lang } from '../lib/i18n'
import { getTestMode, setTestMode } from '../lib/settings'
import { cn } from '../lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Settings() {
  const { t, lang, setLang } = useT()
  const [testMode, setTest] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { void getTestMode().then(setTest) }, [])

  async function cambiarTestMode(activo: boolean) {
    if (activo === testMode || saving) return
    // Apagarlo es sensible: pasa a enviarse a TODOS. Confirmación explícita.
    if (!activo && !window.confirm(t('set.confirm_off'))) return
    setSaving(true)
    const error = await setTestMode(activo)
    setSaving(false)
    if (error) { toast.error(error); return }
    setTest(activo)
    toast.success(activo ? t('set.saved_on') : t('set.saved_off'))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t('set.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('set.subtitle')}</p>
      </div>

      {/* Modo test: la garantía de no enviar a usuarios que no sean de prueba. */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('set.test_mode')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {testMode === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t('c.loading')}
            </p>
          ) : (
            <>
              <div className={cn('flex items-start gap-3 rounded-lg border p-3',
                testMode ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50')}>
                {testMode
                  ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-green-600" />
                  : <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-600" />}
                <div className="text-sm">
                  <div className={cn('font-semibold', testMode ? 'text-green-800' : 'text-red-800')}>
                    {testMode ? t('set.test_on') : t('set.test_off')}
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {testMode ? t('set.test_on_desc') : t('set.test_off_desc')}
                  </p>
                </div>
              </div>

              <div className="inline-flex rounded-md border p-0.5">
                <button type="button" disabled={saving} onClick={() => void cambiarTestMode(true)}
                  className={cn('rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60',
                    testMode ? 'bg-green-600 text-white' : 'text-muted-foreground hover:bg-muted')}>
                  {t('set.on')}
                </button>
                <button type="button" disabled={saving} onClick={() => void cambiarTestMode(false)}
                  className={cn('rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60',
                    !testMode ? 'bg-red-600 text-white' : 'text-muted-foreground hover:bg-muted')}>
                  {t('set.off')}
                </button>
              </div>

              <p className="text-xs text-muted-foreground">{t('set.test_help')}</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Idioma */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('set.language')}</CardTitle></CardHeader>
        <CardContent>
          <div className="inline-flex rounded-md border p-0.5">
            {(['ca', 'es'] as Lang[]).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)}
                className={cn('rounded px-4 py-1.5 text-sm font-semibold transition-colors',
                  lang === l ? 'bg-secondary text-primary' : 'text-muted-foreground hover:bg-muted')}>
                {l === 'ca' ? 'Català' : 'Castellano'}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cómo se decide a quién se envía (para que quede claro). */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('set.sending_title')}</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>{t('set.sending_1')}</p>
          <p>{t('set.sending_2')}</p>
          <p>{t('set.sending_3')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
