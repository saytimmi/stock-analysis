import { createClient } from '@supabase/supabase-js';

export const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);
