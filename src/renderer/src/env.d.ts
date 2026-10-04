import type { DocumentBridge } from '../../shared/documents'
import type { AppearanceBridge } from '../../shared/window'
import type { WorkspaceBridge } from '../../shared/workspace'
import type { BrainBridge } from '../../shared/brain'
import type { SettingsBridge } from '../../shared/settings'

declare global {
  interface Window {
    documents: DocumentBridge
    appearance: AppearanceBridge
    workspace: WorkspaceBridge
    brain: BrainBridge
    settings: SettingsBridge
  }
}
