import { distance as levenshtein } from './util_levenshtein'
function normalizeArtist(s:string):string{
  let x=s.toLowerCase().trim(); x=x.normalize('NFD').replace(/\p{Diacritic}+/gu,'')
  x=x.replace(/^(the\s+)/,''); x=x.replace(/\s*&\s*|\s*and\s*/g,' '); x=x.replace(/feat\.|featuring|ft\./g,'')
  x=x.replace(/\s+/g,' '); return x
}
const ALIAS:Record<string,string>={ 'gnr':'guns n roses','mj':'michael jackson','t-swift':'taylor swift' }
export function isArtistMatch(answer:string, candidates:string[], threshold=0.85):boolean{
  const ans=normalizeArtist(ALIAS[answer.toLowerCase()]||answer)
  for(const cand of candidates){ const norm=normalizeArtist(cand); if(norm===ans) return true
    const maxLen=Math.max(norm.length,ans.length); const dist=levenshtein(norm,ans); const sim=1 - dist/maxLen
    if(sim>=threshold) return true
  } return false
}