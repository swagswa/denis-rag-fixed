import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const SUPABASE_URL = 'https://kuodvlyepoojqimutmvu.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS'

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
