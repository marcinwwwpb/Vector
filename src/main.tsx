import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div style={{ padding: 32, color: '#e8eef4', background: '#16222c', minHeight: '100vh' }}>
        <h1>Wystąpił błąd interfejsu</h1>
        <p>Automatyczna kopia projektu pozostaje w przeglądarce.</p>
        <button onClick={() => location.reload()}>Załaduj ponownie</button>
        <pre>{this.state.error.message}</pre>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
