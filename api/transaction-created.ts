import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabase } from './_lib/supabase.js'
import { sendPush } from './_lib/notify.js'
import { verifySupabaseWebhook } from './_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!await verifySupabaseWebhook(req, process.env.SUPABASE_WEBHOOK_SECRET || '')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const tx = req.body

    if (!tx || !tx.user_id || tx.type !== 'Expense') {
      return res.json({ ok: true, skipped: true })
    }

    const { data: pref } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', tx.user_id)
      .single()

    if (!pref || !pref.notifications) {
      return res.json({ ok: true, skipped: true })
    }

    const monthlyIncome = pref.monthly_income || 1
    const ratio = Math.abs(tx.amount) / monthlyIncome

    let title: string
    let body: string
    if (ratio >= 0.5) {
      title = `⚠️ Large expense: ${tx.name || 'Transaction'}`
      body = `${fmtCurrency(Math.abs(tx.amount))} — ${Math.round(ratio * 100)}% of monthly income`
    } else if (ratio >= 0.2) {
      title = `📊 Significant expense: ${tx.name || 'Transaction'}`
      body = `${fmtCurrency(Math.abs(tx.amount))} in ${tx.category || 'other'}`
    } else {
      title = `💳 ${tx.name || 'New transaction'}`
      body = `${fmtCurrency(Math.abs(tx.amount))} in ${tx.category || 'other'}`
    }

    await sendPush(tx.user_id, title, body)

    res.json({ ok: true, notified: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal error' })
  }
}

function fmtCurrency(n: number): string {
  return '€' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
