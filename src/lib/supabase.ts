import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Always use the original Supabase project — NOT Lovable Cloud
const SUPABASE_URL = 'https://kuodvlyepoojqimutmvu.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS'

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
