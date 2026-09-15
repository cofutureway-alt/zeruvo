/**
 * Mock OpenAI-compatible provider for E2E gateway testing.
 * Serves POST /v1/chat/completions with a fixed completion (stream + non-stream).
 *
 * Fault injection is keyed off the Authorization bearer so one deployment can
 * impersonate many providers for the failover test suite:
 *   Bearer flaky-stall-524   → hold headers ~20s, then HTTP 524 (the pi.b.ai shape)
 *   Bearer flaky-stall-forever → stall 600s (exercises the header-wait deadline)
 *   Bearer flaky-drop-mid    → SSE: two content frames then the connection dies
 *   Bearer flaky-200-errframe → HTTP 200 SSE whose first data: is an error object
 *   Bearer flaky-429         → HTTP 429
 *   Bearer flaky-401         → HTTP 401 (key gets marked dead)
 *   any other bearer         → healthy canned response (unchanged behavior)
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
			const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
			const body = await request.json();

			if (bearer === 'flaky-stall-524') {
				await sleep(20_000);
				return new Response('upstream timeout', { status: 524 });
			}
			if (bearer === 'flaky-stall-forever') {
				await sleep(600_000);
				return new Response('upstream timeout', { status: 524 });
			}
			if (bearer === 'flaky-drop-mid') {
				const enc = new TextEncoder();
				const created = Math.floor(Date.now() / 1000);
				const id = 'chatcmpl-mock-' + created;
				const stream = new ReadableStream({
					async start(c) {
						c.enqueue(enc.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'partial ' } }] })}\n\n`));
						c.enqueue(enc.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'answer' } }] })}\n\n`));
						await sleep(300);
						c.error(new Error('mock mid-stream drop'));
					},
				});
				return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
			}
			if (bearer === 'flaky-200-errframe') {
				const enc = new TextEncoder();
				const stream = new ReadableStream({
					start(c) {
						c.enqueue(enc.encode(`data: ${JSON.stringify({ error: { message: 'simulated provider failure', code: 500 } })}\n\n`));
						c.close();
					},
				});
				return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
			}
			if (bearer === 'flaky-429') {
				return Response.json({ error: { message: 'rate limited' } }, { status: 429 });
			}
			if (bearer === 'flaky-401') {
				return Response.json({ error: { message: 'invalid api key' } }, { status: 401 });
			}

			const created = Math.floor(Date.now() / 1000);
			const id = 'chatcmpl-mock-' + created;

			if (!body.stream) {
				return Response.json({
					id,
					object: 'chat.completion',
					created,
					model: body.model,
					choices: [
						{
							index: 0,
							message: { role: 'assistant', content: 'Mock says: ' + (body.messages?.[0]?.content ?? '') },
							finish_reason: 'stop',
						},
					],
					usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
				});
			}

			const enc = new TextEncoder();
			const frames = [
				{ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'Mock ' } }] },
				{ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'stream!' } }] },
				{ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } },
			];
			const stream = new ReadableStream({
				start(c) {
					for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
					c.enqueue(enc.encode('data: [DONE]\n\n'));
					c.close();
				},
			});
			return new Response(stream, {
				headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
			});
		}
		return new Response('not found', { status: 404 });
	},
};
