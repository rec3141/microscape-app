<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	interface Invite {
		token: string;
		role: string;
		email_hint: string | null;
		created_at: string;
		expires_at: string;
		used_at: string | null;
		created_by_username: string | null;
		used_by_username: string | null;
	}

	interface Props { data: { invites: Invite[]; origin: string }; }
	let { data }: Props = $props();

	let role = $state<'admin' | 'user' | 'viewer'>('user');
	let emailHint = $state('');
	let ttlDays = $state(14);
	let busy = $state(false);
	let error = $state('');

	// When the admin generates a new invite, surface the URL immediately so
	// they can copy it before navigating away. Cleared on successive actions.
	let lastUrl = $state('');
	let copied = $state(false);

	const active = $derived(data.invites.filter((i) => !i.used_at && i.expires_at > nowIso()));
	const used = $derived(data.invites.filter((i) => i.used_at));
	const expired = $derived(data.invites.filter((i) => !i.used_at && i.expires_at <= nowIso()));

	function nowIso(): string {
		return new Date().toISOString().replace('T', ' ').slice(0, 19);
	}

	function inviteUrl(token: string): string {
		return `${data.origin}/auth/join/${token}`;
	}

	async function create(e: Event) {
		e.preventDefault();
		busy = true;
		error = '';
		copied = false;
		const res = await fetch('/api/invites', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				role,
				email_hint: emailHint.trim() || null,
				ttl_days: ttlDays
			})
		});
		busy = false;
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Request failed' }));
			error = body.error || 'Request failed';
			return;
		}
		const body = await res.json();
		lastUrl = inviteUrl(body.token);
		emailHint = '';
		await invalidateAll();
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard API may be unavailable (old browser / no HTTPS). Fall
			// back to selecting the text in a temporary element.
			const ta = document.createElement('textarea');
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}
	}

	async function revoke(token: string) {
		if (!confirm('Revoke this invite? The link will stop working immediately.')) return;
		const res = await fetch(`/api/invites/${token}`, { method: 'DELETE' });
		if (res.ok) {
			if (lastUrl.endsWith(`/auth/join/${token}`)) lastUrl = '';
			await invalidateAll();
		}
	}
</script>

<svelte:head><title>Invites · Admin · microscape.app</title></svelte:head>

<div class="space-y-6">
	<nav class="text-xs text-slate-500">
		<a href="/settings" class="hover:text-slate-300">Admin</a> · <span class="text-slate-400">Invites</span>
	</nav>

	<header>
		<h1 class="text-2xl font-semibold">Invites</h1>
		<p class="text-sm text-slate-400">Generate a one-time invite link that admits someone to this lab with a chosen role.</p>
	</header>

	<section class="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-4">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">New invite</h2>
		<form onsubmit={create} class="grid gap-3 sm:grid-cols-3">
			<label class="block">
				<span class="block text-xs text-slate-400 mb-1">Role</span>
				<select bind:value={role}
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500">
					<option value="viewer">Viewer (read-only)</option>
					<option value="user">User</option>
					<option value="admin">Admin</option>
				</select>
			</label>
			<label class="block sm:col-span-1">
				<span class="block text-xs text-slate-400 mb-1">TTL (days, 1-90)</span>
				<input type="number" bind:value={ttlDays} min="1" max="90" required
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500" />
			</label>
			<label class="block sm:col-span-1">
				<span class="block text-xs text-slate-400 mb-1">Email hint <span class="text-slate-600">(optional)</span></span>
				<input type="text" bind:value={emailHint} maxlength="200" placeholder="alice@lab.example"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500" />
			</label>

			{#if error}
				<div class="sm:col-span-3 p-2 rounded bg-red-900/30 border border-red-800 text-red-300 text-sm">{error}</div>
			{/if}

			<div class="sm:col-span-3">
				<button type="submit" disabled={busy}
					class="px-4 py-2 bg-ocean-600 text-white rounded hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium">
					{busy ? 'Generating…' : 'Generate invite'}
				</button>
			</div>
		</form>

		{#if lastUrl}
			<div class="p-3 rounded border border-emerald-800 bg-emerald-900/20 space-y-2">
				<p class="text-xs text-emerald-300 uppercase tracking-wide">New invite link — copy before you close this page</p>
				<div class="flex items-center gap-2">
					<input readonly value={lastUrl}
						class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white font-mono text-sm" />
					<button onclick={() => copy(lastUrl)}
						class="px-3 py-2 bg-slate-800 border border-slate-700 text-slate-200 rounded hover:bg-slate-700 transition-colors text-sm">
						{copied ? 'Copied' : 'Copy'}
					</button>
				</div>
			</div>
		{/if}
	</section>

	<section class="space-y-2">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Active ({active.length})</h2>
		{#if active.length === 0}
			<p class="text-sm text-slate-500 italic">No active invites.</p>
		{:else}
			<ul class="divide-y divide-slate-800 border-y border-slate-800">
				{#each active as inv}
					<li class="py-3 flex items-baseline justify-between gap-4 text-sm">
						<div class="min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wide text-[10px]">{inv.role}</span>
								{#if inv.email_hint}<span class="text-slate-300">{inv.email_hint}</span>{/if}
								<span class="text-slate-600">·</span>
								<span class="text-slate-500 text-xs">expires {inv.expires_at.split(' ')[0]}</span>
								{#if inv.created_by_username}
									<span class="text-slate-600">·</span>
									<span class="text-slate-500 text-xs">by {inv.created_by_username}</span>
								{/if}
							</div>
							<div class="mt-1 font-mono text-xs text-slate-500 break-all">{inviteUrl(inv.token)}</div>
						</div>
						<div class="flex items-center gap-3 whitespace-nowrap">
							<button onclick={() => copy(inviteUrl(inv.token))} class="text-slate-400 hover:text-white text-xs">Copy</button>
							<button onclick={() => revoke(inv.token)} class="text-red-400 hover:text-red-300 text-xs">Revoke</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if used.length > 0}
		<section class="space-y-2">
			<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Accepted ({used.length})</h2>
			<ul class="divide-y divide-slate-800 border-y border-slate-800">
				{#each used as inv}
					<li class="py-2 flex items-baseline justify-between gap-4 text-sm">
						<div>
							<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wide text-[10px]">{inv.role}</span>
							{#if inv.used_by_username}<span class="ml-2 text-slate-300">{inv.used_by_username}</span>{/if}
							{#if inv.email_hint}<span class="ml-2 text-slate-500 text-xs">({inv.email_hint})</span>{/if}
						</div>
						<time class="text-xs text-slate-500">{inv.used_at?.split(' ')[0]}</time>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if expired.length > 0}
		<section class="space-y-2">
			<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Expired ({expired.length})</h2>
			<ul class="divide-y divide-slate-800 border-y border-slate-800">
				{#each expired as inv}
					<li class="py-2 flex items-baseline justify-between gap-4 text-sm text-slate-500">
						<div>
							<span class="px-1.5 py-0.5 rounded bg-slate-800 uppercase tracking-wide text-[10px]">{inv.role}</span>
							{#if inv.email_hint}<span class="ml-2">{inv.email_hint}</span>{/if}
						</div>
						<time class="text-xs">expired {inv.expires_at.split(' ')[0]}</time>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
