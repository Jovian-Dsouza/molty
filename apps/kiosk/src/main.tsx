import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

navigator.mediaDevices.enumerateDevices().then((devices) => {
  console.log('navigator.mediaDevices.enumerateDevices()', devices)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
