<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	interface Item {
		id: string;
		status: 'open' | 'resolved' | 'wontfix';
		page_url: string;
		message: string;
		username: string | null;
		user_id: string | null;
		lab_id: string | null;
		created_at: string;
	}

	interface Props { data: { items: Item[] }; }
	let { data }: Props = $props();

	const open = $derived(data.items.filter((i) => i.status === 'open'));
	const resolved = $derived(data.items.filter((i) => i.status === 'resolved'));
	const wontfix = $derived(data.items.filter((i) => i.status === 'wontfix'));

	async function setStatus(id: string, status: 'open' | 'resolved' | 'wontfix') {
		const res = await fetch(`/api/feedback/${id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status })
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Update failed' }));
			alert(body.error || 'Update failed');
			return;
		}
		await invalidateAll();
	}

	async function del(id: string) {
		if (!confirm('Delete this feedback? This is permanent.')) return;
		const res = await fetch(`/api/feedback/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Delete failed' }));
			alert(body.error || 'Delete failed');
			return;
		}
		await invalidateAll();
	}

	const STATUS_CLASS: Record<string, string> = {
		open: 'bg-amber-900/40 text-amber-300',
		resolved: 'bg-emerald-900/40 text-emerald-300',
		wontfix: 'bg-slate-800 text-slate-400'
	};
</script>

<svelte:head><title>Feedback · Admin · microscape.app</title></svelte:head>

<div class="space-y-6">
	<nav class="text-xs text-slate-500">
		<a href="/settings" class="hover:text-slate-300">Admin</a> · <span class="text-slate-400">Feedback</span>
	</nav>

	<header>
		<h1 class="text-2xl font-semibold">Feedback</h1>
		<p class="text-sm text-slate-400">Messages submitted via the floating feedback form, plus any anonymous submissions.</p>
	</header>

	{#snippet itemList(items: Item[], emptyCopy: string)}
		{#if items.length === 0}
			<p class="text-sm text-slate-500 italic">{emptyCopy}</p>
		{:else}
			<ul class="divide-y divide-slate-800 border-y border-slate-800">
				{#each items as it}
					<li class="py-3 space-y-2">
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2 flex-wrap text-xs">
									<span class="px-1.5 py-0.5 rounded uppercase tracking-wide text-[10px] {STATUS_CLASS[it.status]}">{it.status}</span>
									<span class="text-slate-400">{it.username ?? 'anonymous'}</span>
									<span class="text-slate-600">·</span>
									<a href={it.page_url || '/'}
										class="text-ocean-400 hover:text-ocean-300 font-mono break-all">{it.page_url || '(no page)'}</a>
									<span class="text-slate-600">·</span>
									<time class="text-slate-500">{it.created_at.replace('T', ' ').split('.')[0]}</time>
								</div>
								<p class="mt-1 text-sm text-slate-200 whitespace-pre-wrap break-words">{it.message}</p>
							</div>
							<div class="flex items-center gap-2 whitespace-nowrap text-xs">
								{#if it.status !== 'resolved'}
									<button onclick={() => setStatus(it.id, 'resolved')}
										class="text-emerald-400 hover:text-emerald-300">Resolve</button>
								{/if}
								{#if it.status !== 'wontfix'}
									<button onclick={() => setStatus(it.id, 'wontfix')}
										class="text-slate-400 hover:text-white">Won't fix</button>
								{/if}
								{#if it.status !== 'open'}
									<button onclick={() => setStatus(it.id, 'open')}
										class="text-amber-400 hover:text-amber-300">Reopen</button>
								{/if}
								<button onclick={() => del(it.id)}
									class="text-red-400 hover:text-red-300">Delete</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}

	<section class="space-y-2">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Open ({open.length})</h2>
		{@render itemList(open, 'No open feedback.')}
	</section>

	{#if resolved.length > 0}
		<section class="space-y-2">
			<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Resolved ({resolved.length})</h2>
			{@render itemList(resolved, 'None yet.')}
		</section>
	{/if}

	{#if wontfix.length > 0}
		<section class="space-y-2">
			<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Won't fix ({wontfix.length})</h2>
			{@render itemList(wontfix, 'None.')}
		</section>
	{/if}
</div>
