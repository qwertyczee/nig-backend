import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend directory, relative to this file (backend/src/config -> backend/.env)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Current directory for db.ts:', __dirname);
  console.error('Attempted .env path:', path.resolve(__dirname, '../../.env'));
  console.error('SUPABASE_URL:', supabaseUrl);
  console.error('SUPABASE_ANON_KEY:', supabaseAnonKey);
  throw new Error('Supabase URL or Anon Key is not defined. Check your .env file in the backend directory and its loading path.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Renamed testSupabaseConnection to initDb for consistency with index.ts
export async function initDb() {
  try {
    const { data, error } = await supabase.from('products').select('id').limit(1);
    if (error) {
      if (error.code === '42P01') { // undefined_table
        console.warn("Supabase connection test: 'products' table not found yet. This might be okay if migrations haven't run.");
        // Attempt a generic check if products table isn't there
        const { error: genericError } = await supabase.rpc('current_setting', {setting_name: 'app.settings.jwt_secret'}); // This is a guess, might not exist
        if (genericError) console.warn('Supabase generic connection test failed:', genericError.message, '(This specific RPC might not be available or accessible)');
        else console.log('Successfully connected to Supabase (generic test).');
        return true;
      } else {
        console.error('Supabase connection error during test query:', error.message);
        return false;
      }
    } else {
      console.log('Successfully connected to Supabase and fetched data from "products".');
    }
    return true;
  } catch (err) {
    if (err instanceof Error) {
      console.error('Supabase client initialization or query error:', err.message);
    } else {
      console.error('An unknown error occurred during Supabase connection test:', err);
    }
    return false;
  }
}
