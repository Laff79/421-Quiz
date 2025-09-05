function base64UrlEncode(bytes: Uint8Array): string {
  let str=btoa(String.fromCharCode(...bytes)); return str.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
export async function sha256(input: string): Promise<string> {
  const data=new TextEncoder().encode(input); const hash=await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(hash))
}
export function randomString(len=64): string {
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'; let out=''
  const rnds=new Uint32Array(len); crypto.getRandomValues(rnds); for (let i=0;i<len;i++) out+=chars[rnds[i]%chars.length]; return out
}