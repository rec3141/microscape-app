<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	interface RunRow {
		id: string;
		slug: string;
		name: string;
		description: string | null;
		data_path: string;
		is_public: number;
		created_at: string;
		pipeline_slug: string;
		pipeline_name: string;
		grant_count: number;
	}
	interface Pipeline { id: string; slug: string; name: string; }

	interface Props {
		data: { runs: RunRow[]; pipelines: Pipeline[] };
	}
	let { data }: Props = $props();

	let pipelineId = $state(data.pipelines[0]?.id ?? '');
	let slug = $state('');
	let name = $state('');
	let dataPath = $state('');
	let description = $state('');
	let isPublic = $state(false);
	let busy = $state(false);
	let error = $state('');

	async function createRun(e: Event) {
		e.preventDefault();
		busy = true;
		error = '';
		const res = await fetch('/api/runs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				pipeline_id: pipelineId,
				slug: slug.trim(),
				name: name.trim(),
				description: description.trim() || null,
				data_path: dataPath.trim(),
				is_public: isPublic ? 1 : 0
			})
		});
		busy = false;
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Request failed' }));
			error = body.error || body.issues?.[0]?.message || 'Request failed';
			return;
		}
		slug = '';
		name = '';
		dataPath = '';
		description = '';
		isPublic = false;
		await invalidateAll();
	}

	async function deleteRun(id: string, name: string) {
		if (!confirm(`Delete run "${name}"? This does not touch the underlying files.`)) return;
		const res = await fetch(`/api/runs/${id}`, { method: 'DELETE' });
		if (res.ok) await invalidateAll();
	}
</script>

<svelte:head><title>Runs · Admin · microscape.app</title></svelte:head>

<div class="space-y-6">
	<nav class="text-xs text-slate-500">
		<a href="/settings" class="hover:text-slate-300">Admin</a> · <span class="text-slate-400">Runs</span>
	</nav>

	<header>
		<h1 class="text-2xl font-semibold">Runs</h1>
		<p class="text-sm text-slate-400">Register pipeline-output directories and manage per-user access grants.</p>
	</header>

	<section class="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-4">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Register a run</h2>
		<form onsubmit={createRun} class="grid gap-3 sm:grid-cols-2">
			<label class="block sm:col-span-1">
				<span class="block text-xs text-slate-400 mb-1">Pipeline</span>
				<select bind:value={pipelineId} class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500">
					{#each data.pipelines as p}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</label>

			<label class="block sm:col-span-1">
				<span class="block text-xs text-slate-400 mb-1">Slug <span class="text-slate-600">(url-safe, unique per lab)</span></span>
				<input bind:value={slug} required pattern="[a-z0-9][a-z0-9-]*" maxlength="64" placeholder="chesterfield"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500" />
			</label>

			<label class="block sm:col-span-2">
				<span class="block text-xs text-slate-400 mb-1">Display name</span>
				<input bind:value={name} required maxlength="200" placeholder="Chesterfield 2026-04"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500" />
			</label>

			<label class="block sm:col-span-2">
				<span class="block text-xs text-slate-400 mb-1">Data path <span class="text-slate-600">(absolute path on the host)</span></span>
				<input bind:value={dataPath} required pattern="/.*" placeholder="/data/web/microscape.app/chesterfield"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500 font-mono text-sm" />
			</label>

			<label class="block sm:col-span-2">
				<span class="block text-xs text-slate-400 mb-1">Description <span class="text-slate-600">(optional)</span></span>
				<textarea bind:value={description} rows="2" maxlength="10000"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500"></textarea>
			</label>

			<label class="flex items-center gap-2 sm:col-span-2 text-sm text-slate-300">
				<input type="checkbox" bind:checked={isPublic} class="rounded border-slate-700 bg-slate-800 text-ocean-500 focus:ring-ocean-500" />
				Public — any signed-in user can read this run
			</label>

			{#if error}
				<div class="sm:col-span-2 p-2 rounded bg-red-900/30 border border-red-800 text-red-300 text-sm">{error}</div>
			{/if}

			<div class="sm:col-span-2">
				<button type="submit" disabled={busy}
					class="px-4 py-2 bg-ocean-600 text-white rounded hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium">
					{busy ? 'Registering…' : 'Register run'}
				</button>
			</div>
		</form>
	</section>

	<section class="space-y-2">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Registered runs ({data.runs.length})</h2>
		{#if data.runs.length === 0}
			<div class="rounded border border-slate-800 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-500">
				No runs registered yet.
			</div>
		{:else}
			<ul class="divide-y divide-slate-800 border-y border-slate-800">
				{#each data.runs as run}
					<li class="py-3 flex items-baseline justify-between gap-4">
						<div class="min-w-0">
							<a href="/settings/runs/{run.id}" class="text-ocean-400 hover:text-ocean-300 font-medium break-all">{run.name}</a>
							<div class="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
								<span>{run.pipeline_name}</span>
								<span>·</span>
								<span class="font-mono">{run.slug}</span>
								<span>·</span>
								<span class="font-mono text-slate-600">{run.data_path}</span>
								{#if run.is_public}
									<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wide text-[10px]">public</span>
								{/if}
								{#if run.grant_count > 0}
									<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wide text-[10px]">{run.grant_count} grant{run.grant_count === 1 ? '' : 's'}</span>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-3 text-sm whitespace-nowrap">
							<a href="/settings/runs/{run.id}" class="text-slate-400 hover:text-white">Edit</a>
							<button onclick={() => deleteRun(run.id, run.name)} class="text-red-400 hover:text-red-300">Delete</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
