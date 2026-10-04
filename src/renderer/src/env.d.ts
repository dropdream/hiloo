import type { DocumentBridge } from '../../shared/documents'
import type { AppearanceBridge } from '../../shared/window'

declare global {
  interface Window {
    documents: DocumentBridge
    appearance: AppearanceBridge
  }
}
