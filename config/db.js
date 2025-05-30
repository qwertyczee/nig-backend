const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load .env from backend directory, relative to this file (backend/src/config -> backend/.env)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  console.error('Current directory for db.ts:', __dirname);
  console.error('Attempted .env path:', path.resolve(__dirname, '../../.env'));
  console.error('SUPABASE_URL:', supabaseUrl);
  console.error('SUPABASE_ANON_KEY:', supabaseAnonKey);
  console.error('SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceRoleKey ? 'Loaded' : 'Not Loaded');
  throw new Error('Supabase URL, Anon Key, or Service Role Key is not defined. Check your .env file in the backend directory and its loading path.');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = {
    supabase,
    supabaseServiceRoleKey
};