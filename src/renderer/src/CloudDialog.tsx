import { useEffect, useId, useRef, useState } from 'react'
import type { CloudProbe, CloudStatus } from '../../shared/cloud'
import styles from './CloudDialog.module.css'

interface Props {
  onClose(): void
  onStatus(status: CloudStatus): void
}

// Prueba 0c: inicio de sesión con Auth0 y lectura de Supabase con RLS.
export function CloudDialog({ onClose, onStatus }: Props) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [probe, setProbe] = useState<CloudProbe | null>(null)
  const signingIn = useRef(false)

  useEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    let active = true
    void window.cloud.status().then((value) => { if (active) setStatus(value) })
    return () => {
      active = false
      if (signingIn.current) void window.cloud.cancelSignIn()
      element.close()
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const signIn = () => run(async () => {
    setMessage('Completa el inicio de sesión en el navegador.')
    signingIn.current = true
    const result = await window.cloud.signIn().finally(() => { signingIn.current = false })
    if (result.status === 'ok') {
      setStatus(result.value)
      onStatus(result.value)
      setMessage('')
    } else setMessage(result.status === 'cancelled' ? 'Inicio de sesión cancelado.' : result.message)
  })

  const signOut = () => run(async () => {
    setProbe(null)
    const next = await window.cloud.signOut()
    setStatus(next)
    onStatus(next)
  })

  const read = () => run(async () => {
    const result = await window.cloud.probe()
    if (result.status === 'ok') setProbe(result.value)
    else {
      setProbe(null)
      setMessage(result.status === 'error' ? result.message : '')
    }
  })

  const signedIn = status?.state === 'signed-in'
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-busy={busy || !status}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={`${id}-title`}>Cuenta en la nube</h2>
      <p className={styles.state} aria-live="polite">
        {!status ? 'Consultando…'
          : status.state === 'unconfigured' ? 'Esta copia de hiloo no tiene configurada la nube.'
          : status.state === 'signed-out' ? 'No has iniciado sesión.'
          : `Sesión iniciada como ${status.name ?? status.email ?? 'usuario de Auth0'}.`}
      </p>
      {message ? <p role="alert" className={styles.message}>{message}</p> : null}
      {probe ? (
        <section aria-label="Lectura de prueba" className={styles.probe}>
          <p>Organizaciones visibles: {probe.organizations.length ? probe.organizations.join(', ') : 'ninguna'}.</p>
          {probe.rows.length ? (
            <ul>
              {probe.rows.map((row, index) => <li key={index}>{row.organization}: {row.text}</li>)}
            </ul>
          ) : <p>No hay filas visibles.</p>}
        </section>
      ) : null}
      <footer>
        {signedIn ? (
          <>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void signOut()}>Cerrar sesión</button>
            <button type="button" disabled={busy} onClick={() => void read()}>Probar lectura</button>
          </>
        ) : status?.state === 'signed-out' ? (
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void signIn()}>
            {busy ? 'Esperando al navegador…' : 'Iniciar sesión'}
          </button>
        ) : null}
        <button type="button" onClick={onClose}>Cerrar</button>
      </footer>
    </dialog>
  )
}
