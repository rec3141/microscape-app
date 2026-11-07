/**
 * The EarthDNA reference globes. Each is served at /earthdna/<slug>; its
 * data files (globe.json, pos.bin, tax.bin, ranks.bin, layout_sculpt.bin,
 * flags.bin, from earthdna's pack_globe.py) live under `base`.
 *
 * silva: in static/earthdna/silva144/, the reference amplicon runs are placed
 *        against (PLACE_GLOBE), so it is the only globe that shows runs.
 * gtdb:  too big for the repo; nginx serves /earthdna/gtdb226/ from
 *        /data/web/earthdna-ref/gtdb226/ on arbutus.
 */
export interface Dataset {
	slug: string;
	name: string;
	base: string;
	/** reference release amplicon placements must name; null = no runs on this globe */
	release: string | null;
	count: number;
	/** what one point is, singular and plural */
	unit: [string, string];
	blurb: string;
	source: string;
}

export const DATASETS: Dataset[] = [
	{
		slug: 'silva',
		name: 'SSU rRNA',
		base: '/earthdna/silva144',
		release: '144',
		count: 905628,
		unit: ['sequence', 'sequences'],
		blurb: 'Every SSU rRNA gene in SILVA 144 NR99, with your amplicon runs placed on the same map.',
		source: 'SSU rRNA sequences from SILVA 144 NR99'
	},
	{
		slug: 'gtdb',
		name: 'Genomes',
		base: '/earthdna/gtdb226',
		release: null,
		count: 3886471,
		unit: ['fragment', 'fragments'],
		blurb: '10 kb fragments of all 143k GTDB r226 species-representative genomes, bacteria and archaea.',
		source: '10 kb fragments of GTDB r226 species-representative genomes'
	}
];

export const datasetBySlug = (slug: string) => DATASETS.find((d) => d.slug === slug);
