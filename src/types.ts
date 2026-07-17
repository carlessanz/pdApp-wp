export interface WaContact {
  id: string
  phone: string
  name: string | null
  opt_in: boolean
  opt_in_at: string | null
  opt_out_at: string | null
  created_at: string
}

export interface Productor {
  id: string
  name: string
  email: string | null
  phone: string
  created_at: string
}

export interface WaMessage {
  id: string
  wa_message_id: string | null
  contact_phone: string
  direction: 'inbound' | 'outbound'
  type: string | null
  body: string | null
  status: string | null
  created_at: string
}
