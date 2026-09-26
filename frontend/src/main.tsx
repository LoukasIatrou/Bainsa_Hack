import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SpiderSenseDemo } from './spiderSense/SpiderSenseDemo.tsx'

// #spider-sense opens the standalone circle harness until it's wired into the Explore page.
const Root = window.location.hash === '#spider-sense' ? SpiderSenseDemo : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
