// src/views/Host.tsx
import React from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { createWebPlayer } from '../spotify/player'
import { SpotifyAPI } from '../spotify/api'
import { getAccessToken } from '../auth/spotifyAuth'
import { db } from '../firebase/init'
import { ref, set } from 'firebase/database'

const TEST_TRACK = '11dFghVXANMlKmJXsNCbNl'
const PAGE_SIZE = 50
const QUESTIONS = 15

type SimplePlaylist = {
  id: string
  name: string
  tracksTotal: number
  owner?: string
}

type RoundQ = {
  id: string
  uri: string
  name: string
  artistNames: string[]
  duration_ms: number
}

function normalizeArtist(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(the\s+)/, '')
    .replace(/\s*&\s*|\s*and\s*/g, ' ')
    .replace(/\b(feat\.|featuring|ft\.)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function Host() {
  const [search] = useSearchParams()
  const nav = useNavigate()
  const room = search.get('room') || 'EDPN-quiz'

  const playerUrl = React.useMemo(
    () => `${window.location.origin}/player?room=${encodeURIComponent(room)}`,
    [room]
  )
  const [copyMsg, setCopyMsg] = React.useState('')
  const [showQR, setShowQR] = React.useState(false)

  function copyLink() {
    navigator.clipboard.writeText(playerUrl)
      .then(() => setCopyMsg('Lenke kopiert!'))
      .catch(() => setCopyMsg('Kunne ikke kopiere'))
    setTimeout(() => setCopyMsg(''), 2000)
  }

  async function shareLink() {
    const navAny = navigator as any
    if (navAny.share) {
      try {
        await navAny.share({
          title: 'Bli med i musikkquiz',
          text: 'Trykk for å bli med som spiller',
          url: playerUrl,
        })
        return
      } catch {}
    }
    copyLink()
  }

  const [hostName, setHostName] = React.useState('Vert')

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
      setSelected(new Set())
      const url = new URL('https://api.spotify.com/v1/me/playlists')
      url.searchParams.set('limit', String(PAGE_SIZE))
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

  const [building, setBuilding] = React.useState(false)
  const [built, setBuilt] = React.useState<RoundQ[] | null>(null)
  const [buildMsg, setBuildMsg] = React.useState<string>('')
  const [showFasit, setShowFasit] = React.useState(false)

  async function fetchPlaylistTracksAll(playlistId: string): Promise<RoundQ[]> {
    const out: RoundQ[] = []
    let offset = 0
    const limit = 100
    while (true) {
      const page = await SpotifyAPI.getPlaylistTracks(playlistId, limit, offset)
      const items = (page.items || []) as any[]
      for (const it of items) {
        const t = it.track
        if (!t || t.type !== 'track') continue
        if (!t.id || !t.uri) continue
        const artistNames = (t.artists || []).map((a: any) => a.name).filter(Boolean)
        out.push({
          id: t.id,
          uri: t.uri,
          name: t.name,
          artistNames,
          duration_ms: t.duration_ms || 0,
        })
      }
      if (!page.next) break
      offset += limit
    }
    return out
  }

  async function buildRound() {
    if (selected.size === 0) {
      setBuildMsg('Velg minst én spilleliste først')
      return
    }
    try {
      setBuilding(true)
      setShowFasit(false)
      setBuildMsg('Henter spor fra valgte spillelister…')
      const all: RoundQ[] = []
      const seenTrack = new Set<string>()
      const ids = Array.from(selected)

      for (let i = 0; i < ids.length; i++) {
        const pid = ids[i]
        setBuildMsg(`Henter fra liste ${i + 1}/${ids.length}…`)
        const tracks = await fetchPlaylistTracksAll(pid)
        for (const t of tracks) {
          if (seenTrack.has(t.id)) continue
          seenTrack.add(t.id)
          all.push(t)
        }
      }

      if (all.length === 0) {
        setBuildMsg('Fant ingen spor i de valgte listene')
        setBuilt(null)
        return
      }

      const shuffled = shuffle(all)
      const usedArtists = new Set<string>()
      const picked: RoundQ[] = []

      for (const t of shuffled) {
        const normalizedSet = new Set(t.artistNames.map(normalizeArtist))
        let clash = false
        for (const a of normalizedSet) {
          if (usedArtists.has(a)) { clash = true; break }
        }
        if (!clash) {
          for (const a of normalizedSet) usedArtists.add(a)
          picked.push(t)
          if (picked.length >= QUESTIONS) break
        }
      }

      setBuilt(picked)
      setBuildMsg(`Runde klar: ${picked.length} spørsmål (unik artist-regel).`)

      const roundPayload = {
        createdAt: Date.now(),
        room,
        selectedPlaylists: ids,
        totalCandidates: all.length,
        questions: picked,
      }

      // 🔥 LAGRE i Firebase
      await set(ref(db, `rooms/${room}/round`), roundPayload)

      // behold også lokalt som fallback
      sessionStorage.setItem('edpn_round', JSON.stringify(roundPayload))
    } catch (e: any) {
      setBuilt(null)
      setBuildMsg('Feil ved bygging: ' + (e?.message || 'ukjent feil'))
    } finally {
      setBuilding(false)
    }
  }

  function goToGame() {
    nav('/game')
  }

  function revealFasit3s() {
    setShowFasit(true)
    setTimeout(() => setShowFasit(false), 3000)
  }

  return (
    <div className="card vstack">
      <h2>Vertspanel</h2>
      <div>Rom: <span className="badge">{room}</span></div>

      {/* resten av UI uendret */}
    </div>
  )
}
