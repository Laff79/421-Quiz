import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { CFG } from '../config'
const app = initializeApp(CFG.firebase)
export const db = getDatabase(app)
export const auth = getAuth(app)
export async function ensureAnonAuth(): Promise<string> {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) resolve(user.uid)
      else { try { const cred = await signInAnonymously(auth); resolve(cred.user.uid) } catch(e){ reject(e) } }
    })
  })
}