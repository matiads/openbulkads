"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  CheckCircle2,
  ArrowRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { setupAccountsFromResponse, setupAccountsPath, type SetupAccount as MetaAccount } from "./setup-accounts";

type Step = 1 | 2 | 3 | 4;

export default function SetupWizard() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Admin
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  // Step 2: Meta Token
  const [metaToken, setMetaToken] = useState("");
  const [tokenOwnerName, setTokenOwnerName] = useState("");
  const [metaConnected, setMetaConnected] = useState(false);

  // Step 3: App credentials & accounts
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Helper API call with credentials
  async function api(path: string, options?: RequestInit) {
    const res = await fetch("/api/" + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Ocurrió un error inesperado.");
    }
    return data;
  }

  // Handle Step 1: Create Admin User & Sign In
  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      // 1. Create admin user
      await api("setup/admin", {
        method: "POST",
        body: JSON.stringify({
          name: adminName.trim(),
          email: adminEmail.trim(),
          password: adminPassword,
        }),
      });

      // 2. Sign in to set the Better Auth session cookie
      const signInResult = await authClient.signIn.email({
        email: adminEmail.trim(),
        password: adminPassword,
      });

      if (signInResult.error) {
        throw new Error(signInResult.error.message || "Error al iniciar sesión.");
      }

      setCurrentStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al crear la cuenta de administrador.");
    } finally {
      setBusy(false);
    }
  }

  // Handle Step 2: Connect Meta Token
  async function handleConnectMeta(e: React.FormEvent) {
    e.preventDefault();
    if (!metaToken.trim()) return;

    setBusy(true);
    setError(null);

    try {
      const conn = await api("connection", {
        method: "POST",
        body: JSON.stringify({ token: metaToken.trim() }),
      });

      setMetaConnected(true);
      setTokenOwnerName(conn.name || "Meta Usuario");

      // Pre-load accounts for step 3
      fetchAccounts();

      setCurrentStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo conectar el token con Meta.");
    } finally {
      setBusy(false);
    }
  }

  // Fetch accounts from Meta Graph
  async function fetchAccounts() {
    setLoadingAccounts(true);
    try {
      // Select all active accounts by default
      const { accounts: list, selected } = setupAccountsFromResponse(await api(setupAccountsPath));
      setAccounts(list);
      setSelectedAccounts(selected);
    } catch {
      // If accounts fail to load, user can configure them later
    } finally {
      setLoadingAccounts(false);
    }
  }

  // Handle Step 3: Save App Credentials and Accounts
  async function handleSaveSettings(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      // Save credentials if provided
      if (appId.trim() && appSecret.trim()) {
        await api("settings", {
          method: "POST",
          body: JSON.stringify({
            action: "credentials",
            appId: appId.trim(),
            secret: appSecret.trim(),
          }),
        });
      }

      // Save selected accounts if available
      if (selectedAccounts.length > 0) {
        await api("settings", {
          method: "POST",
          body: JSON.stringify({
            action: "accounts",
            selectedAccounts: selectedAccounts,
          }),
        });
      }

      setCurrentStep(4);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al guardar la configuración.");
    } finally {
      setBusy(false);
    }
  }

  function toggleAccount(id: string) {
    setSelectedAccounts((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  }

  return (
    <div className="shell" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top Bar */}
      <header className="topbar" style={{ padding: "0 40px", background: "#fff" }}>
        <div className="wordmark" aria-label="OpenBulkAds">
          Open<span>Bulk</span>Ads
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="step" style={{ fontSize: "11px", fontWeight: "700" }}>
            CONFIGURACIÓN INICIAL
          </span>
        </div>
      </header>

      {/* Main container */}
      <main style={{ flex: 1, display: "flex", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ width: "100%", maxWidth: "620px" }}>
          {/* Stepper Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "28px",
              padding: "0 8px",
            }}
          >
            {[
              { num: 1, label: "Admin" },
              { num: 2, label: "Meta" },
              { num: 3, label: "Cuentas" },
              { num: 4, label: "Listo" },
            ].map((s) => (
              <div
                key={s.num}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  color:
                    currentStep === s.num
                      ? "#8839ef"
                      : currentStep > s.num
                      ? "#3c6540"
                      : "var(--muted)",
                  fontWeight: currentStep === s.num ? "700" : "500",
                  fontSize: "13px",
                }}
              >
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    background:
                      currentStep === s.num
                        ? "#ede4ff"
                        : currentStep > s.num
                        ? "#dcefd9"
                        : "#e6e9ef",
                    color:
                      currentStep === s.num
                        ? "#7c3aed"
                        : currentStep > s.num
                        ? "#3c6540"
                        : "var(--muted)",
                    fontSize: "12px",
                    fontWeight: "700",
                  }}
                >
                  {currentStep > s.num ? "✓" : s.num}
                </div>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Error Banner */}
          {error && (
            <div className="notice" style={{ background: "#f8dce4", borderColor: "#f3b4c1", color: "#8b2d4b" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
              <button onClick={() => setError(null)} style={{ border: 0, background: "transparent", cursor: "pointer" }}>
                ✕
              </button>
            </div>
          )}

          {/* Step 1: Admin Account */}
          {currentStep === 1 && (
            <section className="panel" style={{ padding: "32px", borderRadius: "16px" }}>
              <div className="eyebrow" style={{ marginBottom: "8px" }}>
                PASO 1 DE 4 · PROPIETARIO
              </div>
              <h1 style={{ fontSize: "24px", margin: "0 0 8px 0" }}>Creá tu cuenta de Administrador</h1>
              <p className="helper" style={{ marginBottom: "24px" }}>
                Esta cuenta tendrá acceso total y será la propietaria del espacio de trabajo.
              </p>

              <form onSubmit={handleCreateAdmin}>
                <label className="field">
                  <span>Nombre completo</span>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Matias Aguirre"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    disabled={busy}
                  />
                </label>

                <label className="field">
                  <span>Correo electrónico</span>
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    placeholder="mati@ejemplo.com"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    disabled={busy}
                  />
                </label>

                <label className="field">
                  <span>Contraseña</span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Mínimo 8 caracteres"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    disabled={busy}
                  />
                  <small>Guardala bien. No hay recuperación automática por email en modo self-hosted.</small>
                </label>

                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !adminName || !adminEmail || adminPassword.length < 8}
                  style={{ marginTop: "12px" }}
                >
                  {busy ? <Loader2 className="spin" size={18} /> : null}
                  Continuar a Conexión de Meta <ArrowRight size={16} />
                </button>
              </form>
            </section>
          )}

          {/* Step 2: Meta Token (Skippable) */}
          {currentStep === 2 && (
            <section className="panel" style={{ padding: "32px", borderRadius: "16px" }}>
              <div className="eyebrow" style={{ marginBottom: "8px" }}>
                PASO 2 DE 4 · META ADS
              </div>
              <h1 style={{ fontSize: "24px", margin: "0 0 8px 0" }}>Conectá tu token de Meta</h1>
              <p className="helper" style={{ marginBottom: "24px" }}>
                Pegá tu token de usuario de Meta. Debe contar con permisos <code>ads_management</code> y <code>ads_read</code>.
              </p>

              <form onSubmit={handleConnectMeta}>
                <label className="field">
                  <span>Token de usuario de Meta</span>
                  <textarea
                    rows={4}
                    placeholder="EAAX..."
                    value={metaToken}
                    onChange={(e) => setMetaToken(e.target.value)}
                    disabled={busy}
                    style={{ fontFamily: "monospace", fontSize: "12px" }}
                  />
                  <small>
                    El token se cifra con clave AES de 32 bytes en el servidor antes de guardarse en la base de datos.
                  </small>
                </label>

                <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
                  <button
                    type="submit"
                    className="primary"
                    disabled={busy || !metaToken.trim()}
                    style={{ flex: 1 }}
                  >
                    {busy ? <Loader2 className="spin" size={18} /> : null}
                    Conectar y verificar con Meta
                  </button>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setCurrentStep(4)}
                    disabled={busy}
                    style={{ padding: "0 20px" }}
                  >
                    Omitir por ahora
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* Step 3: Meta App ID & Cuentas Publicitarias (Skippable) */}
          {currentStep === 3 && (
            <section className="panel" style={{ padding: "32px", borderRadius: "16px" }}>
              <div className="eyebrow" style={{ marginBottom: "8px" }}>
                PASO 3 DE 4 · CUENTAS Y CANJE
              </div>
              <h1 style={{ fontSize: "24px", margin: "0 0 8px 0" }}>Cuentas publicitarias</h1>
              <p className="helper" style={{ marginBottom: "20px" }}>
                Conectado como <strong>{tokenOwnerName}</strong>. Elegí las cuentas con las que vas a operar.
              </p>

              {/* Accounts list */}
              {loadingAccounts ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
                  <Loader2 className="spin" size={24} color="#8839ef" />
                </div>
              ) : accounts.length > 0 ? (
                <div style={{ marginBottom: "24px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", display: "block", marginBottom: "8px" }}>
                    Cuentas disponibles ({selectedAccounts.length} de {accounts.length} seleccionadas):
                  </span>
                  <div
                    style={{
                      maxHeight: "200px",
                      overflowY: "auto",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      padding: "8px",
                    }}
                  >
                    {accounts.map((acc) => (
                      <label
                        key={acc.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "8px",
                          borderBottom: "1px solid #f0f0f0",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedAccounts.includes(acc.id)}
                          onChange={() => toggleAccount(acc.id)}
                        />
                        <span style={{ fontSize: "13px" }}>
                          <strong>{acc.name}</strong> <small style={{ color: "var(--muted)" }}>({acc.id})</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="notice" style={{ marginBottom: "20px" }}>
                  No se detectaron cuentas publicitarias asociadas a este token o podés configurarlas luego en Settings.
                </div>
              )}

              {/* Optional App credentials */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px", marginBottom: "20px" }}>
                <span style={{ fontSize: "13px", fontWeight: "600", display: "block", marginBottom: "6px" }}>
                  Clave de tu App de Meta (Opcional)
                </span>
                <p className="helper" style={{ marginBottom: "12px", fontSize: "12px" }}>
                  Permite extender automáticamente los tokens de usuario a larga duración (60 días).
                </p>

                <div className="two-columns">
                  <label className="field">
                    <span>App ID</span>
                    <input
                      type="text"
                      placeholder="Ej. 1638631194443006"
                      value={appId}
                      onChange={(e) => setAppId(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Clave Secreta (App Secret)</span>
                    <input
                      type="password"
                      placeholder="••••••••••••••••"
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => handleSaveSettings()}
                  disabled={busy}
                  style={{ flex: 1 }}
                >
                  {busy ? <Loader2 className="spin" size={18} /> : null}
                  Guardar y finalizar
                </button>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setCurrentStep(4)}
                  disabled={busy}
                  style={{ padding: "0 20px" }}
                >
                  Omitir por ahora
                </button>
              </div>
            </section>
          )}

          {/* Step 4: Done */}
          {currentStep === 4 && (
            <section className="panel" style={{ padding: "36px", borderRadius: "16px", textAlign: "center" }}>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "#dcefd9",
                  color: "#3c6540",
                  display: "grid",
                  placeItems: "center",
                  margin: "0 auto 20px auto",
                }}
              >
                <CheckCircle2 size={32} />
              </div>

              <div className="eyebrow" style={{ color: "#3c6540", marginBottom: "8px" }}>
                ¡CONFIGURACIÓN COMPLETADA!
              </div>
              <h1 style={{ fontSize: "26px", margin: "0 0 12px 0" }}>Todo listo para operar</h1>
              <p className="helper" style={{ marginBottom: "28px", maxWidth: "440px", marginInline: "auto" }}>
                Tu usuario administrador fue creado y tu sesión ya está activa. Podés empezar a cargar anuncios masivos en pausa.
              </p>

              <div
                style={{
                  background: "#f7f5ff",
                  border: "1px solid #e7e1f4",
                  borderRadius: "12px",
                  padding: "16px 20px",
                  marginBottom: "28px",
                  textAlign: "left",
                  fontSize: "13px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Usuario Admin:</span>
                  <strong>{adminEmail || "Configurado"}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Conexión con Meta:</span>
                  <strong>{metaConnected ? "Conectado (" + tokenOwnerName + ")" : "Pendiente (configurar en Settings)"}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Cuentas publicitarias:</span>
                  <strong>{selectedAccounts.length > 0 ? `${selectedAccounts.length} seleccionadas` : "Todas las disponibles"}</strong>
                </div>
              </div>

              <button
                type="button"
                className="primary"
                onClick={() => {
                  router.push("/");
                }}
                style={{ width: "100%", height: "48px", fontSize: "15px" }}
              >
                Ir al Workspace de OpenBulkAds <ArrowRight size={18} />
              </button>
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer style={{ padding: "20px 40px", borderTop: "1px solid var(--border)", fontSize: "12px", color: "var(--muted)" }}>
        <span>OpenBulkAds · Herramienta autoalojada y de código abierto</span>
        <span>Privacidad total en tu propia infraestructura</span>
      </footer>
    </div>
  );
}
