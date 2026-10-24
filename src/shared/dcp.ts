// Contrato compartido de la etapa 1 (docs/etapa-1-contrato.md): identidad DCP local,
// escritura desde el MCP, intenciones, commits locales y bloqueos. Lo usan los tres
// frentes (A escritura, B identidad, C firma) y la etapa 3 lo sube a Supabase tal cual.
//
// Convención: los objetos que se firman (cargas DCP) van en snake_case, porque su JSON
// canónico es lo que se firma y lo que viaja; lo que solo vive en la app va en camelCase.

export const hilooContratoVersion = 1

// Variables con las que el MCP sabe quién es y dónde puede escribir.
export const envAgente = 'HILOO_AGENTE'
export const envEscritura = 'HILOO_ESCRITURA'
export const envBase = 'HILOO_BRAIN_DB'

export type NivelRiesgo = 'routine' | 'standard' | 'elevated' | 'maximum'
export const nivelesRiesgo: readonly NivelRiesgo[] = ['routine', 'standard', 'elevated', 'maximum']

export type AlgoritmoFirma = 'ed25519' | 'ml-dsa-65'

// --- Firmas (espejo de los tipos del SDK de DCP v2, sin depender de él en shared) ----------

export interface EntradaFirma {
  alg: AlgoritmoFirma
  kid: string
  sig_b64: string
}

// classical_only en la etapa 1; pq_over_classical cuando el agente tenga mitad ML-DSA-65.
export interface FirmaCompuesta {
  classical: EntradaFirma
  pq: EntradaFirma | null
  binding: 'pq_over_classical' | 'classical_only'
}

// Envoltorio SignedPayload del SDK: la carga nunca contiene la firma; payload_hash es "sha256:<hex>".
export interface CargaFirmada<T> {
  payload: T
  payload_hash: string
  composite_sig: FirmaCompuesta
}

// KeyEntry del pasaporte v2 de DCP.
export interface ClavePublica {
  kid: string
  alg: AlgoritmoFirma
  public_key_b64: string
  created_at: string
  expires_at: string | null
  status: 'active' | 'revoked' | 'expired'
}

// --- Persona (plantilla) ---------------------------------------------------------------------

export interface PermisosPersona {
  // Ids de cuaderno del Cerebro (etapa 3: ids de cuadernos de la organización).
  cuadernos: string[]
  // Repos permitidos: URL remota o ruta local normalizada.
  repos: string[]
  // Globs relativos al cuaderno o al repo; vacío = sin restricción de rutas.
  rutas: string[]
  nivel_max: NivelRiesgo
}

export interface Personalidad {
  tono?: string
  idioma?: string
  estilo?: string
  detalle?: string
  instrucciones?: string
}

// Carga firmada por un admin (firma_admin) a partir de la etapa 3; en la 1 se guarda sin firma.
export interface PersonaPayload {
  hiloo_version: typeof hilooContratoVersion
  tipo: 'persona'
  id: string
  org_id: string
  nombre_plantilla: string
  rol: string
  permisos: PermisosPersona
  personalidad: Personalidad | null
  version: number
  creada_en: string
}

export interface Persona {
  id: string
  orgId: string
  nombrePlantilla: string
  rol: string
  permisos: PermisosPersona
  nivelMax: NivelRiesgo
  personalidad: Personalidad | null
  version: number
  firmaAdmin: FirmaCompuesta | null
  creadaEn: string
  actualizadaEn: string
}

// --- Agente (instancia): el pasaporte --------------------------------------------------------

// Capacidades DCP-01 que Hiloo deriva de los permisos (file_write para notas, code_exec para repos).
export type CapacidadDcp = 'browse' | 'api_call' | 'email' | 'calendar' | 'payments' | 'crm' | 'file_write' | 'code_exec'

// Parte propia de Hiloo dentro del pasaporte; es lo que calza con la tabla agentes (sección 8).
export interface PasaporteHiloo {
  org_id: string
  persona_id: string
  persona_version: number
  nombre: string
  rol: string
  permisos: PermisosPersona
  // Solo puede restringir respecto de la plantilla, nunca ampliar.
  restricciones: Partial<PermisosPersona> | null
  responsable_id: string | null
  vence_en: string | null
  avatar: string | null
  color: string | null
  org_origen: string | null
}

// Carga del pasaporte: AgentPassportV2 de DCP más la parte de Hiloo. Se firma con el contexto
// DCP-AI.v2.AgentPassport. En la etapa 1 la firma es de la propia clave del agente (prueba de
// posesión); la de emisión por un admin (firma_emision) llega con la etapa 3.
export interface PasaportePayload {
  dcp_version: '2.0'
  agent_id: string
  session_nonce: string
  keys: ClavePublica[]
  principal_binding_reference: string
  capabilities: CapacidadDcp[]
  risk_tier: 'low' | 'medium' | 'high'
  created_at: string
  status: 'active' | 'revoked' | 'suspended'
  hiloo: PasaporteHiloo
}

export type Pasaporte = CargaFirmada<PasaportePayload>

export interface Agente {
  id: string
  orgId: string
  personaId: string
  personaVersion: number
  nombre: string
  avatar: string | null
  color: string | null
  restricciones: Partial<PermisosPersona> | null
  responsableId: string | null
  clavePublica: string
  kid: string
  clavePqPublica: string | null
  kidPq: string | null
  // sha256 del secreto de emparejamiento que el MCP usa con el firmante; nunca el secreto.
  secretoHash: string | null
  pasaporte: Pasaporte
  orgOrigen: string | null
  emitidoPor: string | null
  firmaEmision: FirmaCompuesta | null
  venceEn: string | null
  revocadoEn: string | null
  // Emergencia: desde cuándo se sospecha; lo firmado después se marca con ⚠.
  revocadoDesde: string | null
  revocadoMotivo: string | null
  creadoEn: string
}

// Lo que el recurso quien_soy entrega al agente al empezar. La personalidad guía; los permisos obligan.
export interface QuienSoy {
  agente: Pick<Agente, 'id' | 'nombre' | 'orgId' | 'kid' | 'venceEn'>
  rol: string
  permisos: PermisosPersona
  personalidad: Personalidad | null
  responsable: string | null
  // Siempre true: el agente se presenta como IA.
  esIA: true
  escrituraHabilitadaEn: string[]
}

// --- Intenciones (DCP-02) --------------------------------------------------------------------

export interface IntencionPayload {
  dcp_version: '2.0'
  intent_id: string
  session_nonce: string
  agent_id: string
  human_id: string
  timestamp: string
  action_type: 'write_file' | 'execute_code' | 'api_call' | 'browse'
  target: { channel: 'filesystem' | 'runtime' | 'api'; repo?: string | null; rama?: string | null; cuaderno?: string | null }
  data_classes: ('none' | 'company_confidential' | 'pii')[]
  estimated_impact: 'low' | 'medium' | 'high'
  requires_consent: boolean
  security_tier: NivelRiesgo
  hiloo: { accion: string; recurso: string; descripcion: string }
}

export interface Intencion {
  id: string
  orgId: string
  agenteId: string
  repo: string | null
  rama: string | null
  accion: string
  recurso: string
  nivel: NivelRiesgo
  payload: IntencionPayload
  payloadHash: string
  firma: FirmaCompuesta
  creadaEn: string
}

// --- Commits locales (sección 5 y prueba 0a) -------------------------------------------------

export interface CommitRegistroPayload {
  tipo: 'commit'
  org_id: string
  agent_id: string
  intent_id: string | null
  repo: string
  rama: string | null
  sha: string
  patch_id: string | null
  fecha_commit: string
  registrado_en: string
}

export interface CommitLocal {
  id: string
  orgId: string
  repo: string
  sha: string
  patchId: string | null
  rama: string | null
  agenteId: string
  intencionId: string | null
  // La fecha del commit la pone quien firma; registrado_en es el reloj del Cerebro.
  fechaCommit: string
  registradoEn: string
  firma: FirmaCompuesta | null
}

// --- Escrituras (autoría local, sección 11) ---------------------------------------------------

export type HerramientaEscritura = 'create_note' | 'replace_section' | 'append_section'

export interface EscrituraPayload {
  tipo: 'escritura'
  org_id: string
  agent_id: string
  intent_id: string | null
  cuaderno: string
  ruta: string
  herramienta: HerramientaEscritura
  hash_antes: string | null
  hash_despues: string
  creada_en: string
}

export interface Escritura {
  id: string
  orgId: string
  notebookId: string
  nodeId: string | null
  ruta: string
  herramienta: HerramientaEscritura
  cliente: string
  agenteId: string | null
  intencionId: string | null
  hashAntes: string | null
  hashDespues: string
  firma: FirmaCompuesta | null
  creadaEn: string
}

// --- Bloqueos (préstamo con vencimiento, sección 7b) ------------------------------------------

export const bloqueoDuracionAppMs = 30_000
export const bloqueoDuracionAgenteMs = 60_000

export interface Bloqueo {
  // pathKey (ruta absoluta en minúsculas) de la nota; sirve antes de que exista el nodo.
  artefactoKey: string
  orgId: string
  notebookId: string
  titularTipo: 'app' | 'agente'
  titularId: string
  titularNombre: string
  pid: number | null
  venceEn: string
  creadoEn: string
}

// --- Errores de las herramientas MCP ----------------------------------------------------------

export type CodigoErrorMcp =
  | 'escritura_desactivada'
  | 'cuaderno_no_permitido'
  | 'ruta_invalida'
  | 'nota_existente'
  | 'nota_no_encontrada'
  | 'seccion_no_encontrada'
  | 'hash_desactualizado'
  | 'bloqueada'
  | 'markdown_no_admitido'
  | 'demasiado_grande'
  | 'sin_agente'
  | 'agente_desconocido'
  | 'agente_revocado'
  | 'agente_vencido'
  | 'fuera_de_permisos'
  | 'sin_intencion'
  | 'firmante_no_disponible'
  | 'clave_no_cargada'
  | 'repo_invalido'
  | 'ssh_agent_detenido'
  | 'interno'

export interface ErrorMcp {
  error: string
  codigo: CodigoErrorMcp
  detalle?: Record<string, string | number | boolean | null>
}
