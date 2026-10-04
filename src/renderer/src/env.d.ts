import type { DocumentBridge } from '../../shared/documents'
import type { AppearanceBridge } from '../../shared/window'
import type { WorkspaceBridge } from '../../shared/workspace'
import type { BrainBridge } from '../../shared/brain'

declare global {
  interface Window {
    documents: DocumentBridge
    appearance: AppearanceBridge
    workspace: WorkspaceBridge
    brain: BrainBridge
  }
}
