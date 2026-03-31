import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Always use the original Supabase project (not Lovable Cloud)
const SUPABASE_URL = 'https://kuodvlyepoojqimutmvu.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1b2R2bHllcG9vanFpbXV0bXZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMjQ5NjEsImV4cCI6MjA1ODYwMDk2MX0.ORPSyMmuVHyBxnnBHoWjnhJeRzIbFOMTAIi_MZhCvfo'

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
