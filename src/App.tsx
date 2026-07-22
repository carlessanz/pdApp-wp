import { useCallback, useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { supabase } from './lib/supabase'
import { cn } from './lib/utils'
import { useT } from './lib/i18n'
import type { Lang } from './lib/i18n'
import type { Entidad, Excedente, Productor, WaContact } from './types'
import AuthGate from './components/AuthGate'
import Dashboard from './components/Dashboard'
import ProducersList from './components/ProducersList'
import EntitiesList from './components/EntitiesList'
import RecordDetail from './components/RecordDetail'
import { PRODUCTOR_CAMPOS, ENTIDAD_CAMPOS } from './lib/crudCampos'
import ContactList from './components/ContactList'
import Conversation from './components/Conversation'
import OffersList from './components/OffersList'
import OfferDetail from './components/OfferDetail'

type View = 'dashboard' | 'ofertas' | 'productores' | 'entidades' | 'mensajeria'
type Registro = Record<string, unknown> & { id: string }

const NAV: { id: View; labelKey: string }[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard' },
  { id: 'ofertas', labelKey: 'nav.offers' },
  { id: 'productores', labelKey: 'nav.producers' },
  { id: 'entidades', labelKey: 'nav.entities' },
  { id: 'mensajeria', labelKey: 'nav.messaging' },
]

export default function App() {
  const { t, lang, setLang } = useT()
  const [view, setView] = useState<View>('dashboard')
  const [selectedOffer, setSelectedOffer] = useState<Excedente | null>(null)
  const [contacts, setContacts] = useState<WaContact[]>([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [contactsError, setContactsError] = useState<string | null>(null)
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)

  const [productorDetalle, setProductorDetalle] = useState<Productor | null>(null)
  const [productorNuevo, setProductorNuevo] = useState(false)
  const [entidadDetalle, setEntidadDetalle] = useState<Entidad | null>(null)
  const [entidadNueva, setEntidadNueva] = useState(false)

  const loadContacts = useCallback(async () => {
    setLoadingContacts(true)
    setContactsError(null)
    const { data, error } = await supabase
      .from('wa_contacts')
      .select('*')
      .order('name', { ascending: true, nullsFirst: false })
      .order('phone', { ascending: true })
    if (error) {
      setContactsError(`No se pudieron cargar los contactos: ${error.message}`)
      setContacts([])
    } else {
      setContacts(data ?? [])
    }
    setLoadingContacts(false)
  }, [])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  const openMessagingWithContact = useCallback(
    async (phone: string, name: string | null) => {
      if (!phone) return
      const { error } = await supabase.from('wa_contacts').upsert(
        { phone, name, opt_in: true, opt_in_at: new Date().toISOString() },
        { onConflict: 'phone', ignoreDuplicates: true },
      )
      if (error) console.error('wa_contacts upsert:', error.message)
      if (name) {
        const { error: nameError } = await supabase
          .from('wa_contacts').update({ name }).eq('phone', phone)
        if (nameError) console.error('wa_contacts nombre:', nameError.message)
      }
      await loadContacts()
      setSelectedPhone(phone)
      setView('mensajeria')
    },
    [loadContacts],
  )

  const selected = contacts.find((c) => c.phone === selectedPhone) ?? null
  const cerrarProductor = () => { setProductorDetalle(null); setProductorNuevo(false) }
  const cerrarEntidad = () => { setEntidadDetalle(null); setEntidadNueva(false) }

  // Los listados (ofertas, productores, entidades) ocupan el 90% del ancho de la
  // pantalla; sus detalles, el dashboard y la mensajería quedan centrados y legibles.
  const listaAncha =
    (view === 'ofertas' && !selectedOffer) ||
    (view === 'productores' && !productorNuevo && !productorDetalle) ||
    (view === 'entidades' && !entidadNueva && !entidadDetalle)

  function irA(v: View) {
    setView(v)
    if (v === 'ofertas') setSelectedOffer(null)
    if (v === 'productores') cerrarProductor()
    if (v === 'entidades') cerrarEntidad()
  }

  const topbar = (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-primary">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
        <img src="/logo-poma.svg" alt="POMA" className="h-7 w-auto" />
        <nav className="flex flex-1 flex-wrap gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => irA(n.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                view === n.id
                  ? 'bg-secondary text-primary'
                  : 'text-secondary/80 hover:bg-white/10 hover:text-secondary',
              )}
            >
              {t(n.labelKey)}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-0.5 rounded-md border border-white/15 p-0.5">
          {(['ca', 'es'] as Lang[]).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)}
              className={cn('rounded px-1.5 py-0.5 text-xs font-semibold uppercase transition-colors',
                lang === l ? 'bg-secondary text-primary' : 'text-secondary/70 hover:text-secondary')}>
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-secondary/80 hover:bg-white/10 hover:text-secondary"
        >
          <LogOut className="size-4" /> {t('nav.logout')}
        </button>
      </div>
    </header>
  )

  return (
    <AuthGate>
      {view === 'mensajeria' ? (
        <div className="flex h-screen flex-col">
          {topbar}
          <div className="flex min-h-0 flex-1">
            <ContactList
              contacts={contacts}
              loading={loadingContacts}
              error={contactsError}
              selectedPhone={selectedPhone}
              onSelect={setSelectedPhone}
              onReload={loadContacts}
            />
            {selected ? (
              <Conversation key={selected.phone} contact={selected} />
            ) : (
              <main className="grid flex-1 place-items-center text-muted-foreground">
                <p>{t('msg.select')}</p>
              </main>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-screen">
          {topbar}
          <div className={cn('mx-auto py-6', listaAncha ? 'w-[90%]' : 'max-w-6xl px-4')}>
            {view === 'dashboard' && <Dashboard />}
            {view === 'ofertas' &&
              (selectedOffer ? (
                <OfferDetail excedente={selectedOffer} onBack={() => setSelectedOffer(null)} />
              ) : (
                <OffersList onOpen={setSelectedOffer} />
              ))}
            {view === 'productores' &&
              (productorNuevo || productorDetalle ? (
                <RecordDetail
                  tipoKey="rec.producer"
                  femenino={false}
                  volverKey="nav.producers"
                  tabla="productores"
                  campos={PRODUCTOR_CAMPOS}
                  registro={(productorDetalle as unknown as Registro) ?? null}
                  nombreKey="name"
                  telefonoKey="phone"
                  onBack={cerrarProductor}
                  onSaved={cerrarProductor}
                  onSendMessage={openMessagingWithContact}
                />
              ) : (
                <ProducersList
                  onSendMessage={openMessagingWithContact}
                  onOpenDetail={(p) => { setProductorNuevo(false); setProductorDetalle(p) }}
                  onNew={() => { setProductorDetalle(null); setProductorNuevo(true) }}
                />
              ))}
            {view === 'entidades' &&
              (entidadNueva || entidadDetalle ? (
                <RecordDetail
                  tipoKey="rec.entity"
                  femenino={true}
                  volverKey="nav.entities"
                  tabla="entidades"
                  campos={ENTIDAD_CAMPOS}
                  registro={(entidadDetalle as unknown as Registro) ?? null}
                  nombreKey="nombre"
                  telefonoKey="telefono"
                  onBack={cerrarEntidad}
                  onSaved={cerrarEntidad}
                  onSendMessage={openMessagingWithContact}
                />
              ) : (
                <EntitiesList
                  onSendMessage={openMessagingWithContact}
                  onOpenDetail={(e) => { setEntidadNueva(false); setEntidadDetalle(e) }}
                  onNew={() => { setEntidadDetalle(null); setEntidadNueva(true) }}
                />
              ))}
          </div>
        </div>
      )}
    </AuthGate>
  )
}
