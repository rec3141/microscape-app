<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { mountGlobe } from '$lib/earthdna/globe.js';
	import TaxonPicker from '$lib/earthdna/TaxonPicker.svelte';
	import type { RankedTaxon, Taxa, Taxon } from '$lib/earthdna/taxa';
	import { PILLS, familyOf, familyMenu, type Dataset } from '$lib/earthdna/datasets';
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
	let refreshVersion = $state(0); // the highlight changed: the picker asks view() again
	let picker = $state<ReturnType<typeof TaxonPicker> | null>(null);
	let view = $state<(level: number, filter: Taxon | null) => RankedTaxon[]>(() => []);
	// a wall screen (globe.js ?wall, ?sync) stays one when it switches globe: the links to other globes keep its settings
	const WALL_KEYS = ['sync', 'wall', 'screen', 'bezel', 'lead', 'ui', 'navspeed'];
	// the menu entry the page opens on: ?model= names one of this globe's models
	const startEntry = $derived.by(() => {
		const m = page.url.searchParams.get('model');
		return m && ds.models?.some((x) => x.key === m) ? `${ds.slug}:${m}` : ds.slug;
	});
	const keep = $derived.by(() => {
		const q = new URLSearchParams();
		for (const k of WALL_KEYS) { const v = page.url.searchParams.get(k); if (v !== null) q.set(k, v); }
		const s = q.toString();
		return s ? `?${s}` : '';
	});

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
			onAsvs: () => asvVersion++,
			onRefresh: () => refreshVersion++
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
		<div id="canvasBtns">
			<button class="btn toggle" id="spin" aria-pressed="false">Spin</button>
			<button class="btn toggle" id="labelsBtn" aria-pressed="true">Labels</button>
			<button class="btn toggle" id="sizeBtn" aria-pressed="false" data-small={ds.pointSize ?? 0.5} title="Points: small (click for medium)">Size</button>
		</div>
		<div id="hint">Drag: rotate · Scroll or pinch: zoom<br />Double-click: centre · Esc: clear</div>
	</div>

	<div class="leftcol">
	<section id="head" class="card">
		<div>
			<h1><a href="/earthdna" class="home">EarthDNA</a></h1>
			<nav class="globes" aria-label="Globes">
				{#each PILLS as d (d.slug)}
					<a href="/earthdna/{d.slug}{keep}" data-sveltekit-reload aria-current={familyOf(ds).some((x) => x.slug === d.slug) ? 'page' : undefined}>{d.name}</a>
				{/each}
			</nav>
			{#if familyOf(ds).length > 1}
				<!-- the family's globes; each is its own page, so picking one loads it -->
				<div class="row">
					<label class="rankpick highlight" for="variant">{ds.familyLabel ?? ds.unit[1][0].toUpperCase() + ds.unit[1].slice(1)}
						<!-- another globe's entry loads that page (?model= picks its layout); this globe's models switch in place (globe.js) -->
						<select id="variant" value={startEntry} onchange={(e) => {
							const [slug, m] = e.currentTarget.value.split(':');
							if (slug === ds.slug) return;
							const q = new URLSearchParams(keep);
							if (m) q.set('model', m);
							location.assign(`/earthdna/${slug}${q.size ? `?${q}` : ''}`);
						}}>
							{#each familyMenu(ds) as v (v.value)}<option value={v.value}>{v.text}</option>{/each}
						</select>
					</label>
				</div>
			{/if}
			<div class="row" id="modelRow" hidden>
				<label class="rankpick highlight" for="model">Model
					<select id="model"></select>
				</label>
			</div>
			<p class="sub">
				{#if ds.tsne === false}
					<b id="nseq">{ds.count.toLocaleString('en-US')}</b> {ds.source}{#if ds.sourceLink}{' '}(<a href={ds.sourceLink.href} target="_blank" rel="noopener noreferrer">{ds.sourceLink.text}</a>){/if}, placed {ds.method}.
				{:else}
					<b id="nseq">{ds.count.toLocaleString('en-US')}</b> {ds.source}{#if ds.sourceLink}{' '}(<a href={ds.sourceLink.href} target="_blank" rel="noopener noreferrer">{ds.sourceLink.text}</a>){/if}, placed by {ds.method} with
					spherical t-SNE (<a href="https://github.com/rec3141/fastsne" target="_blank" rel="noopener noreferrer">fastsne</a>).
					Nearby {ds.unit[1]} are similar.
				{/if}
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
				<button id="vDome" aria-pressed="false" title="Fisheye from inside the sphere (a dome master: the front of the dome at the bottom)">Dome</button>
			</div>
		</div>
		<div class="row" hidden={!data.runs.length}>
			<button class="btn" id="asvBtn" aria-pressed="false">Show amplicon runs</button>
		</div>
		<div class="row">
			<span class="rowlabel" id="shapedLabel">Shaped by</span>
			<div class="seg" role="group" aria-labelledby="shapedLabel">
				<button id="lSculpt" aria-pressed="true">Taxonomy</button>
				<button id="lSim" aria-pressed="false">Similarity</button>
			</div>
		</div>
		<div class="row ovrow" id="ovRow" hidden><span class="ovtitle">Reads</span></div>
		<div class="row" id="labelSetRow" hidden>
			<label class="rankpick highlight" for="labelSet">Labels
				<select id="labelSet"></select>
			</label>
		</div>
		<div class="row" id="traitRow" hidden>
			<label class="rankpick highlight" for="trait">Highlight
				<select id="trait"><option value="-1">All</option></select>
			</label>
		</div>
		<div id="status">Drag to turn the globe.</div>
	</section>

	<section id="key" class="card" aria-label="Taxa">
		<h2>{taxa?.title ?? 'Taxa'}</h2>
		{#if taxa}
			{#key taxa}
				<TaxonPicker bind:this={picker} {taxa} {view} asvsShown={asvVersion > 0} version={asvVersion + refreshVersion} />
			{/key}
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
