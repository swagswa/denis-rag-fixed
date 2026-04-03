import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kuodvlyepoojqimutmvu.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1b2R2bHllcG9vanFpbXV0bXZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjIxNjcsImV4cCI6MjA4OTMzODE2N30.vev0KKWj7TUmm5syUL05xgcjKY-BrpyYIrTlojuFMDQ'

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
