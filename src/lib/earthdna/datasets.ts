/**
 * The EarthDNA reference globes. Each is served at /earthdna/<slug>; its
 * data files (globe.json, pos.bin, tax.bin, ranks.bin, layout_sculpt.bin,
 * flags.bin, from earthdna's pack_globe.py) live under `base`.
 *
 * silva: in static/earthdna/silva144/, the reference amplicon runs are placed
 *        against (PLACE_GLOBE), so it is the only globe that shows runs.
 * gtdb:  too big for the repo; nginx serves /earthdna/gtdb226/ from
 *        /data/web/earthdna-ref/gtdb226/ on arbutus.
 * models: in static/earthdna/models-gtdb-genus/, one 4 kb window per GTDB genus (earthdna models_set.py) laid
 *        out by each model; globe.json `models` names them and the viewer's Model picker switches between their
 *        layouts (layout_<shape>-<key>.bin). /earthdna/evo2 redirects here.
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
		slug: 'models',
		name: 'DNA models',
		base: '/earthdna/models-gtdb-genus',
		version: 'models-genus4k-2-20b',
		release: null,
		count: 28850,
		unit: ['window', 'windows'],
		blurb: 'One 4 kb window from every GTDB genus, placed by DNA language models (Evo 2 20B and 7B, DNABERT-S) or by 5-mers: switch models and watch the map change.',
		source: '4 kb windows, one per GTDB r226 genus',
		preview: '/earthdna/previews/models.webp',
		method: 'DNA language model embeddings (pick one under Model)',
		pointSize: 1.5
	}
];

/** old slugs that now live elsewhere */
export const MOVED: Record<string, string> = { evo2: 'models' };

export const datasetBySlug = (slug: string) => DATASETS.find((d) => d.slug === slug);
