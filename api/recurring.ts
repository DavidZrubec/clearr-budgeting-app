import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabase } from './_lib/supabase.js'
import { verifyCronRequest } from './_lib/auth.js'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (!verifyCronRequest(_req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { data: recurring } = await supabase
      .from('transactions')
      .select('*')
      .eq('is_recurring', true)

    if (!recurring || recurring.length === 0) {
      return res.json({ ok: true, processed: 0 })
    }

    const byUser: Record<string, typeof recurring> = {}
    for (const tx of recurring) {
      if (!byUser[tx.user_id]) byUser[tx.user_id] = []
      byUser[tx.user_id].push(tx)
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let totalCreated = 0
    const intervalDays: Record<string, number> = { weekly: 7, monthly: 30, yearly: 365 }

    for (const [userId, txs] of Object.entries(byUser)) {
      const { data: existing } = await supabase
        .from('transactions')
        .select('date,name,amount')
        .eq('user_id', userId)

      const existingKeys = new Set((existing || []).map(t => `${t.date}_${t.name}_${t.amount}`))

      for (const tx of txs) {
        const days = intervalDays[tx.recurring_interval!]
        if (!days) continue

        const txDate = new Date(tx.date + 'T12:00:00')
        const diffDays = Math.floor((today.getTime() - txDate.getTime()) / 86400000)
        const intervalsToCatch = Math.min(Math.floor(diffDays / days), 12)

        const toCreate: Record<string, any>[] = []
        for (let i = 1; i <= intervalsToCatch; i++) {
          const d = new Date(txDate.getTime() + i * days * 86400000)
          const dateStr = d.toISOString().slice(0, 10)
          const key = `${dateStr}_${tx.name}_${tx.amount}`
          if (!existingKeys.has(key)) {
            toCreate.push({
              user_id: userId,
              name: tx.name,
              merchant: tx.merchant,
              category: tx.category,
              budget_category: tx.budget_category,
              amount: tx.amount,
              type: tx.type,
              time: tx.time,
              date: dateStr,
              payment_source: tx.payment_source,
              notes: tx.notes,
              tags: tx.tags || [],
              is_excluded: tx.is_excluded,
              is_recurring: tx.is_recurring,
              recurring_interval: tx.recurring_interval,
              receipt_url: null,
            })
          }
        }

        if (toCreate.length > 0) {
          const { error } = await supabase.from('transactions').insert(toCreate)
          if (!error) totalCreated += toCreate.length
        }
      }
    }

    res.json({ ok: true, processed: totalCreated })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal error' })
  }
}
