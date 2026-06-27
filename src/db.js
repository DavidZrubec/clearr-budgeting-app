import { supabase } from './supabase.js'

export function mapTx(row) {
  return {
    id: row.id,
    name: row.name || '',
    merchant: row.merchant || '',
    category: row.category || 'Other',
    budgetCategory: row.budget_category || 'Needs',
    amount: Number(row.amount) || 0,
    type: row.type || 'Expense',
    time: row.time || '12:00 PM',
    date: row.date || new Date().toISOString().slice(0, 10),
    paymentSource: row.payment_source || 'Revolut',
    notes: row.notes || '',
    tags: row.tags || [],
    isExcluded: row.is_excluded || false,
    isRecurring: row.is_recurring || false,
    recurringInterval: row.recurring_interval || null,
    receiptUrl: row.receipt_url || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  }
}

export function mapPrefs(row) {
  return {
    currency: row.currency || 'INR',
    darkMode: typeof row.dark_mode === 'boolean' ? row.dark_mode : false,
    notifications: typeof row.notifications === 'boolean' ? row.notifications : true,
    bankSync: typeof row.bank_sync === 'boolean' ? row.bank_sync : false,
    budgetTargets: row.budget_targets || { needs: 50, wants: 30, investments: 20 },
    budgetTolerance: typeof row.budget_tolerance === 'number' ? row.budget_tolerance : 10,
    defaultPaymentSource: row.default_payment_source || 'Revolut',
    defaultBudgetCategory: row.default_budget_category || 'Needs',
    monthlyIncome: Number(row.monthly_income) || 0,
    filterMaxAmount: Number(row.filter_max_amount) || 100000,
    holdHintShown: typeof row.hold_hint_shown === 'boolean' ? row.hold_hint_shown : false,
  }
}

export function txToRow(tx, userId) {
  return {
    user_id: userId,
    name: tx.name,
    merchant: tx.merchant || null,
    category: tx.category,
    budget_category: tx.budgetCategory,
    amount: tx.amount,
    type: tx.type,
    time: tx.time || '12:00 PM',
    date: tx.date,
    payment_source: tx.paymentSource || null,
    notes: tx.notes || null,
    tags: tx.tags || [],
    is_excluded: tx.isExcluded || false,
    is_recurring: tx.isRecurring || false,
    recurring_interval: tx.recurringInterval || null,
    receipt_url: tx.receiptUrl || null,
  }
}

export function prefsToRow(prefs, userId) {
  return {
    user_id: userId,
    currency: prefs.currency || 'INR',
    dark_mode: prefs.darkMode ?? false,
    notifications: prefs.notifications ?? true,
    bank_sync: prefs.bankSync ?? false,
    budget_targets: prefs.budgetTargets || { needs: 50, wants: 30, investments: 20 },
    budget_tolerance: prefs.budgetTolerance ?? 10,
    default_payment_source: prefs.defaultPaymentSource || null,
    default_budget_category: prefs.defaultBudgetCategory || null,
    monthly_income: prefs.monthlyIncome || 0,
    filter_max_amount: prefs.filterMaxAmount || 100000,
    hold_hint_shown: prefs.holdHintShown ?? false,
  }
}

export async function loadTransactions(userId) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(mapTx)
}

export function subscribeTransactions(userId, onData, onChange) {
  const channel = supabase
    .channel(`tx-${userId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          onChange('inserted', mapTx(payload.new))
        } else if (payload.eventType === 'UPDATE') {
          onChange('updated', mapTx(payload.new))
        } else if (payload.eventType === 'DELETE') {
          onChange('deleted', payload.old.id)
        }
      }
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}

export function subscribePreferences(userId, onChange) {
  const channel = supabase
    .channel(`pref-${userId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${userId}` },
      (payload) => { onChange(mapPrefs(payload.new)) }
    )
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${userId}` },
      (payload) => { onChange(mapPrefs(payload.new)) }
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}

export async function addTransaction(userId, tx) {
  const { data, error } = await supabase
    .from('transactions')
    .insert(txToRow(tx, userId))
    .select()
    .single()
  if (error) throw error
  return mapTx(data)
}

export async function updateTransaction(txId, userId, updates) {
  const row = {}
  if (updates.name !== undefined) row.name = updates.name
  if (updates.merchant !== undefined) row.merchant = updates.merchant
  if (updates.category !== undefined) row.category = updates.category
  if (updates.budgetCategory !== undefined) row.budget_category = updates.budgetCategory
  if (updates.amount !== undefined) row.amount = updates.amount
  if (updates.type !== undefined) row.type = updates.type
  if (updates.time !== undefined) row.time = updates.time
  if (updates.date !== undefined) row.date = updates.date
  if (updates.paymentSource !== undefined) row.payment_source = updates.paymentSource
  if (updates.notes !== undefined) row.notes = updates.notes
  if (updates.tags !== undefined) row.tags = updates.tags
  if (updates.isExcluded !== undefined) row.is_excluded = updates.isExcluded
  if (updates.isRecurring !== undefined) row.is_recurring = updates.isRecurring
  if (updates.recurringInterval !== undefined) row.recurring_interval = updates.recurringInterval
  if (updates.receiptUrl !== undefined) row.receipt_url = updates.receiptUrl
  const { error } = await supabase
    .from('transactions')
    .update(row)
    .eq('id', txId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function deleteTransaction(txId, userId) {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', txId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function bulkInsertTransactions(userId, txs) {
  const { error } = await supabase
    .from('transactions')
    .insert(txs.map(tx => txToRow(tx, userId)))
  if (error) throw error
}

export async function loadPreferences(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data ? mapPrefs(data) : null
}

export async function savePreferences(userId, prefs) {
  const { error } = await supabase
    .from('user_preferences')
    .upsert(prefsToRow(prefs, userId))
  if (error) throw error
}

export async function loadOnboarding(userId) {
  const { data, error } = await supabase
    .from('user_onboarding')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

export async function saveOnboarding(userId, data) {
  const { error } = await supabase
    .from('user_onboarding')
    .upsert({ ...data, user_id: userId })
  if (error) throw error
}

export async function updateProfileName(userId, name) {
  const { error } = await supabase
    .from('user_profiles')
    .upsert({ id: userId, name }, { onConflict: 'id' })
  if (error) throw error
}

export async function addDeviceToken(userId, token, platform = 'web') {
  const { error } = await supabase
    .from('device_tokens')
    .upsert({ user_id: userId, token, platform })
  if (error) { console.error('token save failed:', error) }
}
