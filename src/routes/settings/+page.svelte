<script lang="ts">
	import { goto } from '$app/navigation';

	let confirmingDelete = $state(false);
	let deleteConfirm = $state('');
	let deleteBusy = $state(false);
	let deleteError = $state('');

	async function deleteLab(e: Event) {
		e.preventDefault();
		deleteBusy = true;
		deleteError = '';
		const res = await fetch('/api/lab', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ confirm: deleteConfirm })
		});
		deleteBusy = false;
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Request failed' }));
			deleteError = body.error || 'Request failed';
			return;
		}
		await goto('/', { invalidateAll: true });
	}
</script>

<svelte:head><title>Admin · microscape.app</title></svelte:head>

<div class="space-y-6">
	<header>
		<h1 class="text-2xl font-semibold">Admin</h1>
		<p class="text-sm text-slate-400">Lab settings, users, invites, API keys, and run access management.</p>
	</header>

	<ul class="grid gap-3 sm:grid-cols-2">
		<li class="rounded border border-slate-800 bg-slate-900/40 hover:border-ocean-600 transition-colors">
			<a href="/settings/runs" class="block p-4">
				<div class="text-white font-semibold">Runs</div>
				<div class="text-sm text-slate-400 mt-1">Register pipeline outputs and manage per-user access grants.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 hover:border-ocean-600 transition-colors">
			<a href="/settings/invites" class="block p-4">
				<div class="text-white font-semibold">Invites</div>
				<div class="text-sm text-slate-400 mt-1">Generate one-time invite links with a chosen role.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 hover:border-ocean-600 transition-colors">
			<a href="/settings/users" class="block p-4">
				<div class="text-white font-semibold">Users</div>
				<div class="text-sm text-slate-400 mt-1">List lab members, adjust roles, reset local passwords, remove members.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 hover:border-ocean-600 transition-colors">
			<a href="/settings/api-keys" class="block p-4">
				<div class="text-white font-semibold">API keys</div>
				<div class="text-sm text-slate-400 mt-1">Bearer tokens for external pipelines to deploy runs via POST /api/v1/deploy.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 hover:border-ocean-600 transition-colors">
			<a href="/settings/feedback" class="block p-4">
				<div class="text-white font-semibold">Feedback</div>
				<div class="text-sm text-slate-400 mt-1">Review messages submitted via the in-app feedback form.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">
			<div class="text-slate-300 font-semibold">Backups</div>
			<div class="mt-1">UI pending. Configure a per-lab GitHub repo + PAT via <code class="text-slate-400">/api/lab/settings</code> to enable snapshots.</div>
		</li>
	</ul>

	<section class="rounded border border-red-900/60 bg-red-950/20 p-4 space-y-3">
		<div>
			<h2 class="text-sm font-semibold text-red-300 uppercase tracking-wide">Danger zone</h2>
			<p class="text-sm text-slate-400 mt-1">
				Delete this lab. The lab and all of its runs disappear immediately for every
				member and visitor; run data is kept for <strong>30 days</strong> and then
				permanently removed. Contact the operator within that window to restore.
			</p>
		</div>
		{#if !confirmingDelete}
			<button
				onclick={() => (confirmingDelete = true)}
				class="px-3 py-1.5 rounded border border-red-800 text-red-300 hover:bg-red-900/40 text-sm transition-colors"
			>Delete lab…</button>
		{:else}
			<form onsubmit={deleteLab} class="space-y-2">
				<label class="block">
					<span class="block text-xs text-slate-400 mb-1">
						Type the lab name to confirm deletion:
					</span>
					<input
						bind:value={deleteConfirm}
						placeholder="Lab name"
						class="w-full sm:w-80 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
					/>
				</label>
				{#if deleteError}
					<div class="p-2 rounded bg-red-900/30 border border-red-800 text-red-300 text-sm">{deleteError}</div>
				{/if}
				<div class="flex gap-2">
					<button
						type="submit"
						disabled={deleteBusy}
						class="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm transition-colors"
					>{deleteBusy ? 'Deleting…' : 'Permanently delete lab'}</button>
					<button
						type="button"
						onclick={() => { confirmingDelete = false; deleteConfirm = ''; deleteError = ''; }}
						class="px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 text-sm transition-colors"
					>Cancel</button>
				</div>
			</form>
		{/if}
	</section>
</div>
