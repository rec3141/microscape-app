<script lang="ts">
	import { onMount } from 'svelte';
	import { mountGlobe } from '$lib/earthdna/globe.js';
	import './earthdna.css';

	interface GlobeRun {
		id: string;
		slug: string;
		name: string;
		lab_name: string;
		access_via: 'public' | 'shared' | 'lab' | 'invited' | null;
	}
	interface Props {
		data: { runs: GlobeRun[]; signedIn: boolean };
	}

	let { data }: Props = $props();
	let root: HTMLElement;

	// The reference globe the PLACE_GLOBE placements are made against
	// (EarthDNA SILVA 144, doi:10.5281/zenodo.23936866).
	onMount(() => mountGlobe(root, { base: '/earthdna/silva144', release: '144', runs: data.runs }));
</script>

<svelte:head><title>EarthDNA · microscape.app</title></svelte:head>

<div class="earthdna" bind:this={root}>
	<canvas id="gl" aria-label="Globe of SSU rRNA sequences"></canvas>
	<div id="loading">Loading 905,628 sequences…</div>

	<section id="head" class="card">
		<div>
			<h1>EarthDNA</h1>
			<p class="sub">
				<b id="nseq">905,628</b> SSU rRNA sequences from SILVA 144 NR99, placed by 5-mer composition with
				spherical t-SNE (<a href="https://github.com/rec3141/fastsne" target="_blank" rel="noopener noreferrer">fastsne</a>).
				Nearby sequences are similar.
				{#if data.runs.length}
					Coloured dots are ASVs from the {data.runs.length} amplicon {data.runs.length === 1 ? 'run' : 'runs'} you can see.
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
		</div>
		<div class="row" hidden={!data.runs.length}>
			<button class="btn" id="asvBtn" aria-pressed="false">Show amplicon runs</button>
		</div>
		<div class="row">
			<div class="seg" role="group" aria-label="Layout">
				<button id="lSim" aria-pressed="true">Similarity</button>
				<button id="lSculpt" aria-pressed="false">Sculpted by taxonomy</button>
			</div>
		</div>
		<div class="row">
			<div class="seg" role="group" aria-label="Colour">
				<button id="cTax" aria-pressed="true">Colour by phylum</button>
				<button id="cFlag" aria-pressed="false">Label conflicts</button>
			</div>
		</div>
		<form class="row" id="find">
			<input id="q" type="search" placeholder="Find a species, genus, family or phylum" autocomplete="off" aria-label="Find taxon" />
			<button class="btn" id="clear" type="button">Clear</button>
		</form>
		<div id="status">Drag to turn the globe. Click a point to pick out its genus.</div>
		<div class="sliders">
			<label class="slider" for="size">Point size <input id="size" type="range" min="0.5" max="6" step="0.1" value="1.6" /></label>
			<label class="slider" for="alpha">Opacity <input id="alpha" type="range" min="0.05" max="1" step="0.01" value="0.75" /></label>
		</div>
	</section>

	<details id="key" class="card" open>
		<summary><span id="keytitle">Phyla and eukaryote supergroups</span><span id="ngroups"></span></summary>
		<ul id="groups"></ul>
		<ul id="runs" hidden></ul>
	</details>

	<div id="labels" aria-hidden="true"></div>
	<div id="tip" hidden></div>
	<div id="hint">Drag: rotate · Scroll or pinch: zoom<br />Double-click: centre · Esc: clear</div>
</div>
