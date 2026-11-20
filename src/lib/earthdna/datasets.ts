/**
 * The EarthDNA reference globes. Each is served at /earthdna/<slug>; its
 * data files (globe.json, pos.bin, tax.bin, ranks.bin, layout_sculpt.bin,
 * flags.bin, from earthdna's pack_globe.py) live under `base`.
 *
 * silva: in static/earthdna/silva144/, the reference amplicon runs are placed
 *        against (PLACE_GLOBE), so it is the only globe that shows runs.
 * gtdb:  too big for the repo; nginx serves /earthdna/gtdb226/ from
 *        /data/web/earthdna-ref/gtdb226/ on arbutus. A sample: 6.5% of the t-SNE reference + 1.5M projected fragments.
 * gtdb-full: every fragment in the GTDB t-SNE reference (10.5M, earthdna pipeline/gtdb_globe_set.py --ref-shown 1
 *        --extra 0), nginx from /data/web/earthdna-ref/gtdb226full/.
 * gtdb-all: all 35.1M fragments embedded together (fastsne_cpu --sphere on Grex genoa, one 192-core node, 15-20 min
 *        per layout; earthdna pipeline/pack_gtdb_all.py), taxonomy once per genome (records.bin), nginx from
 *        /data/web/earthdna-ref/gtdb226all/.
 * silva-ref, silva-parc: all of SILVA 144 SSURef and SSUParc (earthdna SSURef / Parc builds), served by nginx
 *        like gtdb from /data/web/earthdna-ref/silva144-{ssuref,parc}/. Separate maps from NR99, so the runs'
 *        placements (made against silva144-2) don't belong on them.
 * motus: in static/earthdna/motus41/, one point per mOTUs-db 4.1 mOTU detected in a metagenome (earthdna
 *        pipeline/build_motus.sh); models '' (marker-gene 5-mers) and abund (co-occurrence across metagenomes).
 * motus-samples: in static/earthdna/motus41-samples/, one point per metagenome, similarity layout only.
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
	/** globes of one kind share a pill (the first one's name) and a Sequences menu that picks between them */
	family?: string;
	/** this globe's entry in that menu */
	variant?: string;
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
		method: '5-mer composition',
		family: 'ssu',
		variant: 'SILVA NR99 (0.9M)'
	},
	{
		slug: 'silva-ref',
		name: 'SSU Ref',
		base: '/earthdna/silva144-ssuref',
		version: 'silva144-ssuref-1',
		release: null,
		count: 9183096,
		unit: ['sequence', 'sequences'],
		blurb: 'All 9.2 million SSU rRNA genes in SILVA 144 SSURef, not just the NR99 representatives: a big download (about 145 MB).',
		source: 'SSU rRNA sequences from SILVA 144 SSURef',
		preview: '/earthdna/previews/silva-ref.webp',
		method: '5-mer composition',
		family: 'ssu',
		variant: 'SILVA SSURef (9.2M, 145 MB)'
	},
	{
		slug: 'silva-parc',
		name: 'SSU Parc',
		base: '/earthdna/silva144-parc',
		version: 'silva144-parc-1',
		release: null,
		count: 15439037,
		unit: ['sequence', 'sequences'],
		blurb: 'All 15.4 million SSU rRNA sequences in SILVA 144 SSUParc, short and partial ones included: a very big download (about 215 MB) for a desktop with a good GPU.',
		source: 'SSU rRNA sequences from SILVA 144 SSUParc',
		preview: '/earthdna/previews/silva-parc.webp',
		method: '5-mer composition',
		family: 'ssu',
		variant: 'SILVA SSUParc (15.4M, 215 MB)'
	},
	{
		slug: 'gtdb',
		name: 'GTDB',
		base: '/earthdna/gtdb226',
		version: 'gtdb226-ref30-2k-p2c4-traits',
		release: null,
		count: 3886471,
		unit: ['fragment', 'fragments'],
		blurb: '10 kb fragments of all 143k GTDB r226 species-representative genomes, bacteria and archaea; highlight cultured isolates, named species or type material.',
		source: '10 kb fragments of GTDB r226 species-representative genomes',
		preview: '/earthdna/previews/gtdb.webp',
		method: '5-mer composition',
		family: 'gtdb',
		variant: '11% (3.9M, 75 MB)'
	},
	{
		slug: 'gtdb-full',
		name: 'GTDB',
		base: '/earthdna/gtdb226full',
		version: 'gtdb226-ref30-full-1',
		release: null,
		count: 10549059,
		unit: ['fragment', 'fragments'],
		blurb: 'Every 10 kb fragment in the GTDB r226 t-SNE (10.5 million): a very big download (about 200 MB) for a desktop with a good GPU.',
		source: '10 kb fragments of GTDB r226 species-representative genomes (the whole t-SNE reference)',
		preview: '/earthdna/previews/gtdb.webp',
		method: '5-mer composition',
		family: 'gtdb',
		variant: '30% (10.5M, 200 MB)'
	},
	{
		slug: 'gtdb-all',
		name: 'GTDB',
		base: '/earthdna/gtdb226all',
		version: 'gtdb226-all-2',
		release: null,
		count: 35146244,
		unit: ['fragment', 'fragments'],
		blurb: 'All 35 million 10 kb fragments of the GTDB r226 species representatives: every one embedded together in a single t-SNE. A 400 MB download and about 1 GB of memory: desktop only.',
		source: '10 kb fragments of GTDB r226 species-representative genomes (all of them, embedded together)',
		preview: '/earthdna/previews/gtdb.webp',
		method: '5-mer composition',
		family: 'gtdb',
		variant: '100% (35.1M, 400 MB)'
	},
	{
		slug: 'motus',
		name: 'mOTUs',
		base: '/earthdna/motus41',
		version: 'motus41-1',
		release: null,
		count: 119562,
		unit: ['mOTU', 'mOTUs'],
		blurb: 'Every species-level cluster (mOTU) of mOTUs-db 4.1 found in a metagenome, placed by its marker genes or by which of 115k metagenomes it occurs in: switch under Model.',
		source: 'mOTUs-db 4.1 species-level clusters (GTDB r226 taxonomy)',
		preview: '/earthdna/previews/motus.webp',
		method: 'marker-gene 5-mers or co-occurrence across metagenomes (pick one under Model)',
		pointSize: 1.5
	},
	{
		slug: 'motus-samples',
		name: 'mOTU-Samples',
		base: '/earthdna/motus41-samples',
		version: 'motus41-samples-1',
		release: null,
		count: 114160,
		unit: ['metagenome', 'metagenomes'],
		blurb: 'The 114k public metagenomes profiled by mOTUs-db 4.1, placed by their mOTU composition and labelled by their most abundant taxon.',
		source: 'metagenomes profiled by mOTUs-db 4.1, labelled by their most abundant taxon',
		preview: '/earthdna/previews/motus-samples.webp',
		method: 'mOTU composition (Hellinger distance)',
		pointSize: 1.5
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

/** the other globes in d's family, d included (just d when it has none) */
export const familyOf = (d: Dataset) => (d.family ? DATASETS.filter((x) => x.family === d.family) : [d]);

/** one globe per pill and landing card: each family's first */
export const PILLS = DATASETS.filter((d) => familyOf(d)[0] === d);
