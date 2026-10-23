// Puertos del loopback de Auth0. Auth0 compara la URL completa, así que cada puerto
// debe estar en Allowed Callback URLs como http://127.0.0.1:<puerto>/callback.
export const auth0CallbackPorts = [47615, 47616] as const
export const auth0CallbackPath = '/callback'

export type CloudStatus =
  | { state: 'unconfigured' }
  | { state: 'signed-out' }
  | { state: 'signed-in'; name: string | null; email: string | null }

export type CloudResult<T> = { status: 'ok'; value: T } | { status: 'cancelled' } | { status: 'error'; message: string }

export interface CloudProbe {
  organizations: string[]
  rows: { organization: string; text: string }[]
}

export interface CloudBridge {
  status(): Promise<CloudStatus>
  signIn(): Promise<CloudResult<CloudStatus>>
  cancelSignIn(): Promise<void>
  signOut(): Promise<CloudStatus>
  probe(): Promise<CloudResult<CloudProbe>>
}
