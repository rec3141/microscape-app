<script lang="ts">
	interface RunRow {
		id: string;
		slug: string;
		name: string;
		description: string | null;
		is_public: number;
		created_at: string;
		pipeline_slug: string;
		pipeline_name: string;
		lab_name: string;
		lab_slug: string;
		access_via: 'public' | 'lab' | 'invited' | null;
	}

	interface Props {
		data: { runs: RunRow[] };
	}

	let { data }: Props = $props();

	const ACCESS_LABEL: Record<string, string> = {
		public: 'public',
		lab: 'lab',
		invited: 'invited'
	};
</script>

<svelte:head><title>microscape.app</title></svelte:head>

<div class="space-y-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-semibold">Pipeline runs</h1>
		<p class="text-sm text-slate-400">
			Dashboards and artifacts from microscape-nf and danaseq pipelines.
		</p>
	</header>

	{#if data.runs.length === 0}
		<div class="rounded border border-slate-800 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-400">
			No runs visible to you yet. Ask an admin to add you to a lab or grant access to a specific run.
		</div>
	{:else}
		<ul class="divide-y divide-slate-800 border-y border-slate-800">
			{#each data.runs as run}
				<li class="py-3 flex items-baseline justify-between gap-4">
					<div class="min-w-0">
						<a
							href="/runs/{run.id}"
							class="text-ocean-400 hover:text-ocean-300 font-medium break-all"
						>{run.name}</a>
						<div class="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
							<span>{run.pipeline_name}</span>
							<span>·</span>
							<span>{run.lab_name}</span>
							{#if run.access_via}
								<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wide text-[10px]">
									{ACCESS_LABEL[run.access_via]}
								</span>
							{/if}
						</div>
						{#if run.description}
							<p class="text-sm text-slate-400 mt-1 line-clamp-2">{run.description}</p>
						{/if}
					</div>
					<time class="text-xs text-slate-500 tabular-nums whitespace-nowrap">{run.created_at.split(' ')[0]}</time>
				</li>
			{/each}
		</ul>
	{/if}
</div>
