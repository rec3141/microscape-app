<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let error = $state('');

	async function accept() {
		busy = true; error = '';
		const res = await fetch('/api/auth/join', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: data.token })
		});
		if (res.ok) {
			await invalidateAll();
			goto('/');
		} else {
			error = (await res.json().catch(() => ({}))).error || 'Failed to accept invite';
			busy = false;
		}
	}

	const loginUrl = `/auth/login?next=${encodeURIComponent('/auth/join/' + data.token)}`;
</script>

<div class="max-w-lg mx-auto mt-16 space-y-6 text-center">
	{#if !data.invite}
		<h1 class="text-2xl font-bold text-white">Invite not found</h1>
		<p class="text-slate-400">
			The invite link doesn't exist. Ask the lab admin for a fresh one.
		</p>
		<a href="/auth/login" class="inline-block px-4 py-2 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium">Sign in</a>
	{:else if data.used}
		<h1 class="text-2xl font-bold text-white">Invite already used</h1>
		<p class="text-slate-400">
			This invite has already been accepted. Ask the lab admin for a new one if you need to join.
		</p>
	{:else if data.expired}
		<h1 class="text-2xl font-bold text-white">Invite expired</h1>
		<p class="text-slate-400">
			This invite expired on <span class="text-slate-300">{new Date(data.invite.expires_at).toLocaleDateString()}</span>.
			Ask the lab admin for a fresh one.
		</p>
	{:else}
		<div>
			<h1 class="text-2xl font-bold text-white">You're invited</h1>
			<p class="text-slate-400 mt-2">
				Join <span class="text-white font-semibold">{data.invite.lab_name}</span>
				as <span class="text-white font-mono text-sm">{data.invite.role}</span>.
			</p>
			{#if data.invite.email_hint}
				<p class="text-slate-500 text-sm mt-1">Intended for: {data.invite.email_hint}</p>
			{/if}
		</div>

		{#if error}
			<div class="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">{error}</div>
		{/if}

		{#if !data.signedIn}
			<p class="text-slate-400 text-sm">Sign in (or sign up via GitHub) to accept this invite.</p>
			<a href={loginUrl}
				class="inline-block px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 transition-colors text-sm font-medium">
				Sign in to continue
			</a>
		{:else}
			<p class="text-slate-400 text-sm">
				{#if data.userHasLab}
					Heads up — accepting will move you out of your current lab into <span class="text-white">{data.invite.lab_name}</span>. You'll lose access to your old lab's data unless you have a separate invite back.
				{:else}
					You'll be set up as a member of <span class="text-white">{data.invite.lab_name}</span>.
				{/if}
			</p>
			<button type="button" onclick={accept} disabled={busy}
				class="px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium">
				{busy ? 'Joining…' : 'Accept invite'}
			</button>
		{/if}
	{/if}
</div>
