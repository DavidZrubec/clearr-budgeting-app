import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabase } from './_lib/supabase.js'
import { sendPush } from './_lib/notify.js'
import { verifyCronRequest } from './_lib/auth.js'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (!verifyCronRequest(_req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('*')

    if (!prefs || prefs.length === 0) {
      return res.json({ ok: true, alerts: 0 })
    }

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
    let alertsSent = 0

    for (const pref of prefs) {
      if (!pref.notifications) continue

      const { data: txns } = await supabase
        .from('transactions')
        .select('amount,budget_category')
        .eq('user_id', pref.user_id)
        .gte('date', monthStart)
        .lte('date', monthEnd)
        .eq('type', 'Expense')

      if (!txns) continue

      const spent: Record<string, number> = {}
      for (const t of txns) {
        const cat = t.budget_category || 'Wants'
        spent[cat] = (spent[cat] || 0) + Math.abs(t.amount)
      }

      const targets = (pref.budget_targets as Record<string, number>) || {}
      const tolerance = pref.budget_tolerance || 10

      for (const [cat, targetPercent] of Object.entries(targets)) {
        const targetAmount = (pref.monthly_income || 1) * (targetPercent as number) / 100
        const actual = spent[cat] || 0

        if (actual >= targetAmount * (1 + tolerance / 100)) {
          await sendPush(
            pref.user_id,
            `⚠️ Over budget: ${cat}`,
            `You've spent ${fmtCurrency(actual)} in ${cat} (budget: ${fmtCurrency(targetAmount)})`,
          )
          alertsSent++
        } else if (actual >= targetAmount * 0.9) {
          await sendPush(
            pref.user_id,
            `📊 Nearing limit: ${cat}`,
            `You've used ${Math.round((actual / targetAmount) * 100)}% of your ${cat} budget`,
          )
          alertsSent++
        }
      }
    }

    res.json({ ok: true, alerts: alertsSent })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal error' })
  }
}

function fmtCurrency(n: number): string {
  return '€' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
