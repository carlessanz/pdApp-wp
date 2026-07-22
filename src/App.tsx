import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
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

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const [selectedOffer, setSelectedOffer] = useState<Excedente | null>(null)
  const [contacts, setContacts] = useState<WaContact[]>([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [contactsError, setContactsError] = useState<string | null>(null)
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)

  // CRUD: ficha abierta (editar) o alta nueva, para productores y entidades.
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

  // Abre la mensajería con un teléfono (de un productor o de una entidad),
  // asegurándolo como contacto de WhatsApp (con opt-in, como "Añadir contacto")
  // sin tocar los existentes.
  const openMessagingWithContact = useCallback(
    async (phone: string, name: string | null) => {
      if (!phone) return
      const { error } = await supabase.from('wa_contacts').upsert(
        { phone, name, opt_in: true, opt_in_at: new Date().toISOString() },
        { onConflict: 'phone', ignoreDuplicates: true },
      )
      if (error) console.error('wa_contacts upsert:', error.message)
      // Si ya existía (p. ej. creado por el webhook), sincroniza el nombre sin
      // tocar su consentimiento.
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

  // La mensajería tiene su propia navegación interna (sidebar + volver), así que
  // la barra superior solo se muestra fuera de ella.
  const nav = (
    <nav className="topnav">
      <button type="button" className={view === 'dashboard' ? 'active' : ''}
        onClick={() => setView('dashboard')}>Dashboard</button>
      <button type="button" className={view === 'ofertas' ? 'active' : ''}
        onClick={() => { setView('ofertas'); setSelectedOffer(null) }}>Ofertas</button>
      <button type="button" className={view === 'productores' ? 'active' : ''}
        onClick={() => { setView('productores'); cerrarProductor() }}>Productores</button>
      <button type="button" className={view === 'entidades' ? 'active' : ''}
        onClick={() => { setView('entidades'); cerrarEntidad() }}>Entidades</button>
      <button type="button" className={view === 'mensajeria' ? 'active' : ''}
        onClick={() => setView('mensajeria')}>Mensajería</button>
    </nav>
  )

  return (
    <AuthGate>
      {view === 'mensajeria' ? (
        <div className="app">
          <ContactList
            contacts={contacts}
            loading={loadingContacts}
            error={contactsError}
            selectedPhone={selectedPhone}
            onSelect={setSelectedPhone}
            onReload={loadContacts}
            onBack={() => setView('dashboard')}
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
                titulo="Productor"
                volverLabel="Productores"
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
                titulo="Entidad"
                volverLabel="Entidades"
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
      )}
    </AuthGate>
  )
}
