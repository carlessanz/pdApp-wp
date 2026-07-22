import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './lib/i18n'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <TooltipProvider delayDuration={200}>
        <App />
      </TooltipProvider>
      <Toaster richColors position="top-right" />
    </I18nProvider>
  </StrictMode>,
)
