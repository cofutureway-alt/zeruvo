import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, locales } from '@/i18n/config';

const PROTECTED = /^\/(en|ar|fr|zh)?\/?(dashboard|admin)/;
const AUTH_PAGES = /\/(login|signup)$/;

export async function proxy(request: NextRequest) {
	let response = NextResponse.next({ request });

	const supabase = createServerClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies: {
				getAll() {
					return request.cookies.getAll();
				},
				setAll(cookiesToSet) {
					for (const { name, value } of cookiesToSet) {
						request.cookies.set(name, value);
					}
					response = NextResponse.next({ request });
					for (const { name, value, options } of cookiesToSet) {
						response.cookies.set(name, value, options);
					}
				},
			},
		},
	);

	// IMPORTANT: getUser() validates the JWT with the server (not getSession()).
	const {
		data: { user },
	} = await supabase.auth.getUser();

	const path = request.nextUrl.pathname;

	if (!user && PROTECTED.test(path)) {
		const url = request.nextUrl.clone();
		url.pathname = `/${defaultLocale}/login`;
		url.searchParams.set('next', path);
		return NextResponse.redirect(url);
	}

	if (user && AUTH_PAGES.test(path)) {
		const url = request.nextUrl.clone();
		url.pathname = `/${defaultLocale}/dashboard`;
		url.search = '';
		return NextResponse.redirect(url);
	}

	// Admin gate: role lives in profiles; check only for /admin paths.
	if (user && /\/admin(\/|$)/.test(path)) {
		const { data: profile } = await supabase
			.from('profiles')
			.select('role')
			.eq('id', user.id)
			.single();
		if (profile?.role !== 'admin') {
			const url = request.nextUrl.clone();
			url.pathname = `/${defaultLocale}/dashboard`;
			return NextResponse.redirect(url);
		}
	}

	return response;
}

export const config = {
	matcher: [
		// run on app routes but skip static assets and API routes
		'/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|webp|woff2?|css|js)).*)',
	],
};

// keep import used
void locales;
