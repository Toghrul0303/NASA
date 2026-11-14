import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, initialTheme } from './ui/theme'
import './styles/index.css'

applyTheme(initialTheme())

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element #root is missing.')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
