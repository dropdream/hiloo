// Superficie compartida entre ventana y documento.
export const windowBackground = '#183550'
export const windowControlsColor = '#edf3f8'
export const titleBarHeight = 32

export type WindowTheme = 'day' | 'night'

export interface AppearanceBridge {
  setTheme(theme: WindowTheme): Promise<void>
}

export const windowThemes = {
  night: { background: windowBackground, controls: windowControlsColor },
  day: { background: '#ffffff', controls: '#203f5d' }
} as const
