import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import App from './App'
import { I18nProvider } from './i18n'
import './styles.css'
import { useReplayOverlay } from './useReplayOverlay'

function EmbeddedOverlay({ client }: { client: string }) {
  const view = (window as Window & { chrome?: { webview?: { postMessage(message: string): void } } }).chrome?.webview
  const { open } = useReplayOverlay('en', error => view?.postMessage(error), client)
  useEffect(() => { void open() }, [])
  return null
}

const client = location.hostname === 'overlay.fortnite-chest-analyzer.local' ? new URLSearchParams(location.search).get('overlayClient') : null
createRoot(document.getElementById('root')!).render(client
  ? <EmbeddedOverlay client={client} />
  : <I18nProvider><App /></I18nProvider>)

