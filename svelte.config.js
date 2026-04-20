import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// SvelteKit-managed Content Security Policy. `mode: 'hash'` computes
		// a sha256 for every inline <script> and <style> SvelteKit emits
		// (SSR data injection, hydration bootstrap) and adds them to the
		// CSP as `'sha256-...'` sources. Without this, `script-src 'self'`
		// blocks SvelteKit's own hydration payloads on every page load.
		//
		// The non-script/style headers (X-Frame-Options, HSTS, nosniff,
		// Referrer-Policy, Permissions-Policy) still come from
		// hooks.server.ts — CSP is the only one SvelteKit needs to own.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': [
					'self',
					'data:',
					'https://avatars.githubusercontent.com'
				],
				'font-src': ['self', 'data:'],
				'connect-src': ['self'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
