import { useEffect, useState } from 'react'
import type { CloudStatus } from '../../shared/cloud'
import { CloudDialog } from './CloudDialog'
import { Icon } from './Icon'
import styles from './AccountButton.module.css'

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return [words[0], words.length > 1 ? words.at(-1) : undefined]
    .map((word) => (word ? Array.from(word)[0] : ''))
    .join('')
    .toLocaleUpperCase()
}

function Avatar({ picture, label }: { picture: string | null; label: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [picture])
  if (picture && !failed) {
    return <img className={styles.picture} src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  }
  return label ? <span className={styles.initials} aria-hidden="true">{label}</span> : <Icon name="account" />
}

// Botón de cuenta de la barra superior: foto del perfil con sesión, ícono genérico sin ella.
export function AccountButton() {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    window.cloud.status().then((value) => { if (active) setStatus(value) }, () => {})
    return () => { active = false }
  }, [])

  const user = status?.state === 'signed-in' ? status : null
  const person = user ? user.name ?? user.email : null
  const title = person ? `Cuenta en la nube: ${person}` : 'Cuenta en la nube: sin sesión'
  return (
    <>
      <button
        type="button"
        className={styles.account}
        aria-label={title}
        title={title}
        aria-haspopup="dialog"
        data-signed-in={user ? '' : undefined}
        onClick={() => setOpen(true)}
      >
        <Avatar picture={user?.picture ?? null} label={person ? initials(person) : ''} />
      </button>
      {open ? <CloudDialog onClose={() => setOpen(false)} onStatus={setStatus} /> : null}
    </>
  )
}
