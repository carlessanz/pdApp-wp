import { useState } from 'react'
import { ArrowLeft, MessageCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
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
  titulo: string
  volverLabel: string
  tabla: 'productores' | 'entidades'
  campos: CampoDef[]
  registro: Registro | null
  nombreKey: string
  telefonoKey?: string
  onBack: () => void
  onSaved: () => void
  onSendMessage?: (phone: string, name: string | null) => void
}

function mensajeError(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'Ya existe una ficha con ese teléfono, email o nombre (deben ser únicos).'
  return error.message
}

export default function RecordDetail({
  titulo, volverLabel, tabla, campos, registro, nombreKey, telefonoKey, onBack, onSaved, onSendMessage,
}: Props) {
  const esNuevo = registro == null
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...(registro ?? {}) }))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }))

  function normalizar(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const c of campos) {
      const tipo = c.tipo ?? 'text'
      let v = form[c.key]
      if (tipo === 'list') {
        if (typeof v === 'string') {
          const arr = v.split(',').map((s) => s.trim()).filter(Boolean)
          v = arr.length ? arr : null
        } else if (Array.isArray(v)) v = v.length ? v : null
        else v = null
      } else if (tipo === 'number') {
        v = v == null || v === '' ? null : Number(v)
      } else if (tipo === 'bool') {
        v = Boolean(v)
      } else if (tipo === 'boolnull') {
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
    if (!datos[nombreKey]) { setError('El nombre es obligatorio.'); return }
    setGuardando(true)
    const resp = registro
      ? await supabase.from(tabla).update(datos).eq('id', registro.id)
      : await supabase.from(tabla).insert(datos)
    setGuardando(false)
    if (resp.error) { setError(mensajeError(resp.error)); return }
    toast.success(esNuevo ? 'Ficha creada.' : 'Cambios guardados.')
    onSaved()
  }

  async function borrar() {
    if (!registro) return
    const nombre = String(form[nombreKey] ?? 'esta ficha')
    if (!window.confirm(`¿Seguro que quieres borrar «${nombre}»? Es irreversible.`)) return
    setError(null)
    setGuardando(true)
    const { error: delError } = await supabase.from(tabla).delete().eq('id', registro.id)
    setGuardando(false)
    if (delError) { setError(mensajeError(delError)); return }
    toast.success('Ficha borrada.')
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
    const tipo = c.tipo ?? 'text'
    const v = form[c.key]
    if (tipo === 'textarea') {
      return <Textarea rows={3} value={(v as string) ?? ''} onChange={(e) => set(c.key, e.target.value)} />
    }
    if (tipo === 'number') {
      return <Input type="number" value={v == null || v === '' ? '' : String(v)}
        onChange={(e) => set(c.key, e.target.value === '' ? null : Number(e.target.value))} />
    }
    if (tipo === 'bool') {
      return (
        <Select value={v ? 'si' : 'no'} onValueChange={(val) => set(c.key, val === 'si')}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="si">Sí</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      )
    }
    if (tipo === 'boolnull') {
      return (
        <Select value={v == null ? 'null' : v ? 'si' : 'no'}
          onValueChange={(val) => set(c.key, val === 'null' ? null : val === 'si')}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="null">—</SelectItem>
            <SelectItem value="si">Sí</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      )
    }
    if (tipo === 'list') {
      const texto = Array.isArray(v) ? (v as string[]).join(', ') : ((v as string) ?? '')
      return <Input type="text" value={texto} onChange={(e) => set(c.key, e.target.value)} />
    }
    return <Input type={tipo === 'email' ? 'email' : 'text'} value={(v as string) ?? ''}
      onChange={(e) => set(c.key, e.target.value)} />
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
        <ArrowLeft className="size-4" /> {volverLabel}
      </Button>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{esNuevo ? `Nuevo ${titulo.toLowerCase()}` : String(form[nombreKey] ?? titulo)}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {esNuevo ? 'Alta de una ficha nueva' : `Editando ${titulo.toLowerCase()}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {telefonoKey && telValor && onSendMessage && (
              <Button variant="outline" onClick={enviarMensaje}>
                <MessageCircle className="size-4" /> Mensaje
              </Button>
            )}
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {campos.map((c) => (
              <div key={c.key} className={c.ancho === 'full' ? 'sm:col-span-2' : undefined}>
                <Label className="mb-1.5 block text-xs text-muted-foreground">{c.label}</Label>
                {control(c)}
              </div>
            ))}
          </div>
          {!esNuevo && (
            <div className="border-t pt-4">
              <Button variant="destructive" onClick={() => void borrar()} disabled={guardando}>
                <Trash2 className="size-4" /> Borrar {titulo.toLowerCase()}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
