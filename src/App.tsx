import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import type { Excedente, Productor, WaContact } from './types'
import AuthGate from './components/AuthGate'
import ProducersList from './components/ProducersList'
import ContactList from './components/ContactList'
import Conversation from './components/Conversation'
import OffersList from './components/OffersList'
import OfferDetail from './components/OfferDetail'

type View = 'ofertas' | 'productores' | 'mensajeria'

export default function App() {
  const [view, setView] = useState<View>('ofertas')
  const [selectedOffer, setSelectedOffer] = useState<Excedente | null>(null)
  const [contacts, setContacts] = useState<WaContact[]>([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [contactsError, setContactsError] = useState<string | null>(null)
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)

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

  // Al abrir la mensajería desde un productor, se le asegura como contacto
  // de WhatsApp (con opt-in, como el flujo "Añadir contacto") sin tocar los existentes.
  const openMessagingWith = useCallback(
    async (productor: Productor) => {
      // Hay productores importados sin móvil utilizable; la lista ya deshabilita
      // el botón, esto es la red de seguridad.
      if (!productor.phone) return
      const { error } = await supabase.from('wa_contacts').upsert(
        {
          phone: productor.phone,
          name: productor.name,
          opt_in: true,
          opt_in_at: new Date().toISOString(),
        },
        { onConflict: 'phone', ignoreDuplicates: true },
      )
      if (error) console.error('wa_contacts upsert:', error.message)
      // Si el contacto ya existía (p. ej. creado por el webhook al recibir un mensaje),
      // sincronizar el nombre desde la tabla de productores sin tocar su consentimiento.
      const { error: nameError } = await supabase
        .from('wa_contacts')
        .update({ name: productor.name })
        .eq('phone', productor.phone)
      if (nameError) console.error('wa_contacts nombre:', nameError.message)
      await loadContacts()
      setSelectedPhone(productor.phone)
      setView('mensajeria')
    },
    [loadContacts],
  )

  const selected = contacts.find((c) => c.phone === selectedPhone) ?? null

  // La mensajería tiene su propia navegación interna (sidebar + volver a
  // productores), así que la barra superior solo se muestra fuera de ella.
  const nav = (
    <nav className="topnav">
      <button type="button" className={view === 'ofertas' ? 'active' : ''}
        onClick={() => { setView('ofertas'); setSelectedOffer(null) }}>Ofertas</button>
      <button type="button" className={view === 'productores' ? 'active' : ''}
        onClick={() => setView('productores')}>Productores</button>
    </nav>
  )

  return (
    <AuthGate>
      {view === 'mensajeria' ? (
        <div className="app">
          <ContactList
            contacts={contacts.filter((c) => c.phone === selectedPhone)}
            single
            loading={loadingContacts}
            error={contactsError}
            selectedPhone={selectedPhone}
            onSelect={setSelectedPhone}
            onReload={loadContacts}
            onBack={() => setView('productores')}
          />
          {selected ? (
            <Conversation key={selected.phone} contact={selected} />
          ) : (
            <main className="chat chat-empty">
              <p>Selecciona un contacto para ver su conversación</p>
            </main>
          )}
        </div>
      ) : (
        <div className="shell">
          {nav}
          {view === 'ofertas' ? (
            selectedOffer ? (
              <OfferDetail excedente={selectedOffer} onBack={() => setSelectedOffer(null)} />
            ) : (
              <OffersList onOpen={setSelectedOffer} />
            )
          ) : (
            <ProducersList onSendMessage={openMessagingWith} />
          )}
        </div>
      )}
    </AuthGate>
  )
}
