import type { DocumentBridge } from '../../shared/documents'
import type { AppearanceBridge } from '../../shared/window'
import type { WorkspaceBridge } from '../../shared/workspace'

declare global {
  interface Window {
    documents: DocumentBridge
    appearance: AppearanceBridge
    workspace: WorkspaceBridge
  }
}
