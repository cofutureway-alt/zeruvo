/**
 * Mock OpenAI-compatible provider for E2E gateway testing.
 * Serves POST /v1/chat/completions with a fixed completion (stream + non-stream).
 */
export default {
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
			const body = await request.json();
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
