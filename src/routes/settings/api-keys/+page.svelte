<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	interface Key {
		id: string;
		name: string;
		key_prefix: string;
		can_publish_public: number;
		created_at: string;
		last_used_at: string | null;
		revoked_at: string | null;
		created_by_username: string | null;
	}

	interface Props { data: { keys: Key[] }; }
	let { data }: Props = $props();

	let newName = $state('');
	let newCanPublishPublic = $state(false);
	let busy = $state(false);
	let error = $state('');
	let lastCreated = $state<{ name: string; key: string; canPublishPublic: boolean } | null>(null);
	let copied = $state(false);

	const active = $derived(data.keys.filter((k) => !k.revoked_at));
	const revoked = $derived(data.keys.filter((k) => k.revoked_at));

	async function create(e: Event) {
		e.preventDefault();
		busy = true;
		error = '';
		copied = false;
		const res = await fetch('/api/keys', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: newName.trim(),
				can_publish_public: newCanPublishPublic ? 1 : 0
			})
		});
		busy = false;
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Request failed' }));
			error = body.error || body.issues?.[0]?.message || 'Request failed';
			return;
		}
		const body = await res.json();
		lastCreated = {
			name: body.name,
			key: body.key,
			canPublishPublic: body.can_publish_public === 1
		};
		newName = '';
		newCanPublishPublic = false;
		await invalidateAll();
	}

	async function toggleCanPublishPublic(k: Key) {
		const next = k.can_publish_public ? 0 : 1;
		const verb = next ? 'grant' : 'revoke';
		const ok = confirm(
			next === 1
				? `Allow key "${k.name}" to publish runs into the public lab? This makes it possible for the pipeline using this key to expose data to anonymous web visitors.`
				: `Revoke this key's ability to publish to the public lab? Existing public runs are NOT affected — this only blocks future X-Microscape-Visibility: public deploys.`
		);
		if (!ok) return;
		const res = await fetch(`/api/keys/${k.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ can_publish_public: next })
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Update failed' }));
			alert(body.error || `Failed to ${verb} capability`);
			return;
		}
		await invalidateAll();
	}

	async function revoke(k: Key) {
		if (!confirm(`Revoke key "${k.name}"? Pipelines using this key will start failing immediately.`)) return;
		const res = await fetch(`/api/keys/${k.id}`, { method: 'DELETE' });
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Revoke failed' }));
			alert(body.error || 'Revoke failed');
			return;
		}
		if (lastCreated?.name === k.name) lastCreated = null;
		await invalidateAll();
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
		}
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<svelte:head><title>API keys · Admin · microscape.app</title></svelte:head>

<div class="space-y-6">
	<nav class="text-xs text-slate-500">
		<a href="/settings" class="hover:text-slate-300">Admin</a> · <span class="text-slate-400">API keys</span>
	</nav>

	<header>
		<h1 class="text-2xl font-semibold">API keys</h1>
		<p class="text-sm text-slate-400 max-w-2xl">
			Bearer tokens for external pipelines (e.g. danaseq) to push run outputs via <code class="text-slate-300">POST /api/v1/deploy</code>.
			Each key has the write surface of a lab-admin: it can create or replace any run in this lab. Keys are shown once at creation — save them in the pipeline's secrets store.
		</p>
	</header>

	<section class="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-3">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">New key</h2>
		<form onsubmit={create} class="space-y-3">
			<div class="flex flex-wrap items-end gap-3">
				<label class="block flex-1 min-w-[14rem]">
					<span class="block text-xs text-slate-400 mb-1">Name <span class="text-slate-600">(what pipeline uses it?)</span></span>
					<input bind:value={newName} required maxlength="100" placeholder="danaseq nanopore_live"
						class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500" />
				</label>
				<button type="submit" disabled={busy}
					class="px-4 py-2 bg-ocean-600 text-white rounded hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium">
					{busy ? 'Minting…' : 'Mint key'}
				</button>
			</div>
			<label class="flex items-start gap-2 text-sm text-slate-300">
				<input type="checkbox" bind:checked={newCanPublishPublic}
					class="mt-0.5 rounded border-slate-700 bg-slate-800 text-ocean-500 focus:ring-ocean-500" />
				<span class="block">
					<span class="font-medium">Can publish to the public lab</span>
					<span class="block text-xs text-slate-500">
						Allow deploys with <code class="text-slate-300">X-Microscape-Visibility: public</code> — runs land in the public lab and become anonymously readable on the web. Leave off unless this key is specifically for a conference / showcase pipeline.
					</span>
				</span>
			</label>
		</form>
		{#if error}
			<div class="p-2 rounded bg-red-900/30 border border-red-800 text-red-300 text-sm">{error}</div>
		{/if}

		{#if lastCreated}
			<div class="p-3 rounded border border-emerald-800 bg-emerald-900/20 space-y-2">
				<p class="text-xs text-emerald-300 uppercase tracking-wide">
					"{lastCreated.name}" — copy now. The full key will not be shown again.
				</p>
				<div class="flex items-center gap-2">
					<input readonly value={lastCreated.key}
						class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white font-mono text-sm" />
					<button onclick={() => copy(lastCreated!.key)}
						class="px-3 py-2 bg-slate-800 border border-slate-700 text-slate-200 rounded hover:bg-slate-700 transition-colors text-sm">
						{copied ? 'Copied' : 'Copy'}
					</button>
				</div>
				{#if lastCreated.canPublishPublic}
					<p class="text-xs text-amber-300">
						Capability: can publish to the public lab.
					</p>
				{/if}
			</div>
		{/if}
	</section>

	<section class="space-y-2">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Active ({active.length})</h2>
		{#if active.length === 0}
			<p class="text-sm text-slate-500 italic">No active keys.</p>
		{:else}
			<ul class="divide-y divide-slate-800 border-y border-slate-800">
				{#each active as k}
					<li class="py-3 flex items-baseline justify-between gap-4 text-sm">
						<div class="min-w-0">
							<div class="text-slate-200 font-medium flex items-center gap-2 flex-wrap">
								<span>{k.name}</span>
								{#if k.can_publish_public}
									<span class="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 uppercase tracking-wide text-[10px]">can publish public</span>
								{/if}
							</div>
							<div class="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
								<span class="font-mono">{k.key_prefix}</span>
								<span>·</span>
								<span>created {k.created_at.split(' ')[0]}{k.created_by_username ? ` by ${k.created_by_username}` : ''}</span>
								<span>·</span>
								<span>{k.last_used_at ? `last used ${k.last_used_at.split(' ')[0]}` : 'never used'}</span>
							</div>
						</div>
						<div class="flex items-center gap-3 whitespace-nowrap">
							<button onclick={() => toggleCanPublishPublic(k)}
								class="text-xs text-slate-400 hover:text-slate-200">
								{k.can_publish_public ? 'Revoke public publish' : 'Grant public publish'}
							</button>
							<button onclick={() => revoke(k)} class="text-red-400 hover:text-red-300 text-xs">Revoke</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if revoked.length > 0}
		<section class="space-y-2">
			<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Revoked ({revoked.length})</h2>
			<ul class="divide-y divide-slate-800 border-y border-slate-800">
				{#each revoked as k}
					<li class="py-2 flex items-baseline justify-between gap-4 text-sm text-slate-500">
						<div>
							<span class="line-through">{k.name}</span>
							<span class="ml-2 font-mono text-xs">{k.key_prefix}</span>
						</div>
						<time class="text-xs">revoked {k.revoked_at?.split(' ')[0]}</time>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
