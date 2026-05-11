import { createClient } from '@supabase/supabase-js';

// Auth lives in batleyGPT (OAuth providers configured there)
export const authSb = createClient(
  'https://spndhzwlavoxammqafpn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwbmRoendsYXZveGFtbXFhZnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjg3NjYsImV4cCI6MjA5MTYwNDc2Nn0.R_jNFKBRakymXKnajZmkY4R0Fw2QnBbcEUPwuIAQQBg'
);

// Data lives in democheckin
export const dataSb = createClient(
  'https://syugdirgamxvkajbkkfq.supabase.co',
  'sb_publishable_QnvnZvDIBIKjBQ3EygpZKQ_Q603UgCF'
);
