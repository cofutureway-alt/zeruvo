// Site-wide public configuration from app_settings (signup modes, Google
// via Firebase, Turnstile, wallet bounds). One shared fetch for all pages.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface FirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

export interface AppSettings {
  signup_mode: 'email_and_github' | 'github_only' | 'disabled';
  github_min_age_days: number;
  google_auth_enabled: boolean;
  firebase_config: FirebaseConfig;
  turnstile_enabled: boolean;
  turnstile_site_key: string;
  turnstile_on_login: boolean;
  turnstile_on_api_key: boolean;
  wallet_min_topup_usd: number;
  wallet_max_topup_usd: number;
  wallet_quick_amounts: number[];
}

let cache: AppSettings | null = null;
let inflight: Promise<AppSettings> | null = null;

async function fetchSettings(): Promise<AppSettings> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      const s: AppSettings = {
        signup_mode: (data?.signup_mode as AppSettings['signup_mode']) ?? 'email_and_github',
        github_min_age_days: data?.github_min_age_days ?? 0,
        google_auth_enabled: data?.google_auth_enabled ?? false,
        firebase_config: (data?.firebase_config as FirebaseConfig) ?? {},
        turnstile_enabled: data?.turnstile_enabled ?? false,
        turnstile_site_key: data?.turnstile_site_key ?? '',
        turnstile_on_login: data?.turnstile_on_login ?? true,
        turnstile_on_api_key: data?.turnstile_on_api_key ?? false,
        wallet_min_topup_usd: Number(data?.wallet_min_topup_usd ?? 10),
        wallet_max_topup_usd: Number(data?.wallet_max_topup_usd ?? 200),
        wallet_quick_amounts: (data?.wallet_quick_amounts ?? [10, 25, 50, 100, 200]).map(Number),
      };
      cache = s;
      return s;
    })();
  }
  return inflight;
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(cache);
  useEffect(() => {
    if (cache) return;
    void fetchSettings().then(setSettings);
  }, []);
  return settings;
}

/** Invalidate after the admin changes settings. */
export function invalidateAppSettings() {
  cache = null;
}
