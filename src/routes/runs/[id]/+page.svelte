<script lang="ts">
	interface Run {
		id: string;
		slug: string;
		name: string;
		description: string | null;
		is_public: number;
		data_path: string;
		created_at: string;
		updated_at: string;
		pipeline_slug: string;
		pipeline_name: string;
		lab_name: string;
		lab_slug: string;
		access_via: 'public' | 'lab' | 'invited' | null;
		effective_role: 'viewer' | 'user' | 'admin';
	}
	interface Props { data: { run: Run }; }
	let { data }: Props = $props();

	const ACCESS_LABEL: Record<string, string> = {
		public: 'Public',
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
		<h1 class="text-2xl font-semibold">{data.run.name}</h1>
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
			The gated file endpoint for this run will live at
			<code class="text-slate-300 bg-slate-800 px-1 rounded">/runs/{data.run.id}/files/&lt;path&gt;</code>.
			File delivery is being wired up — once live, the per-run SPA dashboard will be reachable here.
		</p>
	</section>
</div>
