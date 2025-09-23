import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './i18n';

// Persist login email from OAuth callback query (?auth=ok&email=...)
try {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth');
  const email = params.get('email');
  if (auth === 'ok' && email && email.includes('@')) {
    localStorage.setItem('currentEmail', email);
    // Optional: clean the query string to avoid leaking params
    const url = new URL(window.location.href);
    url.searchParams.delete('auth');
    url.searchParams.delete('email');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }
} catch {}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback="Loading...">
      <App />
    </Suspense>
  </React.StrictMode>,
)
