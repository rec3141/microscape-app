<script lang="ts">
	interface Run {
		id: string;
		slug: string;
		name: string;
		description: string | null;
		is_shared: number;
		data_path: string;
		created_at: string;
		updated_at: string;
		pipeline_slug: string;
		pipeline_name: string;
		lab_name: string;
		lab_slug: string;
		access_via: 'public' | 'shared' | 'lab' | 'invited' | null;
		effective_role: 'viewer' | 'user' | 'admin';
		can_edit: number;
	}
	interface Props { data: { run: Run }; }
	let { data }: Props = $props();

	const ACCESS_LABEL: Record<string, string> = {
		public: 'Public',
		shared: 'Cross-lab shared',
		lab: 'Lab member',
		invited: 'Invited'
	};
</script>

<svelte:head><title>{data.run.name} · microscape.app</title></svelte:head>

<div class="space-y-6">
	<nav class="text-xs text-slate-500">
		<a href="/" class="hover:text-slate-300">Runs</a> · <span class="text-slate-400">{data.run.name}</span>
	</nav>

	<header class="space-y-2">
		<div class="flex items-baseline justify-between gap-3">
			<h1 class="text-2xl font-semibold">{data.run.name}</h1>
			{#if data.run.can_edit}
				<a
					href="/settings/runs/{data.run.id}"
					title="Edit run"
					aria-label="Edit run"
					class="text-slate-500 hover:text-ocean-400 transition-colors shrink-0"
				>
					<!-- Heroicons pencil-square (outline) -->
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
					</svg>
				</a>
			{/if}
		</div>
		<div class="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
			<span>{data.run.pipeline_name}</span>
			<span>·</span>
			<span>{data.run.lab_name}</span>
			{#if data.run.access_via}
				<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wide text-[10px]">
					{ACCESS_LABEL[data.run.access_via]}
				</span>
			{/if}
		</div>
		{#if data.run.description}
			<p class="text-sm text-slate-400 max-w-2xl">{data.run.description}</p>
		{/if}
	</header>

	<section class="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-3">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Artifacts</h2>
		<p class="text-sm text-slate-500">
			The run's output directory is served under
			<code class="text-slate-300 bg-slate-800 px-1 rounded">/{data.run.slug}/</code>
			for members of this lab.
		</p>
		<div class="flex gap-3">
			<a
				href="/{data.run.slug}/"
				class="inline-block px-3 py-2 bg-ocean-600 text-white rounded hover:bg-ocean-500 transition-colors text-sm font-medium"
			>Open dashboard →</a>
		</div>
	</section>
</div>
