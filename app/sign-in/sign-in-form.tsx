"use client";

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export default function SignInForm({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      setError('No pudimos iniciar sesión con esas credenciales.');
      setBusy(false);
      return;
    }
    window.location.assign(returnTo);
  }

  return (
    <div className="shell">
      <main style={{ margin: '0 auto', maxWidth: '440px', width: '100%', padding: '72px 24px' }}>
        <div className="wordmark" aria-label="OpenBulkAds">
          Open<span>Bulk</span>Ads
        </div>
        <section className="panel" style={{ marginTop: '24px' }}>
          <div className="eyebrow">ACCESO PRIVADO</div>
          <h1 style={{ fontSize: '26px' }}>Iniciá sesión</h1>
          <p className="helper" style={{ marginBottom: '20px' }}>
            El registro público está cerrado. Un administrador debe crear tu cuenta.
          </p>
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={submit}>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Contraseña</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
