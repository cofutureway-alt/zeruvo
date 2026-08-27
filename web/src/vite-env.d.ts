/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_SUPABASE_URL: string;
	readonly VITE_SUPABASE_ANON_KEY: string;
	/** Gateway base URL, e.g. https://api.zeruvo.online. Falls back to that host when unset. */
	readonly VITE_GATEWAY_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
