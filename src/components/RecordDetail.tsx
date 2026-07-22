import { useState } from 'react'
import { ArrowLeft, MessageCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import type { CampoDef } from '../lib/crudCampos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type Registro = Record<string, unknown> & { id: string }

interface Props {
  tipoKey: string // 'rec.producer' | 'rec.entity'
  femenino: boolean
  volverKey: string // 'nav.producers' | 'nav.entities'
  tabla: 'productores' | 'entidades'
  campos: CampoDef[]
  registro: Registro | null
  nombreKey: string
  telefonoKey?: string
  onBack: () => void
  onSaved: () => void
  onSendMessage?: (phone: string, name: string | null) => void
}

export default function RecordDetail({
  tipoKey, femenino, volverKey, tabla, campos, registro, nombreKey, telefonoKey, onBack, onSaved, onSendMessage,
}: Props) {
  const { t } = useT()
  const esNuevo = registro == null
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...(registro ?? {}) }))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tipo = t(tipoKey)
  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }))

  function mensajeError(err: { code?: string; message: string }): string {
    return err.code === '23505' ? t('rec.err_unique') : err.message
  }

  function normalizar(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const c of campos) {
      const tp = c.tipo ?? 'text'
      let v = form[c.key]
      if (tp === 'list') {
        if (typeof v === 'string') {
          const arr = v.split(',').map((s) => s.trim()).filter(Boolean)
          v = arr.length ? arr : null
        } else if (Array.isArray(v)) v = v.length ? v : null
        else v = null
      } else if (tp === 'number') {
        v = v == null || v === '' ? null : Number(v)
      } else if (tp === 'bool') {
        v = Boolean(v)
      } else if (tp === 'boolnull') {
        v = v == null ? null : Boolean(v)
      } else {
        const s = typeof v === 'string' ? v.trim() : v
        v = s === '' || s == null ? null : s
      }
      out[c.key] = v
    }
    return out
  }

  async function guardar() {
    setError(null)
    const datos = normalizar()
    if (!datos[nombreKey]) { setError(t('rec.name_required')); return }
    setGuardando(true)
    const resp = registro
      ? await supabase.from(tabla).update(datos).eq('id', registro.id)
      : await supabase.from(tabla).insert(datos)
    setGuardando(false)
    if (resp.error) { setError(mensajeError(resp.error)); return }
    toast.success(esNuevo ? t('rec.created') : t('rec.saved'))
    onSaved()
  }

  async function borrar() {
    if (!registro) return
    const nombre = String(form[nombreKey] ?? tipo)
    if (!window.confirm(t('rec.confirm_delete', { name: nombre }))) return
    setError(null)
    setGuardando(true)
    const { error: delError } = await supabase.from(tabla).delete().eq('id', registro.id)
    setGuardando(false)
    if (delError) { setError(mensajeError(delError)); return }
    toast.success(t('rec.deleted'))
    onSaved()
  }

  function enviarMensaje() {
    const tel = telefonoKey ? (form[telefonoKey] as string | null) : null
    const limpio = (tel ?? '').replace(/\D/g, '')
    if (!limpio) return
    onSendMessage?.(limpio, (form[nombreKey] as string) ?? null)
  }

  const telValor = telefonoKey ? String(form[telefonoKey] ?? '').replace(/\D/g, '') : ''

  function control(c: CampoDef) {
    const tp = c.tipo ?? 'text'
    const v = form[c.key]
    if (tp === 'textarea') return <Textarea rows={3} value={(v as string) ?? ''} onChange={(e) => set(c.key, e.target.value)} />
    if (tp === 'number') {
      return <Input type="number" value={v == null || v === '' ? '' : String(v)}
        onChange={(e) => set(c.key, e.target.value === '' ? null : Number(e.target.value))} />
    }
    if (tp === 'bool') {
      return (
        <Select value={v ? 'si' : 'no'} onValueChange={(val) => set(c.key, val === 'si')}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="si">{t('c.yes')}</SelectItem>
            <SelectItem value="no">{t('c.no')}</SelectItem>
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'boolnull') {
      return (
        <Select value={v == null ? 'null' : v ? 'si' : 'no'}
          onValueChange={(val) => set(c.key, val === 'null' ? null : val === 'si')}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="null">—</SelectItem>
            <SelectItem value="si">{t('c.yes')}</SelectItem>
            <SelectItem value="no">{t('c.no')}</SelectItem>
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'select') {
      const val = (v as string) ?? ''
      return (
        <Select value={val === '' ? '__none' : val} onValueChange={(nv) => set(c.key, nv === '__none' ? null : nv)}>
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {(c.opciones ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'list') {
      const texto = Array.isArray(v) ? (v as string[]).join(', ') : ((v as string) ?? '')
      return <Input type="text" value={texto} onChange={(e) => set(c.key, e.target.value)} />
    }
    return <Input type={tp === 'email' ? 'email' : 'text'} value={(v as string) ?? ''} onChange={(e) => set(c.key, e.target.value)} />
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
        <ArrowLeft className="size-4" /> {t(volverKey)}
      </Button>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>
              {esNuevo ? (femenino ? t('rec.new_f', { x: tipo }) : t('rec.new', { x: tipo })) : String(form[nombreKey] ?? tipo)}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {esNuevo ? t('rec.alta') : t('rec.editing', { x: tipo })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {telefonoKey && telValor && onSendMessage && (
              <Button variant="outline" onClick={enviarMensaje}>
                <MessageCircle className="size-4" /> {t('c.message')}
              </Button>
            )}
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? t('c.saving') : t('c.save')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {campos.map((c) => (
              <div key={c.key} className={c.ancho === 'full' ? 'sm:col-span-2' : undefined}>
                <Label className="mb-1.5 block text-xs text-muted-foreground">{t(c.label)}</Label>
                {control(c)}
              </div>
            ))}
          </div>
          {!esNuevo && (
            <div className="border-t pt-4">
              <Button variant="destructive" onClick={() => void borrar()} disabled={guardando}>
                <Trash2 className="size-4" /> {t('rec.delete_x', { x: tipo })}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
