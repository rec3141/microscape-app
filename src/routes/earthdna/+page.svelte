<script lang="ts">
	import { DATASETS } from '$lib/earthdna/datasets';
</script>

<svelte:head><title>EarthDNA · microscape.app</title></svelte:head>

<div class="space-y-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-semibold">EarthDNA</h1>
		<p class="text-sm text-slate-400 max-w-2xl">
			Globes of microbial diversity: every point is a DNA sequence, placed by 5-mer composition with spherical t-SNE
			(<a class="text-sky-400 hover:underline" href="https://github.com/rec3141/fastsne" target="_blank" rel="noopener noreferrer">fastsne</a>),
			so nearby points are similar. Pick a globe.
		</p>
	</header>

	<ul class="grid gap-4 sm:grid-cols-2">
		{#each DATASETS as d (d.slug)}
			<li>
				<a
					href="/earthdna/{d.slug}"
					class="group flex h-full flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-5 transition-colors hover:border-slate-600 hover:bg-slate-900"
				>
					<img
						src={d.preview}
						alt="The {d.name} globe, coloured by major group"
						width="640"
						height="640"
						loading="lazy"
						class="mx-auto mb-2 aspect-square w-full max-w-xs transition-transform duration-500 group-hover:scale-[1.03]"
					/>
					<div class="flex items-baseline justify-between gap-3">
						<h2 class="text-lg font-semibold text-slate-100">{d.name}</h2>
						<span class="font-mono text-xs text-slate-400">{d.count.toLocaleString('en-US')} {d.unit[1]}</span>
					</div>
					<p class="text-sm text-slate-400">{d.blurb}</p>
					<span class="mt-auto pt-2 text-sm text-sky-400 group-hover:underline">Open the {d.name} globe →</span>
				</a>
			</li>
		{/each}
	</ul>
</div>
