<script lang="ts">
	import { page } from '$app/stores';

	let errorParam = $derived($page.url.searchParams.get('error'));
	let nextParam = $derived($page.url.searchParams.get('next') ?? '');
	let formAction = $derived(nextParam ? `/auth/login/local?next=${encodeURIComponent(nextParam)}` : '/auth/login/local');
	let errorMsg = $derived(
		errorParam === 'invalid_credentials' ? 'Invalid username or password.' :
		errorParam === 'missing_credentials' ? 'Please enter username and password.' :
		errorParam === 'rate_limited' ? 'Too many login attempts, please wait and try again.' :
		errorParam === 'github_not_configured' ? 'GitHub OAuth is not configured. Use local login.' :
		''
	);
</script>

<div class="max-w-sm mx-auto mt-20 space-y-6">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-white">Sign in to microscape.app</h1>
		<p class="text-slate-400 mt-1 text-sm">
			New here? <span class="text-slate-300">Sign in with GitHub</span> — you'll be prompted to start a new lab or accept an invite.
		</p>
	</div>

	{#if errorMsg}
		<div class="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">{errorMsg}</div>
	{/if}

	<div class="space-y-3">
		<a
			href="/auth/login/github"
			class="flex items-center justify-center gap-2 w-full px-4 py-3 bg-slate-800 border border-slate-700 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium"
		>
			<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
				<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
			</svg>
			Sign in with GitHub
		</a>

		<div class="relative">
			<div class="absolute inset-0 flex items-center"><div class="w-full border-t border-slate-800"></div></div>
			<div class="relative flex justify-center text-xs"><span class="bg-slate-950 px-2 text-slate-500">or</span></div>
		</div>

		<form action={formAction} method="POST" class="space-y-3">
			<input
				name="username"
				type="text"
				required
				placeholder="Username"
				class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500"
			/>
			<input
				name="password"
				type="password"
				required
				placeholder="Password"
				class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500"
			/>
			<button
				type="submit"
				class="w-full px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 transition-colors text-sm font-medium"
			>
				Sign In
			</button>
		</form>

	</div>

	<p class="text-xs text-slate-500 text-center pt-4 border-t border-slate-800">
		Access to pipeline outputs is granted by a lab admin.
	</p>
</div>
