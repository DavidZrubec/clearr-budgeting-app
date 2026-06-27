import { createClient } from '@supabase/supabase-js'
import { Preferences } from '@capacitor/preferences'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function getKey() {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode('com.clearr.budget.app-v1'),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('clearr-budget-salt-2026'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encrypt(plaintext) {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  )
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return btoa(String.fromCharCode(...combined))
}

async function decrypt(data) {
  const key = await getKey()
  const combined = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  )
  return decoder.decode(plaintext)
}

const encryptedStorage = {
  getItem: async (key) => {
    try {
      const { value } = await Preferences.get({ key })
      if (!value) return null
      return await decrypt(value)
    } catch {
      const { value } = await Preferences.get({ key })
      return value ?? null
    }
  },
  setItem: async (key, value) => {
    try {
      const encrypted = await encrypt(value)
      await Preferences.set({ key, value: encrypted })
    } catch {
      await Preferences.set({ key, value })
    }
  },
  removeItem: async (key) => {
    await Preferences.remove({ key })
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    autoRefreshToken: true,
    persistSession: true,
    storage: encryptedStorage,
  },
})
