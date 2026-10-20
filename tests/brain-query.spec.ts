import { test, expect } from './fixtures'
import { ftsQuery } from '../src/main/brain/query'
import { detectLanguage, searchLanguages } from '../src/main/brain/languages'

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'local', 'La construcción de la consulta no depende del paquete.')
})
const query = (text: string) => ftsQuery(text, ['es', 'en'])

test('una pregunta en lenguaje natural une sus palabras clave con OR y descarta las vacías', () => {
  expect(query('¿Qué es el cron de la flota?')).toEqual({ expression: '"cron" OR ("flota" OR "flot"*)', terms: ['cron', 'flota'] })
})

test('cada palabra busca también su raíz Snowball en los idiomas activos', () => {
  const es = (text: string) => ftsQuery(text, ['es']).expression
  expect(es('desactivar sucursales')).toBe('("desactivar" OR "desactiv"*) OR ("sucursales" OR "sucursal"*)')
  expect(es('cambio nueva')).toBe('("cambio" OR "cambi"*) OR ("nueva" OR "nuev"*)')
  expect(es('caja')).toBe('"caja"')
  expect(ftsQuery('facturas', ['es', 'en']).expression).toBe('("facturas" OR "factur"*)')
  expect(ftsQuery('Säumiger Kunde', ['de']).expression).toBe('("säumiger" OR "saumig"*) OR ("kunde" OR "kund"*)')
})

test('sin raíz útil, las palabras de seis o más letras buscan por prefijo', () => {
  expect(ftsQuery('Transacción', ['es']).expression).toBe('("transacción" OR "transacci"*)')
  expect(ftsQuery('choferes', []).expression).toBe('("choferes" OR "chofer"*)')
  expect(ftsQuery('caja nueva', []).expression).toBe('"caja" OR "nueva"')
})

test('la sintaxis FTS5 de la entrada queda como texto literal', () => {
  expect(ftsQuery('NEAR(alfa beta) "gamma" -delta: col:valor* ^raiz NOT', []).expression)
    .toBe('"near" OR "alfa" OR "beta" OR "gamma" OR "delta" OR "col" OR "valor" OR "raiz" OR "not"')
  expect(query('load_manifests v3 2789401').expression).toBe('"load_manifests" OR "load_manifests" OR "v3" OR "2789401"')
})

test('entradas vacías, repetidas o hechas solo de palabras vacías dan una consulta acotada', () => {
  expect(query('  ¿?¡! -- ** ')).toEqual({ expression: '', terms: [] })
  expect(query('Caja caja CAJA cajá').terms).toEqual(['caja'])
  expect(query('¿Qué es eso?')).toEqual({ expression: '"qué" OR "es" OR "eso"', terms: ['qué', 'es', 'eso'] })
  expect(query(Array.from({ length: 40 }, (_, index) => `t${index}`).join(' ')).terms).toHaveLength(16)
})

test('los términos conservan tildes y escrituras no latinas para que los trate el tokenizador', () => {
  expect(query('Transacción').terms).toEqual(['transacción'])
  expect(query('हिन्दी').terms).toEqual(['हिन्दी'])
})

test('el idioma se detecta por la frecuencia de palabras vacías y no decide con poca evidencia', () => {
  expect(detectLanguage('¿Cómo se anula una factura cuando el cliente ya pagó la orden?')).toBe('es')
  expect(detectLanguage('How do we cancel an invoice when the customer has already paid?')).toBe('en')
  expect(detectLanguage('Como se cancela uma fatura quando o cliente já pagou o pedido do mês?')).toBe('pt')
  expect(detectLanguage("Comment annuler une facture quand le client a déjà payé la commande ?")).toBe('fr')
  expect(detectLanguage('Wie storniert man eine Rechnung, wenn der Kunde schon für die Bestellung bezahlt hat?')).toBe('de')
  expect(detectLanguage("Come si annulla una fattura quando il cliente ha già pagato l'ordine?")).toBe('it')
  expect(detectLanguage('factura retiro sucursal')).toBeNull()
})

test('solo se descartan las palabras vacías de los idiomas activos', () => {
  expect(ftsQuery('¿Cómo se usa die en la sucursal?', ['es']).terms).toEqual(['die', 'sucursal'])
  expect(ftsQuery('¿Cómo se usa die en la sucursal?', ['es', 'de']).terms).toEqual(['sucursal'])
  expect(ftsQuery('the invoice of la sucursal', ['es']).terms).toEqual(['the', 'invoice', 'of', 'sucursal'])
  expect(ftsQuery('the invoice of la sucursal', ['es', 'en']).terms).toEqual(['invoice', 'sucursal'])
})

test('los idiomas de la búsqueda suman los del cuaderno y el de la pregunta', () => {
  expect(searchLanguages('factura retiro', ['es'])).toEqual(['es'])
  expect(searchLanguages('How do we cancel the invoice?', ['es'])).toEqual(['es', 'en'])
  expect(searchLanguages('the invoice', [])).toEqual(['en'])
  expect(searchLanguages('factura retiro', [])).toEqual([])
})

test('los identificadores con guion bajo cuentan doble para no quedar bajo palabras comunes', () => {
  expect(ftsQuery('¿qué permisos pide list_cash_pending?', ['es']).expression)
    .toBe('("permisos" OR "permis"*) OR "pide" OR "list_cash_pending" OR "list_cash_pending"')
})
