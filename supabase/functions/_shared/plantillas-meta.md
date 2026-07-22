# Plantillas de WhatsApp (Meta) — contenido listo para dar de alta

> **Estado:** preparadas, **no aprobadas**. La creación y aprobación se hace en el
> **WhatsApp Manager** de Meta (business.facebook.com → WhatsApp Manager → Plantillas de
> mensajes) o por la Cloud API `POST /{WABA_ID}/message_templates`, y la revisa **Meta**
> (minutos–24 h). En el **número de test** solo `hello_world` es usable; para estas plantillas
> hace falta un **número/WABA de producción** (verificación de empresa). Mientras tanto, las
> ofertas a entidades salen por **texto en la ventana de 24 h** (ver `whatsapp-send` + AGENTS.md).

El envío por plantilla ya está soportado en `whatsapp-send` (`type: "template"`, con `template`,
`language` y `components`). Solo falta, cuando estén aprobadas, pasar los `components` con los
parámetros. Abajo va el mapeo desde los campos del excedente (`componerTextoOferta`, `oferta.ts`).

---

## 1. `oferta_excedent` — aviso de oferta a una entidad

- **Nombre:** `oferta_excedent`
- **Categoría:** `UTILITY` (aviso operativo; si Meta la reclasifica a `MARKETING`, requiere opt-in de marketing)
- **Idioma:** `ca` (català)
- **Header:** Text — `📢 Nova oferta d'excedent disponible`
- **Body** (7 variables):

```
Hola! Hi ha un excedent disponible que us pot interessar:

🌿 Producte: {{1}}
👩‍🌾 Productor: {{2}}
📍 Municipi: {{3}}
📦 Quantitat: {{4}}
📅 Disponible: {{5}}
⏰ Horari recollida: {{6}}

Responsable: {{7}}. Respon a aquest missatge si el voleu recollir.
```

- **Mapeo de variables** (desde el excedente):
  1. `producto` (+ `variedad` si hay)
  2. nombre del productor
  3. `municipi` (de la ubicación / població del productor)
  4. `kg_total` kg (+ `num_caixes` caixes)
  5. `disponible_hasta`
  6. `horari_recollida`
  7. responsable (equipo POMA)

- **Ejemplo de `components` para `whatsapp-send`:**

```jsonc
{
  "to": "34…", "type": "template", "template": "oferta_excedent", "language": "ca",
  "components": [
    { "type": "header", "parameters": [] },
    { "type": "body", "parameters": [
      { "type": "text", "text": "Tomàquet" },
      { "type": "text", "text": "Cal Pere" },
      { "type": "text", "text": "El Prat" },
      { "type": "text", "text": "120 kg" },
      { "type": "text", "text": "fins 30/07" },
      { "type": "text", "text": "matins" },
      { "type": "text", "text": "Equip POMA" }
    ]}
  ]
}
```

## 2. `confirmacio_productor` — confirmación al productor tras crear la oferta

- **Nombre:** `confirmacio_productor`
- **Categoría:** `UTILITY`
- **Idioma:** `ca`
- **Body** (2 variables):

```
Gràcies! Hem registrat la teva oferta de {{1}} amb la referència {{2}}. T'avisarem quan estigui canalitzada. 🌱
```

- **Mapeo:** 1 = `producto`, 2 = `id_excedente`.
- Hoy este texto se manda como **texto** desde `crearExcedenteDesdeSesion` (dentro de la ventana,
  porque lo abre el productor); esta plantilla solo hace falta si algún día se envía fuera de ventana.

## 3. (opcional) `recollida_confirmada` — RECOLLIDA CONFIRMADA

Si se quisiera notificar fuera de ventana el cierre de una canalización, replicar el texto de
`src/lib/textos.ts` (`textoRecollidaConfirmada`) como plantilla con variables entitat / data /
kg recollits / kg falten. Hoy se **copia a mano** desde el panel, así que no es urgente.

---

### Notas de aprobación
- Menos variables = aprobación más fácil. Evitar URLs y contenido promocional en `UTILITY`.
- El `language` debe coincidir **exactamente** con el de la plantilla aprobada (`ca`).
- Si Meta devuelve `132001` (plantilla no existe) o `132000` (nº de parámetros), revisar nombre,
  idioma y que `components` tenga tantos `text` como variables.
