<script lang="ts">
	import { onMount } from 'svelte';
	import { mountGlobe } from '$lib/earthdna/globe.js';
	import TaxonPicker from '$lib/earthdna/TaxonPicker.svelte';
	import type { RankedTaxon, Taxa, Taxon } from '$lib/earthdna/taxa';
	import { DATASETS, type Dataset } from '$lib/earthdna/datasets';
	import '../earthdna.css';

	interface GlobeRun {
		id: string;
		slug: string;
		name: string;
		lab_name: string;
		access_via: 'public' | 'shared' | 'lab' | 'invited' | null;
	}
	interface Props {
		data: { dataset: Dataset; runs: GlobeRun[]; signedIn: boolean };
	}

	let { data }: Props = $props();
	const ds = $derived(data.dataset);
	let root: HTMLElement;
	let taxa = $state<Taxa | null>(null);
	let asvVersion = $state(0);
	let picker = $state<ReturnType<typeof TaxonPicker> | null>(null);
	let view = $state<(level: number, filter: Taxon | null) => RankedTaxon[]>(() => []);

	// SILVA is the reference globe the PLACE_GLOBE placements are made against
	// (EarthDNA SILVA 144, doi:10.5281/zenodo.23936866); other globes have no runs.
	// Links between globes reload the page, so each mount sees one dataset.
	onMount(() => {
		const globe = mountGlobe(root, {
			base: data.dataset.base,
			version: data.dataset.version,
			release: data.dataset.release,
			runs: data.runs,
			unit: data.dataset.unit[1],
			unitOne: data.dataset.unit[0],
			onTaxa: (t: Taxa) => (taxa = t),
			onPick: (lineage: Taxon[]) => picker?.show(lineage),
			onClear: () => picker?.show(null),
			onAsvs: () => asvVersion++
		});
		view = globe.view;
		return globe.destroy;
	});
</script>

<svelte:head><title>EarthDNA {ds.name} · microscape.app</title></svelte:head>

<div class="earthdna" bind:this={root}>
	<div class="stage">
		<canvas id="gl" aria-label="Globe of {ds.source}"></canvas>
		<div id="loading">Loading {ds.count.toLocaleString('en-US')} {ds.unit[1]}…</div>
		<div id="labels" aria-hidden="true"></div>
		<div id="hint">Drag: rotate · Scroll or pinch: zoom<br />Double-click: centre · Esc: clear</div>
	</div>

	<div class="leftcol">
	<section id="head" class="card">
		<div>
			<h1><a href="/earthdna" class="home">EarthDNA</a></h1>
			<nav class="globes" aria-label="Globes">
				{#each DATASETS as d (d.slug)}
					<a href="/earthdna/{d.slug}" data-sveltekit-reload aria-current={d.slug === ds.slug ? 'page' : undefined}>{d.name}</a>
				{/each}
			</nav>
			<p class="sub">
				<b id="nseq">{ds.count.toLocaleString('en-US')}</b> {ds.source}, placed by 5-mer composition with
				spherical t-SNE (<a href="https://github.com/rec3141/fastsne" target="_blank" rel="noopener noreferrer">fastsne</a>).
				Nearby {ds.unit[1]} are similar.
				{#if !ds.release}
					<!-- no amplicon runs on this globe -->
				{:else if data.runs.length}
					<i>Show amplicon runs</i> adds the ASVs of the {data.runs.length} amplicon {data.runs.length === 1 ? 'run' : 'runs'} you can see.
				{:else if data.signedIn}
					None of the runs you can see has globe placements yet.
				{:else}
					<a href="/auth/login">Sign in</a> to add your lab's amplicon runs.
				{/if}
			</p>
		</div>
		<div class="row">
			<div class="seg" role="group" aria-label="Projection">
				<button id="vGlobe" aria-pressed="true">Globe</button>
				<button id="vFlat" aria-pressed="false">Equal-area</button>
			</div>
			<button class="btn" id="spin" aria-pressed="true">Pause spin</button>
			<button class="btn" id="labelsBtn" aria-pressed="true">Labels</button>
		</div>
		<div class="row" hidden={!data.runs.length}>
			<button class="btn" id="asvBtn" aria-pressed="false">Show amplicon runs</button>
		</div>
		<div class="row">
			<div class="seg" role="group" aria-label="Layout">
				<button id="lSculpt" aria-pressed="true">Sculpted by taxonomy</button>
				<button id="lSim" aria-pressed="false">Similarity</button>
			</div>
		</div>
		<div class="row">
			<div class="seg" role="group" aria-label="Colour">
				<button id="cTax" aria-pressed="true">Colour by taxon</button>
				<button id="cFlag" aria-pressed="false">Label conflicts</button>
			</div>
		</div>
		<div id="status">Drag to turn the globe. Click a point to pick out its genus.</div>
		<div class="sliders">
			<label class="slider" for="size">Point size <input id="size" type="range" min="0.5" max="6" step="0.1" value="0.5" /></label>
			<label class="slider" for="alpha">Opacity <input id="alpha" type="range" min="0.05" max="1" step="0.01" value="1" /></label>
		</div>
	</section>

	<section id="key" class="card" aria-label="Taxa">
		<h2>Taxa</h2>
		{#if taxa}
			<TaxonPicker bind:this={picker} {taxa} {view} asvsShown={asvVersion > 0} version={asvVersion} />
		{:else}
			<p class="keywait">Loading the taxonomy…</p>
		{/if}
	</section>
	</div>

	<details id="runcard" class="card" open hidden>
		<summary><span>Amplicon runs · click one, shift-click to add</span><span id="nruns"></span></summary>
		<input id="runsearch" type="search" placeholder="Filter runs by name, lab or region · Enter shows only matches" aria-label="Filter amplicon runs" autocomplete="off" />
		<ul id="runs"></ul>
		<p id="runsnone" class="keywait" hidden>No run matches.</p>
	</details>

	<div id="tip" hidden></div>
</div>
