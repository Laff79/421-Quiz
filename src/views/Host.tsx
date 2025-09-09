// src/views/Host.tsx
import React from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { createWebPlayer } from '../spotify/player'
import { SpotifyAPI } from '../spotify/api'
import { getAccessToken } from '../auth/spotifyAuth'
import { db } from '../firebase/init'
import { ref, set } from 'firebase/database'

// ... resten av koden uendret ...

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

      // Randomiser og plukk maks én pr artist
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

// ... resten av filen uendret ...
