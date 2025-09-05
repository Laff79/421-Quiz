import { CFG } from '../config'
import { randomString, sha256 } from './pkce'

// Scopes for Web Playback + spillelister + profil-info (/me)
const SCOPES = [
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-email',        // nødvendig for /v1/me i noen miljø
  'user-read-private'       // nødvendig for /v1/me i noen miljø
].join(' ')

/**
 * Start Spotify-innlogging (Authorization Code + PKCE).
 * show_dialog=true tvinger nytt samtykke slik at token får riktige scopes.
 */
export function beginLogin() {
  const verifier = randomString(64)
  sessionStorage.setItem('pkce_verifier', verifier)

  sha256(verifier).then((code_challenge) => {
    const url = new URL('https://accounts.spotify.com/authorize')
    url.searchParams.set('client_id', CFG.spotifyClientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set(
      'redirect_uri',
      new URL(CFG.redirectUri, window.location.origin).toString()
    )
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('code_challenge', code_challenge)
    url.searchParams.set('scope', SCOPES)
    url.searchParams.set('show_dialog', 'true') // tving re-consent
    window.location.href = url.toString()
  })
}

/**
 * Bytt "code" mot access_token hos Spotify
 */
export async function exchangeCodeForToken(code: string) {
  const verifier = sessionStorage.getItem('pkce_verifier')!
  const body = new URLSearchParams()
  body.set('client_id', CFG.spotifyClientId)
  body.set('grant_type', 'authorization_code')
  body.set('code', code)
  body.set(
    'redirect_uri',
    new URL(CFG.redirectUri, window.location.origin).toString()
  )
  body.set('code_verifier', verifier)

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error('Token exchange failed')

  const data = await res.json()
  const now = Math.floor(Date.now() / 1000)
  const token = {
    access_token: data.access_token as string,
    token_type: data.token_type as string,
    expires_in: data.expires_in as number,
    expires_at: now + (data.expires_in as number),
    refresh_token: (data.refresh_token as string) || undefined,
    scope: (data.scope as string) || '',
  }
  localStorage.setItem('spotify_token', JSON.stringify(token))
  return token
}

/**
 * Hent gyldig access token fra localStorage.
 * Returnerer null hvis utløpt (UI kan da be om ny innlogging).
 */
export function getAccessToken(): string | null {
  const raw = localStorage.getItem('spotify_token')
  if (!raw) return null
  const t = JSON.parse(raw)
  if (t.expires_at - 60 < Math.floor(Date.now() / 1000)) return null
  return t.access_token as string
}

/** Logg ut lokalt (fjern token) */
export function logout() {
  localStorage.removeItem('spotify_token')
}
