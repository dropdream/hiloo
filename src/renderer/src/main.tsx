import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { titleBarHeight, windowBackground } from '../../shared/window'
import { App } from './App'
import './global.css'

document.documentElement.style.setProperty('--hiloo-window-background', windowBackground)
document.documentElement.style.setProperty('--hiloo-titlebar-height', `${titleBarHeight}px`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
