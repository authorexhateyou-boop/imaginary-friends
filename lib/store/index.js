// Picks the storage backend: Supabase when configured, otherwise the local JSON store.
import { MODE } from '../config.js';

export const { store } = MODE === 'supabase'
  ? await import('./supabase.js')
  : await import('./local.js');
