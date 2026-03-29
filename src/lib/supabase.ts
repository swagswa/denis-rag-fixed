import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL || 'https://kuodvlyepoojqimutmvu.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS',
)
