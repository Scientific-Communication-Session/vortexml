import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

const root = document.getElementById('root')!
const app = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)

// The build writes most pages out as HTML (scripts/prerender.mjs): take over
// that markup where it exists, and draw from scratch on the empty shell.
if (root.firstElementChild) hydrateRoot(root, app)
else createRoot(root).render(app)
