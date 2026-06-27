import { GoogleAuth } from 'google-auth-library'
import { supabase } from './supabase.js'

let auth: GoogleAuth | null = null

function getAuth(): GoogleAuth {
  if (!auth) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set')
    const sa = JSON.parse(raw)
    auth = new GoogleAuth({
      credentials: sa,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    })
  }
  return auth
}

export async function sendPush(userId: string, title: string, body: string, data?: Record<string, string>) {
  const { data: tokens, error } = await supabase
    .from('device_tokens')
    .select('token')
    .eq('user_id', userId)

  if (error || !tokens?.length) return

  let accessToken: string
  try {
    const client = await getAuth().getClient()
    const token = await client.getAccessToken()
    if (!token?.token) return
    accessToken = token.token
  } catch (err) {
    console.error('Failed to get FCM access token:', err)
    return
  }

  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)
  const project = sa.project_id

  for (const { token } of tokens) {
    try {
      const msg = {
        message: {
          token,
          notification: { title, body },
          ...(data ? { data } : {}),
        },
      }
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(msg),
      })
      if (res.status === 404 || res.status === 410) {
        await supabase.from('device_tokens').delete().eq('token', token)
      } else if (!res.ok) {
        const errText = await res.text()
        console.error(`FCM error for ${token}:`, errText)
      }
    } catch (err) {
      console.error('FCM send error:', err)
    }
  }
}
