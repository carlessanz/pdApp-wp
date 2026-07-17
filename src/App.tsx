import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import type { Productor, WaContact } from './types'
import PasswordGate from './components/PasswordGate'
import ProducersList from './components/ProducersList'
import ContactList from './components/ContactList'
import Conversation from './components/Conversation'

type View = 'productores' | 'mensajeria'

export default function App() {
  const [view, setView] = useState<View>('productores')
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

  return (
    <PasswordGate>
      {view === 'productores' ? (
        <ProducersList onSendMessage={openMessagingWith} />
      ) : (
        <div className="app">
          <ContactList
            contacts={contacts}
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
      )}
    </PasswordGate>
  )
}
