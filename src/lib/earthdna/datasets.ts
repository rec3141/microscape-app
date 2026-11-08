/**
 * The EarthDNA reference globes. Each is served at /earthdna/<slug>; its
 * data files (globe.json, pos.bin, tax.bin, ranks.bin, layout_sculpt.bin,
 * flags.bin, from earthdna's pack_globe.py) live under `base`.
 *
 * silva: in static/earthdna/silva144/, the reference amplicon runs are placed
 *        against (PLACE_GLOBE), so it is the only globe that shows runs.
 * gtdb:  too big for the repo; nginx serves /earthdna/gtdb226/ from
 *        /data/web/earthdna-ref/gtdb226/ on arbutus.
 * evo2:  a placeholder in static/earthdna/evo2-gtdb-7b/ (5,000 GTDB fragments placed by Evo 2 7B embeddings) until
 *        the full Evo 2 genome globe is built.
 */
export interface Dataset {
	slug: string;
	name: string;
	base: string;
	/** data build id: change it whenever the files under base are rebuilt, so browsers fetch them fresh */
	version: string;
	/** reference release amplicon placements must name; null = no runs on this globe */
	release: string | null;
	count: number;
	/** what one point is, singular and plural */
	unit: [string, string];
	blurb: string;
	source: string;
	/** still of the sculpted globe for the picker (earthdna pipeline/render_preview.py) */
	preview: string;
	/** how points were placed, for the page text */
	method: string;
	/** starting point size (the slider runs 0.5 to 6); sparse globes start bigger */
	pointSize?: number;
}

export const DATASETS: Dataset[] = [
	{
		slug: 'silva',
		name: 'SSU rRNA',
		base: '/earthdna/silva144',
		version: 'silva144-1',
		release: '144',
		count: 905628,
		unit: ['sequence', 'sequences'],
		blurb: 'Every SSU rRNA gene in SILVA 144 NR99, with your amplicon runs placed on the same map.',
		source: 'SSU rRNA sequences from SILVA 144 NR99',
		preview: '/earthdna/previews/silva.webp',
		method: '5-mer composition'
	},
	{
		slug: 'gtdb',
		name: 'Genomes',
		base: '/earthdna/gtdb226',
		version: 'gtdb226-ref30-2k-p2c4-traits',
		release: null,
		count: 3886471,
		unit: ['fragment', 'fragments'],
		blurb: '10 kb fragments of all 143k GTDB r226 species-representative genomes, bacteria and archaea; highlight cultured isolates, named species or type material.',
		source: '10 kb fragments of GTDB r226 species-representative genomes',
		preview: '/earthdna/previews/gtdb.webp',
		method: '5-mer composition'
	},
	{
		slug: 'evo2',
		name: 'Evo 2 (preview)',
		base: '/earthdna/evo2-gtdb-7b',
		version: 'evo2-7b-l28-gtdb5k-1',
		release: null,
		count: 5000,
		unit: ['fragment', 'fragments'],
		blurb: 'A first look: 5,000 GTDB genome fragments (50 species, 10 genera) placed by what the Evo 2 DNA language model makes of them instead of by k-mers.',
		source: '10 kb GTDB r226 fragments from 50 species in 10 genera',
		preview: '/earthdna/previews/evo2.webp',
		method: 'Evo 2 7B embeddings (layer 28, channels standardised)',
		pointSize: 3
	}
];

export const datasetBySlug = (slug: string) => DATASETS.find((d) => d.slug === slug);
