import { loadLog } from './boot/loadLog.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// Everything above has been downloaded, parsed and run by this point
loadLog.mark('bundle running')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
