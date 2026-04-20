<script lang="ts">
	import { goto } from '$app/navigation';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let oldPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let saving = $state(false);
	let errorMsg = $state('');

	const mustChange = $derived(data.user?.must_change_password === 1);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';
		if (newPassword !== confirmPassword) {
			errorMsg = 'New passwords do not match';
			return;
		}
		if (newPassword.length < 10) {
			errorMsg = 'New password must be at least 10 characters';
			return;
		}
		saving = true;
		const res = await fetch('/api/account/password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
		});
		if (res.ok) {
			await invalidateAll();
			goto('/');
		} else {
			const err = await res.json().catch(() => null);
			errorMsg = err?.error || `Failed (${res.status})`;
			saving = false;
		}
	}
</script>

<div class="max-w-md mx-auto mt-20 space-y-6">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-white">Change password</h1>
		{#if mustChange}
			<p class="text-amber-400 mt-2 text-sm">
				You must change your password before you can use microscape.app.
			</p>
		{:else}
			<p class="text-slate-400 mt-2 text-sm">
				Signed in as <span class="text-white">{data.user?.username}</span>
			</p>
		{/if}
	</div>

	{#if errorMsg}
		<div class="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
			{errorMsg}
		</div>
	{/if}

	<form onsubmit={submit} class="space-y-3">
		<input
			type="password"
			bind:value={oldPassword}
			required
			placeholder="Current password"
			class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500"
		/>
		<input
			type="password"
			bind:value={newPassword}
			required
			minlength="10"
			placeholder="New password (min 10 characters)"
			class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500"
		/>
		<input
			type="password"
			bind:value={confirmPassword}
			required
			minlength="10"
			placeholder="Confirm new password"
			class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500"
		/>
		<button
			type="submit"
			disabled={saving}
			class="w-full px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium"
		>
			{saving ? 'Updating...' : 'Update password'}
		</button>
	</form>
</div>
