/**
 * Provider adapters — translate the three wire formats into a neutral
 * internal shape, and translate responses/chunks back.
 *
 * Internal neutral request: { model, messages[], system?, max_tokens, temperature?,
 * stream, tools? } with content blocks as plain strings or typed parts.
 *
 * v1 scope per plan: text chat + tool passthrough for the three formats.
 */

// ---------- neutral shapes ----------
export interface NeutralMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | Part[];
	name?: string;
	tool_call_id?: string;
	tool_calls?: ToolCall[]; // assistant-issued calls (OpenAI shape)
}
export type Part =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } }
	| { type: 'image'; source: { type: string; media_type?: string; data?: string; url?: string } }
	| { type: 'inline_data'; mime_type: string; data: string }
	| { type: 'tool_result'; tool_use_id?: string; content?: unknown };

export interface ToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface NeutralTool {
	type: 'function';
	function: { name: string; description?: string; parameters?: unknown };
}

export interface NeutralRequest {
	model: string; // upstream_model_id as requested by client
	messages: NeutralMessage[];
	max_tokens: number;
	temperature?: number;
	top_p?: number;
	stream: boolean;
	tools?: NeutralTool[];
	stop?: string[];
}

// ---------- OpenAI (also serves Custom/OpenRouter providers) ----------
export function fromOpenAI(body: Record<string, unknown>): NeutralRequest {
	const msgs = (body.messages as NeutralMessage[]) ?? [];
	return {
		model: String(body.model ?? ''),
		messages: msgs,
		max_tokens:
			typeof body.max_completion_tokens === 'number'
				? body.max_completion_tokens
				: typeof body.max_tokens === 'number'
					? body.max_tokens
					: 1024,
		temperature: body.temperature as number | undefined,
		top_p: body.top_p as number | undefined,
		stream: Boolean(body.stream),
		tools: body.tools as NeutralTool[] | undefined,
		stop: body.stop as string[] | undefined,
	};
}

/** OpenAI accepts the neutral shape directly (it IS the OpenAI wire). */
export function toOpenAI(req: NeutralRequest): Record<string, unknown> {
	const out: Record<string, unknown> = {
		model: req.model,
		messages: req.messages,
		max_tokens: req.max_tokens,
		stream: req.stream,
	};
	if (req.temperature != null) out.temperature = req.temperature;
	if (req.top_p != null) out.top_p = req.top_p;
	if (req.tools?.length) out.tools = req.tools;
	if (req.stop?.length) out.stop = req.stop;
	return out;
}

// ---------- Anthropic ----------
export function toAnthropic(req: NeutralRequest): Record<string, unknown> {
	let system: string | undefined;
	const msgs: Array<Record<string, unknown>> = [];

	for (const m of req.messages) {
		if (m.role === 'system') {
			system = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
			continue;
		}
		if (m.role === 'assistant' && m.tool_calls?.length) {
			msgs.push({
				role: 'assistant',
				content: m.tool_calls.map((tc) => ({
					type: 'tool_use',
					id: tc.id,
					name: tc.function.name,
					input: safeJson(tc.function.arguments),
				})),
			});
			continue;
		}
		if (m.role === 'tool') {
			// Anthropic wants tool results inside a user turn
			msgs.push({
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: m.tool_call_id,
						content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
					},
				],
			});
			continue;
		}
		msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
	}

	const out: Record<string, unknown> = {
		model: req.model,
		max_tokens: req.max_tokens,
		messages: msgs,
	};
	if (system) out.system = system;
	if (req.temperature != null) out.temperature = Math.max(0, Math.min(1, req.temperature));
	if (req.top_p != null) out.top_p = req.top_p;
	if (req.stream) out.stream = true;
	if (req.stop?.length) out.stop_sequences = req.stop.slice(0, 4);
	if (req.tools?.length) {
		out.tools = req.tools.map((t) => ({
			name: t.function.name,
			description: t.function.description,
			input_schema: t.function.parameters ?? { type: 'object', properties: {} },
		}));
		out.tool_choice = { type: 'auto' };
	}
	return out;
}

// ---------- Gemini ----------
export function toGemini(req: NeutralRequest): Record<string, unknown> {
	const contents: Array<Record<string, unknown>> = [];
	let systemText: string | undefined;

	for (const m of req.messages) {
		if (m.role === 'system') {
			systemText = typeof m.content === 'string' ? m.content : undefined;
			continue;
		}
		if (m.role === 'tool') {
			contents.push({
				role: 'function',
				parts: [
					{
						functionResponse: {
							name: m.name ?? 'function',
							response: { result: m.content },
						},
					},
				],
			});
			continue;
		}
		const role = m.role === 'assistant' ? 'model' : 'user';
		if (m.role === 'assistant' && m.tool_calls?.length) {
			contents.push({
				role: 'model',
				parts: m.tool_calls.map((tc) => ({
					functionCall: { name: tc.function.name, args: safeJson(tc.function.arguments) },
				})),
			});
			continue;
		}
		const parts: Array<Record<string, unknown>> = [];
		if (typeof m.content === 'string') {
			parts.push({ text: m.content });
		} else if (Array.isArray(m.content)) {
			for (const p of m.content as Part[]) {
				if (p.type === 'text') parts.push({ text: p.text });
				else if (p.type === 'inline_data')
					parts.push({ inlineData: { mimeType: p.mime_type, data: p.data } });
				else if (p.type === 'image_url') parts.push({ text: `[image: ${p.image_url.url}]` }); // v1: url images noted
			}
		}
		if (parts.length) contents.push({ role, parts });
	}

	const out: Record<string, unknown> = {
		contents,
		generationConfig: {
			maxOutputTokens: req.max_tokens,
			...(req.temperature != null ? { temperature: req.temperature } : {}),
			...(req.top_p != null ? { topP: req.top_p } : {}),
			...(req.stop?.length ? { stopSequences: req.stop } : {}),
		},
	};
	if (systemText) out.systemInstruction = { parts: [{ text: systemText }] };
	if (req.tools?.length) {
		out.tools = [
			{
				functionDeclarations: req.tools.map((t) => ({
					name: t.function.name,
					description: t.function.description,
					parameters: t.function.parameters ?? { type: 'object', properties: {} },
				})),
			},
		];
		out.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
	}
	return out;
}

function safeJson(s: string): unknown {
	try {
		return JSON.parse(s || '{}');
	} catch {
		return {};
	}
}
