import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { localeOf, translate, translateDetail } from './locales'
import type { Language } from './locales'

const preference = 'fortnite-replay:language'

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(preference)
    if (saved === 'es' || saved === 'en') return saved
  } catch { /* optional local preference */ }
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

function messages(language: Language) {
  return {
    t: (text: string, values?: Parameters<typeof translate>[2]) => translate(language, text, values),
    detail: (text: string) => translateDetail(language, text),
    num: (value: number, options?: Intl.NumberFormatOptions) => value.toLocaleString(localeOf(language), options),
    locale: localeOf(language),
  }
}

type I18n = ReturnType<typeof messages> & { language: Language; setLanguage: (language: Language) => void }
const I18nContext = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(initialLanguage)
  useEffect(() => {
    document.documentElement.lang = language
    try { localStorage.setItem(preference, language) } catch { /* session-only preference */ }
  }, [language])
  const value = useMemo(() => ({ ...messages(language), language, setLanguage }), [language])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('I18nProvider is missing.')
  return context
}
