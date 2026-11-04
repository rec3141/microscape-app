<script lang="ts">
	// The drill-down taxa picker of danaSeq illumina_amplicon viz (viz/src/components/Sidebar.svelte,
	// Taxonomy section), driving the EarthDNA globe: the list ranks the taxa at one rank inside the
	// picked taxon, a row drills into it, "Up" walks back, and the search jumps to any taxon.
	import AutocompleteInput from './AutocompleteInput.svelte';
	import { expandTaxonQuery, NONE, type RankedTaxon, type Taxa, type Taxon } from './taxa';

	interface Props {
		taxa: Taxa;
		view: (level: number, filter: Taxon | null) => RankedTaxon[];
		asvsShown?: boolean;
		version?: number; // bumped when the ASVs arrive, so the ASV counts refresh
	}
	let { taxa, view, asvsShown = false, version = 0 }: Props = $props();

	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	let base = $state(0); // the rank coloured when nothing is picked; Domain, as in danaSeq
	let stack = $state<Taxon[]>([]);
	let query = $state('');
	let filter = $derived(stack.length ? stack[stack.length - 1] : null);
	let level = $derived(filter ? Math.min(filter.rank + 1, taxa.levels.length - 1) : base);
	let ranked = $state<RankedTaxon[]>([]);

	$effect(() => {
		void version;
		ranked = view(level, filter);
	});

	let candidates = $derived([...new Set(taxa.names.flat().filter(Boolean))]);

	/** Show this lineage, deepest taxon picked; Up then walks back through its ancestors. */
	export function show(lineage: Taxon[] | null) {
		stack = lineage ?? [];
		query = '';
	}

	function navigateToTaxon(name: string) {
		const lineage = taxa.find(name);
		if (lineage) show(lineage);
	}
</script>

<div class="picker">
	<AutocompleteInput
		bind:value={query}
		placeholder="Find a taxon, e.g. Pseudomonadota"
		{candidates}
		expand={expandTaxonQuery}
		onPick={navigateToTaxon}
	/>

	{#if !stack.length}
		<label class="rankpick">
			<span>Colour by</span>
			<select bind:value={base}>
				{#each taxa.levels.slice(0, -1) as l, i}
					<option value={i}>{cap(l)}</option>
				{/each}
			</select>
		</label>
	{/if}

	<div class="head">
		<span>{cap(taxa.levels[level])} ({ranked.length.toLocaleString()})</span>
		<span class="cols"><span>refs</span>{#if asvsShown}<span>ASVs</span>{/if}</span>
	</div>
	<ul class="rows">
		{#if stack.length}
			{@const prev = stack.length > 1 ? stack[stack.length - 2] : null}
			<li>
				<button class="up" onclick={() => (stack = stack.slice(0, -1))}>
					&#x25B4; Up to {prev ? prev.name : cap(taxa.levels[base])}
				</button>
			</li>
		{/if}
		{#each ranked as item (item.code)}
			<li>
				<button
					class="row"
					disabled={item.code === NONE || (filter !== null && level === filter.rank)}
					onclick={() => (stack = [...stack, { rank: level, code: item.code, name: item.name }])}
				>
					<span class="sw" style="background:{item.color}"></span>
					<span class="nm" class:unc={item.code === NONE}>{item.name}</span>
					<span class="n">{item.count.toLocaleString()}</span>
					{#if asvsShown}<span class="n">{(item.asvs ?? 0).toLocaleString()}</span>{/if}
				</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	.picker { display: grid; gap: 8px; padding: 10px 12px 10px; min-width: 0; }
	.rankpick { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; color: var(--muted); }
	.rankpick select { flex: 1; font: inherit; font-size: 0.8rem; color: var(--ink); background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); border-radius: 6px; padding: 3px 6px; }
	.head { display: flex; gap: 8px; font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
	.cols { margin-left: auto; display: flex; gap: 10px; }
	.cols span { min-width: 3.2rem; text-align: right; }
	.rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; max-height: min(52dvh, 520px); overflow-y: auto; }
	.up { width: 100%; text-align: left; font: inherit; font-size: 0.78rem; color: #38bdf8; background: transparent; border: 0; border-bottom: 1px solid var(--line); padding: 4px 6px; margin-bottom: 2px; cursor: pointer; }
	.up:hover, .row:hover:not(:disabled) { background: rgba(255, 255, 255, 0.05); }
	.row { width: 100%; display: grid; grid-template-columns: 9px minmax(0, 1fr) auto auto; align-items: start; gap: 8px; text-align: left; font: inherit; font-size: 0.8rem; color: var(--ink); background: transparent; border: 0; border-radius: 5px; padding: 3px 6px; cursor: pointer; }
	.row:disabled { cursor: default; }
	.sw { width: 9px; height: 9px; border-radius: 50%; margin-top: 0.32em; }
	/* min-width: 0 lets a long name wrap rather than shove the counts off the row */
	.nm { min-width: 0; overflow-wrap: anywhere; }
	.nm.unc { color: var(--muted); font-style: italic; }
	.n { min-width: 3.2rem; text-align: right; font-family: var(--f-data); font-size: 0.7rem; color: var(--muted); font-variant-numeric: tabular-nums; }

	@media (max-width: 640px) { .rows { max-height: 40dvh; } }
</style>
