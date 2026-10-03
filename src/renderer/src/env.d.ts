import type { DocumentBridge } from '../../shared/documents'

declare global {
  interface Window { documents: DocumentBridge }
}
