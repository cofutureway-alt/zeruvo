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
	system?: string;
	max_tokens: number;
	temperature?: number;
	top_p?: number;
	stream: boolean;
	tools?: NeutralTool[];
	stop?: string[];
}

// ---------- OpenAI (also serves Custom/OpenRouter providers) ----------
export function fromOpenAI(body: Record<string, unknown>): NeutralRequest {
	const rawMessages = (body.messages as Array<Record<string, unknown>>) ?? [];

	// hoist any system-role messages into the neutral system slot
	let system: string | undefined;
	const msgs: NeutralMessage[] = [];
	for (const m of rawMessages) {
		if (m.role === 'system') {
			const c = m.content;
			system = (system ? system + '\n' : '') + (typeof c === 'string' ? c : JSON.stringify(c));
			continue;
		}
		msgs.push(m as unknown as NeutralMessage);
	}

	return {
		model: String(body.model ?? ''),
		messages: msgs,
		system,
		max_tokens:
			typeof body.max_completion_tokens === 'number'
				? body.max_completion_tokens
				: typeof body.max_tokens === 'number'
					? body.max_tokens
					: 0,
		temperature: body.temperature as number | undefined,
		top_p: body.top_p as number | undefined,
		stream: Boolean(body.stream),
		tools: body.tools as NeutralTool[] | undefined,
		stop: body.stop as string[] | undefined,
	};
}

/**
 * Anthropic-native wire → neutral. The /v1/messages route receives THIS
 * format, so parsing must honor its top-level `system` field — routing
 * it through fromOpenAI() silently dropped the system prompt.
 */
export function fromAnthropic(body: Record<string, unknown>): NeutralRequest {
	const sys = body.system;
	let system: string | undefined;
	if (typeof sys === 'string') system = sys;
	else if (Array.isArray(sys)) {
		system = sys
			.map((b: { text?: string }) => b?.text ?? '')
			.filter(Boolean)
			.join('\n');
	}

	const rawMsgs = (body.messages as Array<Record<string, unknown>>) ?? [];
	const msgs: NeutralMessage[] = [];
	let toolNameById = new Map<string, string>();

	// first pass to collect tool_use names for result mapping
	for (const m of rawMsgs) {
		const content = m.content;
		if (Array.isArray(content)) {
			for (const part of content as Array<Record<string, unknown>>) {
				if (part.type === 'tool_use') {
					toolNameById.set(String(part.id), String(part.name ?? 'function'));
				}
			}
		}
	}

	for (const m of rawMsgs) {
		const role = m.role as string;
		const content = m.content;

		if (typeof content === 'string') {
			msgs.push({ role: role as NeutralMessage['role'], content });
			continue;
		}
		if (!Array.isArray(content)) continue;

		let textAccum = '';
		const parts: Part[] = [];
		const toolCalls: ToolCall[] = [];

		for (const part of content as Array<Record<string, unknown>>) {
			switch (part.type) {
				case 'text':
					textAccum += (textAccum ? '\n' : '') + String(part.text ?? '');
					break;
				case 'image': {
					const src = part.source as Record<string, unknown> | undefined;
					parts.push({
						type: 'image',
						source: {
							type: String(src?.type ?? 'base64'),
							media_type: src?.media_type as string | undefined,
							data: src?.data as string | undefined,
							url: src?.url as string | undefined,
						},
					});
					break;
				}
				case 'tool_use':
					toolCalls.push({
						id: String(part.id),
						type: 'function',
						function: {
							name: String(part.name),
							arguments: JSON.stringify(part.input ?? {}),
						},
					});
					break;
				case 'tool_result': {
					const rc = part.content;
					const text = typeof rc === 'string'
						? rc
						: Array.isArray(rc)
							? (rc as Array<{ text?: string }>).map((b) => b.text ?? '').join('\n')
							: JSON.stringify(rc ?? '');
					msgs.push({ role: 'tool', tool_call_id: String(part.tool_use_id ?? ''), name: toolNameById.get(String(part.tool_use_id ?? '')), content: text });
					break;
				}
				default:
					break;
			}
		}

		if (toolCalls.length) {
			msgs.push({
				role: 'assistant',
				content: textAccum || (parts.length ? parts : ''),
				tool_calls: toolCalls,
			});
		} else if (parts.length) {
			msgs.push({ role: role as NeutralMessage['role'], content: parts });
		} else if (textAccum) {
			msgs.push({ role: role as NeutralMessage['role'], content: textAccum });
		}
	}

	// 0 = client didn't specify → forward without max_tokens (see toOpenAI)
	const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : 0;
	const tools = (body.tools as Array<Record<string, unknown>> | undefined)?.map((t) => ({
		type: 'function' as const,
		function: {
			name: String(t.name ?? ''),
			description: t.description as string | undefined,
			parameters: t.input_schema ?? { type: 'object', properties: {} },
		},
	}));

	return {
		model: String(body.model ?? ''),
		messages: msgs,
		system,
		max_tokens: maxTokens,
		temperature: body.temperature as number | undefined,
		top_p: body.top_p as number | undefined,
		stream: Boolean(body.stream),
		tools: tools?.length ? tools : undefined,
		stop: body.stop_sequences as string[] | undefined,
	};
}

/**
 * OpenAI accepts the neutral shape directly (it IS the OpenAI wire).
 * max_tokens: agents (Cline, Cursor…) frequently omit it; sending a small
 * default starves reasoning models mid-turn (finish_reason=length →
 * "Model reached the maximum output token limit"). When the client
 * didn't specify one, omit the field entirely and let the provider use
 * its own default — which scales with the model.
 */
export function toOpenAI(req: NeutralRequest): Record<string, unknown> {
	const out: Record<string, unknown> = {
		model: req.model,
		messages: req.messages,
		stream: req.stream,
	};
	if (req.max_tokens > 0) out.max_tokens = req.max_tokens;
	if (req.temperature != null) out.temperature = req.temperature;
	if (req.top_p != null) out.top_p = req.top_p;
	if (req.tools?.length) out.tools = req.tools;
	if (req.stop?.length) out.stop = req.stop;
	return out;
}

// ---------- Anthropic ----------
export function toAnthropic(req: NeutralRequest): Record<string, unknown> {
	let system = req.system;
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
		messages: msgs,
	};
	// Anthropic REQUIRES max_tokens — when the client omitted it, use a sane
	// large default instead of a starvation-inducing small one.
	out.max_tokens = req.max_tokens > 0 ? req.max_tokens : 32768;
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
/**
 * Gemini-native wire → neutral. Parses contents/parts, systemInstruction,
 * functionCall/functionResponse pairs into the OpenAI-ish neutral shape.
 */
export function fromGemini(body: Record<string, unknown>, modelFromPath?: string): NeutralRequest {
	const contents = (body.contents as Array<Record<string, unknown>>) ?? [];

	// systemInstruction may be {parts:[{text}]} or a plain string
	const si = body.systemInstruction as Record<string, unknown> | string | undefined;
	let system: string | undefined;
	if (typeof si === 'string') system = si;
	else if (si && typeof si === 'object') {
		const parts = (si.parts as Array<{ text?: string }>) ?? [];
		system = parts.map((p) => p.text ?? '').filter(Boolean).join('\n') || undefined;
	}

	// map functionCall names by their response order — Gemini tool
	// responses reference functions positionally within the same turn
	type Pending = { id?: string; name: string; args: unknown };
	const msgs: NeutralMessage[] = [];
	let pendingCalls: Pending[] = [];

	function flushAssistantText(text: string) {
		msgs.push({ role: 'assistant', content: text });
	}

	for (const c of contents) {
		const role = (c.role as string) === 'model' ? 'assistant' : 'user';
		const parts = (c.parts as Array<Record<string, unknown>>) ?? [];

		const texts: string[] = [];
		const calls: ToolCall[] = [];
		for (const part of parts) {
			if (part.text != null) {
				texts.push(String(part.text));
			} else if (part.functionCall) {
				const fc = part.functionCall as Record<string, unknown>;
				calls.push({
					id: `call_${calls.length}_${String(fc.name ?? 'fn')}`,
					type: 'function',
					function: { name: String(fc.name ?? ''), arguments: JSON.stringify(fc.args ?? {}) },
				});
			}
		}

		if (role === 'user' && parts.length && parts[0].functionResponse) {
			// tool result(s): pair with the most recent assistant calls
			for (const part of parts) {
				const fr = part.functionResponse as Record<string, unknown> | undefined;
				if (!fr) continue;
				const prev = pendingCalls.shift();
				msgs.push({
					role: 'tool',
					name: String(fr.name ?? prev?.name ?? 'function'),
					tool_call_id: prev?.id ?? `call_${fr.name}`,
					content: JSON.stringify(fr.response ?? {}),
				});
			}
			continue;
		}

		if (calls.length) {
			pendingCalls = calls.map((c2) => ({ name: c2.function.name, args: JSON.parse(c2.function.arguments || '{}') }));
			msgs.push({
				role: 'assistant',
				content: texts.join('\n'),
				tool_calls: calls,
			});
			continue;
		}
		if (texts.length) flushAssistantText(texts.join('\n'));
	}

	return {
		model: modelFromPath ?? String(body.model ?? ''),
		messages: msgs,
		system,
		max_tokens:
			((body.generationConfig as Record<string, unknown>)?.maxOutputTokens as number | undefined) ?? 0,
		temperature: (body.generationConfig as Record<string, unknown>)?.temperature as number | undefined,
		top_p: (body.generationConfig as Record<string, unknown>)?.topP as number | undefined,
		stream: false, // overridden from URL verb by the caller
	};
}

// ---------- Gemini (neutral → wire) ----------
export function toGemini(req: NeutralRequest): Record<string, unknown> {
	const contents: Array<Record<string, unknown>> = [];
	let systemText = req.system;

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
			// 0 = client omitted max tokens → omit the field, provider default applies
			...(req.max_tokens > 0 ? { maxOutputTokens: req.max_tokens } : {}),
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
