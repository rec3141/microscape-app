<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	let mode = $state<'choose' | 'create' | 'join'>('choose');
	let busy = $state(false);
	let error = $state('');

	let labName = $state('');
	let labSlug = $state('');
	let token = $state('');

	const inputCls = 'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500';

	async function createLab() {
		if (!labName.trim()) {
			error = 'Lab name is required';
			return;
		}
		busy = true; error = '';
		const res = await fetch('/api/auth/setup-lab', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: labName.trim(), slug: labSlug.trim() || undefined })
		});
		if (res.ok) {
			await invalidateAll();
			goto('/');
		} else {
			error = (await res.json().catch(() => ({}))).error || 'Failed to create lab';
			busy = false;
		}
	}

	async function joinLab() {
		// Accept a raw token OR a full URL like .../auth/join/<token>
		const raw = token.trim();
		const tk = raw.includes('/auth/join/')
			? raw.split('/auth/join/').pop()?.split(/[?#]/)[0] ?? raw
			: raw;
		if (!tk) {
			error = 'Paste an invite token or URL';
			return;
		}
		busy = true; error = '';
		const res = await fetch('/api/auth/join', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: tk })
		});
		if (res.ok) {
			await invalidateAll();
			goto('/');
		} else {
			error = (await res.json().catch(() => ({}))).error || 'Failed to accept invite';
			busy = false;
		}
	}
</script>

<div class="max-w-lg mx-auto mt-16 space-y-6">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-white">Set up your lab</h1>
		<p class="text-slate-400 mt-2 text-sm">
			Welcome! Pick how you want to get started.
		</p>
	</div>

	{#if error}
		<div class="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">{error}</div>
	{/if}

	{#if mode === 'choose'}
		<div class="grid gap-3">
			<button
				type="button"
				onclick={() => { mode = 'create'; error = ''; }}
				class="text-left p-4 rounded-lg border border-slate-700 hover:border-ocean-500 hover:bg-slate-800 transition-colors"
			>
				<div class="text-white font-semibold">Start a new lab</div>
				<div class="text-slate-400 text-sm mt-1">
					You'll be the admin. Runs and per-user grants are managed under this lab.
				</div>
			</button>
			<button
				type="button"
				onclick={() => { mode = 'join'; error = ''; }}
				class="text-left p-4 rounded-lg border border-slate-700 hover:border-ocean-500 hover:bg-slate-800 transition-colors"
			>
				<div class="text-white font-semibold">Join an existing lab</div>
				<div class="text-slate-400 text-sm mt-1">
					Paste an invite token or invite URL from the lab admin.
				</div>
			</button>
		</div>
	{:else if mode === 'create'}
		<form onsubmit={(e) => { e.preventDefault(); createLab(); }} class="space-y-4">
			<div>
				<label for="lab-name" class="block text-sm text-slate-300 mb-1">Lab name</label>
				<input id="lab-name" type="text" bind:value={labName} class={inputCls}
					placeholder="e.g. McGurk Institute" />
			</div>
			<div>
				<label for="lab-slug" class="block text-sm text-slate-300 mb-1">URL slug <span class="text-slate-500 text-xs">(optional, derived from the name otherwise)</span></label>
				<input id="lab-slug" type="text" bind:value={labSlug} class={inputCls}
					placeholder="e.g. mcgurk-institute" />
			</div>
			<div class="flex gap-3 pt-2">
				<button type="submit" disabled={busy}
					class="px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium">
					{busy ? 'Creating…' : 'Create lab'}
				</button>
				<button type="button" onclick={() => { mode = 'choose'; error = ''; }}
					class="px-4 py-2 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium">
					Back
				</button>
			</div>
		</form>
	{:else if mode === 'join'}
		<form onsubmit={(e) => { e.preventDefault(); joinLab(); }} class="space-y-4">
			<div>
				<label for="invite-token" class="block text-sm text-slate-300 mb-1">Invite token or URL</label>
				<input id="invite-token" type="text" bind:value={token} class={inputCls}
					placeholder="Paste the invite link from your lab admin" />
				<p class="text-xs text-slate-500 mt-1">Both the bare token and a full URL like <code>https://microscape.app/auth/join/abc…</code> work.</p>
			</div>
			<div class="flex gap-3 pt-2">
				<button type="submit" disabled={busy}
					class="px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium">
					{busy ? 'Joining…' : 'Accept invite'}
				</button>
				<button type="button" onclick={() => { mode = 'choose'; error = ''; }}
					class="px-4 py-2 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium">
					Back
				</button>
			</div>
		</form>
	{/if}

	<div class="text-center pt-4 border-t border-slate-800">
		<form method="POST" action="/auth/logout" class="inline">
			<button type="submit" class="text-xs text-slate-500 hover:text-slate-300">Sign out</button>
		</form>
	</div>
</div>
