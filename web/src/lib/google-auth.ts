// Google sign-in via Firebase → Supabase.
// The Firebase web config comes from app_settings (admin-configurable).
// The SDK is dynamically imported so it never loads for users who don't
// click the Google button.
import type { FirebaseConfig } from '../hooks/useAppSettings';
import { supabase } from './supabase';

export async function signInWithGoogle(cfg: FirebaseConfig): Promise<{ error?: string }> {
  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
    return { error: 'Google sign-in is not configured yet.' };
  }
  try {
    const [{ initializeApp, getApps, getApp }, { getAuth, GoogleAuthProvider, signInWithPopup }] =
      await Promise.all([import('firebase/app'), import('firebase/auth')]);

    const app = getApps().length ? getApp() : initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain || undefined,
      projectId: cfg.projectId,
      storageBucket: cfg.storageBucket || undefined,
      messagingSenderId: cfg.messagingSenderId || undefined,
      appId: cfg.appId,
    });
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const cred = await signInWithPopup(auth, provider);
    const idToken = await cred.user.getIdToken(true);

    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // common, user-actionable Firebase codes → friendlier copy
    if (/auth\/unauthorized-domain/i.test(msg)) {
      return { error: 'This domain is not authorized in the Firebase project (Authentication → Settings → Authorized domains).' };
    }
    if (/auth\/popup-closed|auth\/cancelled-popup/i.test(msg)) {
      return { error: 'Google sign-in was cancelled.' };
    }
    return { error: msg };
  }
}
