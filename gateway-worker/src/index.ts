/**
 * Nexor AI Gateway — Cloudflare Worker
 * Unified AI gateway hot path: /v1/chat/completions (OpenAI), /v1/messages
 * (Anthropic), /v1beta/models/{m}:generateContent (Gemini), GET /v1/models.
 *
 * Phase 2 will fill in auth/quota/adapters/stream modules. This placeholder
 * proves deployment wiring end-to-end.
 */

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/health") {
			return Response.json({ ok: true, service: "nexor-gateway" });
		}
		return Response.json(
			{ error: { type: "not_found", message: `No route for ${url.pathname}` } },
			{ status: 404 },
		);
	},
};

export interface Env {
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY?: string;
	NEXOR_ENCRYPTION_KEY?: string;
}
