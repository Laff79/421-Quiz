import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { createWebPlayer } from '../spotify/player'
import { SpotifyAPI } from '../spotify/api'
import { getAccessToken } from '../auth/spotifyAuth'

const TEST_TRACK = '11dFghVXANMlKmJXsNCbNl' // Spotify demo-låt
const PAGE_SIZE = 200
const PLAYLIST_FIELDS =
  'items(id,name,owner(display_name,id),tracks(total)),next,total'

type SimplePlaylist = {
  id: string
  name: string
  tracksTotal: number
  owner?: string
}

export default function Host() {
  const [search] = useSearchParams()
  const room = search.get('room') || 'EDPN-quiz'

  // --- Lydtest ---
  const [deviceId, setDeviceId] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string>('Klar')

  async function initPlayer() {
    try {
      setStatus('Starter nettleser-spiller…')
      const { deviceId: id } = await createWebPlayer('EDPN Quiz Player')
      setDeviceId(id)
      setStatus(`Spiller klar (device: ${id}). Overfører…`)
      await SpotifyAPI.transferPlayback(id)
      setStatus('Overført til nettleser-enheten 👍')
    } catch (e: any) {
      setStatus('Feil ved oppstart: ' + e?.message)
    }
  }

  async function playTest() {
    try {
      if (!deviceId) {
        setStatus('Ingen enhet – trykk “Start nettleser-spiller” først')
        return
      }
      setStatus('Spiller testsang…')
      await SpotifyAPI.play({ uris: [`spotify:track:${TEST_TRACK}`] })
      setStatus('Spiller 🎵')
    } catch (e: any) {
      setStatus('Feil ved avspilling: ' + e?.message)
    }
  }

  async function pauseTest() {
    try {
      await SpotifyAPI.pause()
      setStatus('Pauset ⏸')
    } catch (e: any) {
      setStatus('Feil ved pause: ' + e?.message)
    }
  }

  // --- Spilleliste-velger (lazy paging + søk + vis flere) ---
  const [loadingPl, setLoadingPl] = React.useState(false)
  const [playlists, setPlaylists] = React.useState<SimplePlaylist[]>([])
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [plError, setPlError] = React.useState<string | null>(null)
  const [nextUrl, setNextUrl] = React.useState<string | null>(null)
  const [q, setQ] = React.useState('')

  function toSimple(items: any[]): SimplePlaylist[] {
    return (items || []).map((p: any) => ({
      id: p.id,
      name: p.name as string,
      tracksTotal: p.tracks?.total ?? 0,
      owner: p.owner?.display_name || p.owner?.id,
    }))
  }

  async function fetchPage(url: string) {
    const token = getAccessToken()
    if (!token) throw new Error('Ikke innlogget på Spotify')
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // Enkel 429-håndtering
    if (res.status === 429) {
      const wait = parseInt(res.headers.get('Retry-After') || '2', 10) * 1000
      await new Promise((r) => setTimeout(r, wait))
      return fetchPage(url)
    }
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Spotify API-feil (${res.status}): ${txt}`)
    }
    return res.json()
  }

  async function loadPlaylistsFirst() {
    try {
      setPlError(null)
      setLoadingPl(true)
      setPlaylists([])
      const url = new URL('https://api.spotify.com/v1/me/playlists')
      url.searchParams.set('limit', String(PAGE_SIZE))
      url.searchParams.set('fields', PLAYLIST_FIELDS)
      const page = await fetchPage(url.toString())
      setPlaylists(toSimple(page.items))
      setNextUrl(page.next || null)
    } catch (e: any) {
      setPlError(e?.message || 'Kunne ikke hente spillelister')
    } finally {
      setLoadingPl(false)
    }
  }

  async function loadMore() {
    if (!nextUrl) return
    try {
      setLoadingPl(true)
      const page = await fetchPage(nextUrl)
      setPlaylists((prev) => [...prev, ...toSimple(page.items)])
      setNextUrl(page.next || null)
    } catch (e: any) {
      setPlError(e?.message || 'Kunne ikke hente flere')
    } finally {
      setLoadingPl(false)
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  const filtered = React.useMemo(() => {
    if (!q.trim()) return playlists
    const qq = q.toLowerCase()
    return playlists.filter(
      (p) =>
        p.name.toLowerCase().includes(qq) ||
        (p.owner || '').toLowerCase().includes(qq)
    )
  }, [playlists, q])

  return (
    <div className="card vstack">
      <h2>Vertspanel</h2>
      <div>
        Rom: <span className="badge">{room}</span>
      </div>

      <hr />

      {/* Lydtest */}
      <div className="vstack">
        <strong>Lydtest</strong>
        <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="primary" onClick={initPlayer}>
            Start nettleser-spiller
          </button>
          <button className="ghost" onClick={playTest}>
            Spill testsang
          </button>
          <button className="ghost" onClick={pauseTest}>
            Pause
          </button>
        </div>
        <small className="badge">{status}</small>
      </div>

      <hr />

      {/* Spilleliste-velger */}
      <div className="vstack">
        <strong>Spilleliste-velger</strong>

        <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            className="primary"
            onClick={loadPlaylistsFirst}
            disabled={loadingPl}
          >
            {loadingPl ? 'Henter…' : 'Hent spillelister'}
          </button>
          <input
            placeholder="Søk navn/eier…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 200 }}
          />
          <span className="badge">
            {filtered.length}/{playlists.length} vist • {selected.size} valgt
          </span>
        </div>

        {plError && (
          <small className="badge" style={{ color: '#b00020' }}>
            {plError}
          </small>
        )}

        {playlists.length > 0 && (
          <>
            <div
              className="vstack"
              style={{
                maxHeight: 360,
                overflow: 'auto',
                border: '1px solid #eee',
                borderRadius: 12,
                padding: 8,
              }}
            >
              {filtered.map((pl) => (
                <label
                  key={pl.id}
                  className="hstack"
                  style={{
                    justifyContent: 'space-between',
                    padding: '6px 4px',
                  }}
                >
                  <div className="hstack" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={selected.has(pl.id)}
                      onChange={() => toggleSelect(pl.id)}
                    />
                    <div>
                      <div style={{ fontWeight: 600 }}>{pl.name}</div>
                      <small className="muted">
                        {pl.tracksTotal} spor • {pl.owner || 'ukjent eier'}
                      </small>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="hstack" style={{ gap: 8, marginTop: 8 }}>
              <button
                className="ghost"
                onClick={loadMore}
                disabled={loadingPl || !nextUrl}
                title={nextUrl ? '' : 'Ingen flere'}
              >
                {nextUrl ? 'Vis flere' : 'Ingen flere'}
              </button>

              <button className="ghost" disabled={selected.size === 0}>
                Bygg runde (kommer i neste trinn)
              </button>
            </div>
          </>
        )}
      </div>

      <hr />

      <ul>
        <li>Filtrer explicit (toggle) – kommer</li>
        <li>Start runde (15 spm, tilfeldig trekk, maks 1 pr artist) – kommer</li>
      </ul>
    </div>
  )
}
