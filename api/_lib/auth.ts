import type { VercelRequest } from '@vercel/node'
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyCronRequest(req: VercelRequest): boolean {
  return req.headers['x-vercel-cron'] === '1'
}

export async function verifySupabaseWebhook(req: VercelRequest, secret: string): Promise<boolean> {
  const signature = req.headers['x-supabase-webhook-signature'] as string
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  if (!signature || !secret) return false

  const expected = createHmac('sha256', secret).update(body).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}
