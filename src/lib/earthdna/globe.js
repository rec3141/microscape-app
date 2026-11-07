// @ts-nocheck — WebGL viewer ported from earthdna viewer/globe.html; typed loosely on purpose.
import { TAXON_SYNONYMS } from './taxa';
/**
 * EarthDNA globe: every SILVA SSU reference placed on a sphere by k-mer
 * composition (fastsne --sphere), with each visible amplicon run's ASVs
 * (danaSeq illumina_amplicon PLACE_GLOBE → data/globe.json) drawn on top.
 *
 * mountGlobe(root, { base, release, runs, onTaxa, onPick, onClear }) wires up
 * the markup in src/routes/earthdna/[dataset]/+page.svelte (elements found by id inside
 * root) and returns { destroy, view }.
 *
 *   base     URL of the reference files: globe.json, pos.bin (lon, lat
 *            uint16 + group uint8), tax.bin (genus, lineage uint16, species
 *            uint16, or uint32 when globe.json says speciesBytes 4),
 *            ranks.bin (phylum, class, order, family uint16),
 *            layout_sculpt.bin, flags.bin
 *   version  data build id, added to every data URL (?v=) so a rebuilt globe is never read from cache
 *   unit, unitOne  what a point is, for the page's text ('sequences', 'sequence')
 *   release  reference release the runs' placements must name
 *   runs     [{ id, slug, name, lab_name }] — each fetched from /earthdna/runs/<id>
 *            (src/routes/earthdna/runs/[id]/+server.ts)
 *   onTaxa   called once the rank codes are in, with { levels, names, find }
 *   onPick   called with a clicked reference's lineage [{ rank, code, name }]
 *   onClear  called on Escape
 *   onAsvs   called once the runs' ASVs are in (the picker's ASV counts change)
 *   onRefresh  called when the picker should ask view() again (the highlight changed)
 *
 * view(level, filter) colours the references by their taxa at rank `level`
 * among those inside `filter` ({ rank, code } or null; outside it they dim),
 * keeps only the ASVs whose lineage names the filter taxon, and returns the
 * taxa ranked by reference count: [{ name, code, count, asvs, color }].
 */

const PALETTE = ['#4e9bf0', '#f2994a', '#58c78a', '#e8595f', '#b28df2', '#f2d35a', '#41c8c8', '#f07ab8', '#9ccf4f', '#e3a37a',
	'#7f8cf2', '#c25ad6', '#5fb0e8', '#f5b8d0', '#a6e0b2', '#d9774a', '#8fd3f0', '#ccb25a', '#9b7bd1', '#6fd6a0', '#e07f99', '#bfc8d6', '#e8c06f', '#7ab8a8'];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
function hsl(h, s, l) { const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; }
const REGION_NAMES = { '14964-22534': '16S V4', '13861-27653': '16S V4–V5', '42586-43102': '18S V9', '6427-23439': '16S V3–V4', '1114-6386': '18S V1–V2' };
const regionName = (r) => REGION_NAMES[r] || `alignment columns ${r}`;
const IDLE = 'Drag to turn the globe. Click a point to pick out its genus.';

// danaSeq viz's palette (illumina_amplicon/viz/src/stores/data.svelte.js), so a rank list reads the same in both: a spiral
// round the colour wheel (golden-angle hue steps, saturation and lightness cycling), one colour per taxon however many
function generatePalette(n) {
	const colors = [];
	for (let i = 0; i < n; i++) colors.push(hsl((120 + i * 137.508) % 360, (55 + (i % 3) * 15) / 100, (45 + (i % 4) * 8) / 100));
	return colors;
}
// unclassified is drawn bright, so it stands out from dimmed points
const NONE = 65535, BRIGHT = [0.96, 0.93, 0.82];
// per-point colour slots index a colour texture COLW texels wide (no limit on how many taxa get their own colour)
const COLW = 2048;  // WebGL2 guarantees 2048-wide textures
// names compared between run taxonomies and the reference: case and underscores ignored
const norm = (s) => s.trim().toLowerCase().replace(/_/g, ' ');
const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

export function mountGlobe(root, { base, version = '', release, runs, unit = 'sequences', unitOne = 'sequence', onTaxa = () => {}, onPick = () => {}, onClear = () => {}, onAsvs = () => {}, onRefresh = () => {} }) {
	const $ = (id) => root.querySelector('#' + id);
	const canvas = $('gl');
	const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false });
	if (!gl) { $('loading').textContent = 'This page needs WebGL2, which this browser does not provide.'; return { destroy() {}, view: () => [] }; }
	let alive = true;
	const cleanups = [];
	const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); cleanups.push(() => target.removeEventListener(ev, fn, opts)); };

	// ---------- shaders
	function prog(vs, fs) {
		const p = gl.createProgram();
		for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
			const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
			if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
			gl.attachShader(p, sh);
		}
		gl.linkProgram(p);
		if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
		return p;
	}
	const PROJ = `
uniform mat3 uRot; uniform float uFlat; uniform vec2 uScale;
const float PI = 3.14159265;
// world unit vector -> clip xy, visible flag
vec3 project(vec3 p) {
  vec3 q = uRot * p;
  if (uFlat < 0.5) return vec3(q.xy * uScale, q.z > 0.0 ? 1.0 : 0.0);
  float lam = atan(q.x, q.z), phi = asin(clamp(q.y, -1.0, 1.0));
  float t = phi;
  for (int i = 0; i < 6; i++) { float f = 2.0 * t + sin(2.0 * t) - PI * sin(phi); t -= f / (2.0 + 2.0 * cos(2.0 * t) + 1e-6); }
  vec2 m = vec2(0.9003163 * lam * cos(t), 1.4142136 * sin(t)) * 0.5;
  return vec3(m * uScale, 1.0);
}`;
	const ptProg = prog(`#version 300 es
in vec2 aLL; in vec2 aLL2; in uint aGrp; in uint aSel; in uint aFlag;
uniform sampler2D uColTex; uniform float uSize, uAlpha, uHasSel, uMix, uMode;
out vec4 vCol;
${PROJ}
void main() {
  float lon = aLL.x * 2.0 * PI - PI, lat = aLL.y * PI - 0.5 * PI;
  vec3 p = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  if (uMix > 0.0) {
    float lo2 = aLL2.x * 2.0 * PI - PI, la2 = aLL2.y * PI - 0.5 * PI;
    vec3 p2 = vec3(cos(la2) * cos(lo2), cos(la2) * sin(lo2), sin(la2));
    vec3 m = mix(p, p2, uMix);
    p = dot(m, m) > 1e-6 ? normalize(m) : p2;
  }
  vec3 s = project(p);
  bool on = aSel > 0u, flagged = uMode > 0.5 && aFlag > 0u;
  gl_Position = vec4(s.xy, on ? 0.0 : flagged ? 0.25 : 0.5, s.z > 0.5 ? 1.0 : 0.0);
  gl_PointSize = s.z > 0.5 ? uSize * ((on && uHasSel > 0.5) || flagged ? 1.6 : 1.0) : 0.0;
  vec3 c = texelFetch(uColTex, ivec2(int(aGrp % 2048u), int(aGrp / 2048u)), 0).rgb;
  if (uHasSel > 0.5 && !on) vCol = vec4(mix(c, vec3(0.45, 0.52, 0.62), 0.75), uAlpha * 0.18);
  else if (uMode > 0.5) vCol = aFlag == 2u ? vec4(0.96, 0.36, 0.48, 1.0) : aFlag == 1u ? vec4(0.97, 0.75, 0.30, 0.95) : vec4(0.40, 0.48, 0.60, uAlpha * 0.3);
  else vCol = vec4(c, uAlpha);
}`, `#version 300 es
precision mediump float;
in vec4 vCol; out vec4 o;
void main() { vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; o = vCol; }`);
	const asvProg = prog(`#version 300 es
in vec2 aLL; in vec3 aCol; in uint aOn; in uint aSz;
uniform float uSize;
out vec4 vCol;
${PROJ}
void main() {
  float lon = aLL.x * 2.0 * PI - PI, lat = aLL.y * PI - 0.5 * PI;
  vec3 s = project(vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat)));
  bool vis = s.z > 0.5 && aOn > 0u;
  gl_Position = vec4(s.xy, 0.0, vis ? 1.0 : 0.0);
  gl_PointSize = vis ? uSize * (0.3 + float(aSz) / 255.0 * 29.7) : 0.0;  // 100x from the rarest ASV to the most read
  vCol = vec4(aCol, 0.95);
}`, `#version 300 es
precision mediump float;
in vec4 vCol; out vec4 o;
void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; o = r > 0.15 ? vec4(vCol.rgb * 0.3, 0.9) : vCol; }`);
	const bgProg = prog(`#version 300 es
in vec2 aP; out vec2 vP;
void main() { vP = aP; gl_Position = vec4(aP, 0.99, 1.0); }`, `#version 300 es
precision highp float;
in vec2 vP; out vec4 o;
uniform mat3 uRot; uniform float uFlat; uniform vec2 uScale;
const float PI = 3.14159265;
void main() {
  vec2 s = vP / uScale;
  vec3 ocean = vec3(0.047, 0.094, 0.157), space = vec3(0.008, 0.024, 0.090);
  if (uFlat < 0.5) {
    float r2 = dot(s, s);
    if (r2 > 1.0) { float h = exp(-(sqrt(r2) - 1.0) * 28.0); o = vec4(mix(space, vec3(0.16, 0.30, 0.48), h * 0.55), 1.0); return; }
    float shade = 0.55 + 0.45 * sqrt(1.0 - r2);
    o = vec4(ocean * shade, 1.0);
  } else {
    vec2 m = s * 2.0;
    float st = m.y / 1.4142136;
    if (abs(st) > 1.0) { o = vec4(space, 1.0); return; }
    float t = asin(st);
    float lam = m.x / (0.9003163 * cos(t));
    if (abs(lam) > PI) { o = vec4(space, 1.0); return; }
    o = vec4(ocean, 1.0);
  }
}`);

	// ---------- state
	const R0 = [0, 1, 0, 0, 0, 1, 1, 0, 0];  // world -> view: lon 0 / lat 0 faces the viewer, north up
	let rot = R0.slice(), zoom = 1, flat = false, spin = !matchMedia('(prefers-reduced-motion: reduce)').matches;
	let N = 0, meta = null, grp, gen, lin, spc, xyz, cellStart, cellIdx, selBuf, sel, hasSel = false;
	// genome traits (globe.json traits; GTDB: cultured, named, type_material): one byte per point, bit k = trait k
	let traits = null, trait = -1;
	const TRAIT_LABEL = { cultured: 'Cultured isolates', named: 'Named species', type_material: 'Type material' };
	let domIx = null, rankArr = null, rankNames = null, cidx = null, cidxBuf = null, asvFilter = '';
	// one RGBA texel per colour slot, COLW wide; rows grow with the number of slots (texel past the end reads black)
	const colTex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, colTex);
	for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
	function setColours(rgb) {
		const n = rgb.length / 3 + 1, h = Math.ceil(n / COLW), px = new Uint8Array(4 * COLW * h);
		for (let i = 0; i < rgb.length / 3; i++) for (let j = 0; j < 3; j++) px[4 * i + j] = Math.round(255 * rgb[3 * i + j]);
		gl.bindTexture(gl.TEXTURE_2D, colTex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, COLW, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
		dirty = true;
	}
	const mul = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]; return r; };
	const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
	const rotX = (b) => { const c = Math.cos(b), s = Math.sin(b); return [1, 0, 0, 0, c, -s, 0, s, c]; };
	function centreOn(lon, lat) { rot = mul(rotX(lat), mul(rotY(-lon), R0)); }

	function scale() {
		const w = canvas.width, h = canvas.height;
		const b = flat ? Math.min(0.665 * w, 1.33 * h) : 0.92 * Math.min(w, h);  // pixels per two units of radius
		return [b * zoom / w, b * zoom / h];
	}
	function resize() {
		const dpr = Math.min(devicePixelRatio || 1, 2);
		canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr)); canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
		gl.viewport(0, 0, canvas.width, canvas.height); dirty = true;
	}

	// ---------- buffers
	const bgVao = gl.createVertexArray(); gl.bindVertexArray(bgVao);
	const bgB = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bgB);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
	{ const loc = gl.getAttribLocation(bgProg, 'aP'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
	const ptVao = gl.createVertexArray();

	const layouts = {};  // name -> { lon, lat, buf, W }
	const toXyz = (lo, la) => { const a = lo / 65535 * 2 * Math.PI - Math.PI, b = la / 65535 * Math.PI - Math.PI / 2; return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)]; };
	const apply = (W, p) => [0, 1, 2].map((r) => W[3 * r] * p[0] + W[3 * r + 1] * p[1] + W[3 * r + 2] * p[2]);
	const toLL = (p) => [Math.round((Math.atan2(p[1], p[0]) + Math.PI) / (2 * Math.PI) * 65535), Math.round((Math.asin(Math.max(-1, Math.min(1, p[2]))) + Math.PI / 2) / Math.PI * 65535)];
	// Rotation that lays the domains along the equator: the pole is the axis the three domain centres sit
	// farthest from (smallest eigenvector of sum c c^T over their unit centres), then the largest domain is
	// turned to longitude 0.
	function equatorRotation(lon, lat) {
		const D = Math.max(...domIx) + 1, sum = new Float64Array(3 * D), n = new Int32Array(D);
		for (let i = 0; i < N; i++) { const d = domIx[grp[i]], p = toXyz(lon[i], lat[i]); n[d]++; for (let k = 0; k < 3; k++) sum[3 * d + k] += p[k]; }
		const c = [];
		for (let d = 0; d < D; d++) { const l = Math.hypot(sum[3 * d], sum[3 * d + 1], sum[3 * d + 2]); if (n[d] && l > 0) c.push([sum[3 * d] / l, sum[3 * d + 1] / l, sum[3 * d + 2] / l]); }
		const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
		for (const v of c) for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) M[3 * r + s] += v[r] * v[s];
		const pole = smallestEigenvector(M);
		// Rodrigues: turn the pole onto +z
		const ax = [pole[1], -pole[0], 0], sn = Math.hypot(ax[0], ax[1]), cs = pole[2];
		let W = [1, 0, 0, 0, 1, 0, 0, 0, 1];
		if (sn > 1e-9) {
			const k = [ax[0] / sn, ax[1] / sn, 0], K = [0, -k[2], k[1], k[2], 0, -k[0], -k[1], k[0], 0], K2 = mul(K, K);
			W = W.map((v, j) => v + sn * K[j] + (1 - cs) * K2[j]);
		} else if (cs < 0) W = [1, 0, 0, 0, -1, 0, 0, 0, -1];
		const big = n.indexOf(Math.max(...n)), b = apply(W, [sum[3 * big], sum[3 * big + 1], sum[3 * big + 2]]), phi = Math.atan2(b[1], b[0]);
		const Rz = [Math.cos(-phi), -Math.sin(-phi), 0, Math.sin(-phi), Math.cos(-phi), 0, 0, 0, 1];
		return mul(Rz, W);
	}
	// Jacobi eigen-decomposition of a symmetric 3x3; returns the unit eigenvector of the smallest eigenvalue
	function smallestEigenvector(A) {
		const a = A.slice(), V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
		for (let sweep = 0; sweep < 30; sweep++) {
			for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
				const apq = a[3 * p + q]; if (Math.abs(apq) < 1e-15) continue;
				const th = 0.5 * Math.atan2(2 * apq, a[3 * q + q] - a[3 * p + p]), c = Math.cos(th), s = Math.sin(th);
				const J = [1, 0, 0, 0, 1, 0, 0, 0, 1]; J[3 * p + p] = c; J[3 * q + q] = c; J[3 * p + q] = s; J[3 * q + p] = -s;
				const Jt = [J[0], J[3], J[6], J[1], J[4], J[7], J[2], J[5], J[8]];
				const r = mul(Jt, mul(a, J)); for (let j = 0; j < 9; j++) a[j] = r[j];
				const v = mul(V, J); for (let j = 0; j < 9; j++) V[j] = v[j];
			}
		}
		const k = [0, 1, 2].reduce((m, i) => (a[4 * i] < a[4 * m] ? i : m), 0);
		return [V[k], V[3 + k], V[6 + k]];
	}
	function makeLayout(lon0, lat0) {
		const W = equatorRotation(lon0, lat0), lon = new Uint16Array(N), lat = new Uint16Array(N), ll = new Uint16Array(2 * N);
		for (let i = 0; i < N; i++) { const [a, b] = toLL(apply(W, toXyz(lon0[i], lat0[i]))); lon[i] = a; lat[i] = b; ll[2 * i] = a; ll[2 * i + 1] = b; }
		const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, ll, gl.STATIC_DRAW);
		return { lon, lat, buf: b, W };
	}
	function bindLayouts(from, to) {
		gl.bindVertexArray(ptVao);
		for (const [name, L] of [['aLL', from], ['aLL2', to]]) {
			const loc = gl.getAttribLocation(ptProg, name);
			gl.bindBuffer(gl.ARRAY_BUFFER, L.buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.UNSIGNED_SHORT, true, 0, 0);
		}
	}
	function upload(buf) {
		gl.bindVertexArray(ptVao);
		layouts.similarity = makeLayout(new Uint16Array(buf, 0, N), new Uint16Array(buf, 2 * N, N));
		bindLayouts(layouts.similarity, layouts.similarity);
		gl.bindVertexArray(ptVao);
		let loc;
		cidx = Uint32Array.from(grp);  // colour slot per reference; view() rewrites it
		cidxBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cidxBuf); gl.bufferData(gl.ARRAY_BUFFER, cidx, gl.DYNAMIC_DRAW);
		loc = gl.getAttribLocation(ptProg, 'aGrp'); gl.enableVertexAttribArray(loc); gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_INT, 0, 0);
		selBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, selBuf); gl.bufferData(gl.ARRAY_BUFFER, sel, gl.DYNAMIC_DRAW);
		loc = gl.getAttribLocation(ptProg, 'aSel'); gl.enableVertexAttribArray(loc); gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_BYTE, 0, 0);
		flagBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, flagBuf); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(N), gl.STATIC_DRAW);
		loc = gl.getAttribLocation(ptProg, 'aFlag'); gl.enableVertexAttribArray(loc); gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_BYTE, 0, 0);
		const S = layouts.similarity;
		S.xyz = new Float32Array(3 * N); [S.start, S.idx] = cellIndex(S.lon, S.lat, N, S.xyz);
	}
	// unit vectors + 1-degree lon/lat cells for hover lookup
	function cellIndex(lon, lat, n, out) {
		const cell = new Int32Array(n), cnt = new Int32Array(360 * 180 + 1);
		for (let i = 0; i < n; i++) {
			const lo = lon[i] / 65535 * 2 * Math.PI - Math.PI, la = lat[i] / 65535 * Math.PI - Math.PI / 2;
			out[3 * i] = Math.cos(la) * Math.cos(lo); out[3 * i + 1] = Math.cos(la) * Math.sin(lo); out[3 * i + 2] = Math.sin(la);
			const c = Math.min(179, Math.floor(lat[i] / 65536 * 180)) * 360 + Math.min(359, Math.floor(lon[i] / 65536 * 360));
			cell[i] = c; cnt[c + 1]++;
		}
		for (let c = 0; c < 360 * 180; c++) cnt[c + 1] += cnt[c];
		const start = cnt.slice(), idx = new Int32Array(n), cur = cnt.slice(0, -1);
		for (let i = 0; i < n; i++) idx[cur[cell[i]]++] = i;
		return [start, idx];
	}
	function buildIndex(lon, lat) {
		xyz = xyz || new Float32Array(3 * N);
		[cellStart, cellIdx] = cellIndex(lon, lat, N, xyz);
		buildLabels();
	}
	// nearest point within 8 px of the cursor, from a cell index
	function nearestIn(p, pts, start, idx, skip) {
		const pxPerRad = (scale()[0] * canvas.clientWidth) / 2 * (flat ? 0.9 : 1);
		return nearestWithin(p, pts, start, idx, 8 / pxPerRad, skip);
	}
	// nearest point within thr radians of unit vector p
	function nearestWithin(p, pts, start, idx, thr, skip) {
		const cosT = Math.cos(thr);
		const lat = Math.asin(Math.max(-1, Math.min(1, p[2]))) * 180 / Math.PI, lon = Math.atan2(p[1], p[0]) * 180 / Math.PI;
		const dl = thr * 180 / Math.PI, cj = Math.floor(lon + 180);
		const r0 = Math.max(0, Math.floor(lat + 90 - dl)), r1 = Math.min(179, Math.floor(lat + 90 + dl));
		const wl = Math.abs(lat) + dl > 85 ? 180 : Math.ceil(dl / Math.max(0.05, Math.cos((Math.abs(lat) + dl) * Math.PI / 180))) + 1;
		let best = -1, bd = cosT;
		for (let r = r0; r <= r1; r++) for (let dj = -wl; dj <= wl; dj++) {
			const c = r * 360 + ((cj + dj) % 360 + 360) % 360;
			for (let k = start[c]; k < start[c + 1]; k++) {
				const i = idx[k];
				if (skip(i)) continue;
				const d = pts[3 * i] * p[0] + pts[3 * i + 1] * p[1] + pts[3 * i + 2] * p[2];
				if (d > bd) { bd = d; best = i; }
			}
			if (wl === 180) break;
		}
		return best;
	}

	// ---------- place names: domain, phylum, family, genus; each shown once its territory is big enough on screen
	let labelSets = [], labelPool = [], labelsOn = true;
	const SKIP = /^(|\?|other|incertae sedis|uncultured.*|unidentified.*|unclassified.*|metagenome.*|.*environmental sample.*)$/i;
	function buildLabels() {
		const domName = meta.groups.map((g) => g.split(' · ')[0]);
		const doms = [...new Set(domName)], dIx = domName.map((d) => doms.indexOf(d));
		const levels = [
			{ cls: 'L0', names: doms, code: (i) => dIx[grp[i]] ?? -1, min: 1000 },
			{ cls: 'L1', names: meta.groups.map((g) => g.split(' · ')[1] || g), code: (i) => grp[i], min: 200 },
			{ cls: 'L2', names: meta.lineages, code: (i) => lin[i], min: 40 },
			{ cls: 'L3', names: meta.genera, code: (i) => gen[i], min: 25 },
			{ cls: 'L4', names: meta.species, code: (i) => spc[i], min: 5 }
		];
		labelSets = levels.map((L) => {
			const G = L.names.length, sum = new Float64Array(3 * G), n = new Int32Array(G);
			for (let i = 0; i < N; i++) { const g = L.code(i); if (g < 0 || g >= G) continue; n[g]++; sum[3 * g] += xyz[3 * i]; sum[3 * g + 1] += xyz[3 * i + 1]; sum[3 * g + 2] += xyz[3 * i + 2]; }
			const c = new Float64Array(3 * G);
			for (let g = 0; g < G; g++) { const l = Math.hypot(sum[3 * g], sum[3 * g + 1], sum[3 * g + 2]) || 1; for (let k = 0; k < 3; k++) c[3 * g + k] = sum[3 * g + k] / l; }
			// anchor at the member nearest the centroid (a scattered group's centroid can sit in open ocean); spread = mean angle
			const best = new Float64Array(G).fill(-2), at = new Int32Array(G).fill(-1), dsum = new Float64Array(G);
			for (let i = 0; i < N; i++) {
				const g = L.code(i); if (g < 0 || g >= G || n[g] < L.min) continue;
				const d = xyz[3 * i] * c[3 * g] + xyz[3 * i + 1] * c[3 * g + 1] + xyz[3 * i + 2] * c[3 * g + 2];
				dsum[g] += Math.acos(Math.max(-1, Math.min(1, d)));
				if (d > best[g]) { best[g] = d; at[g] = i; }
			}
			const out = [];
			for (let g = 0; g < G; g++) {
				if (n[g] < L.min || at[g] < 0 || SKIP.test(L.names[g])) continue;
				const i = at[g];
				out.push({ text: L.names[g], cls: L.cls, n: n[g], spread: dsum[g] / n[g], p: [xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]] });
			}
			out.sort((a, b) => b.n - a.n);
			return out;
		});
		dirty = true;
	}
	function placeLabels() {
		const box = $('labels');
		if (!labelSets.length || morph || !labelsOn) { for (const el of labelPool) el.hidden = true; return; }
		const w = canvas.clientWidth, h = canvas.clientHeight, sc = scale();
		const pxR = sc[0] * w / 2 * (flat ? 0.9 : 1), minDim = Math.min(w, h);
		const taken = [], GAPX = 22, GAPY = 12;
		let used = 0;
		const fits = (x0, y0, x1, y1) => { for (const r of taken) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false; return true; };
		for (const set of labelSets) {
			let shownHere = 0;
			for (const L of set) {
				if (used >= 55 || shownHere >= 20) break;  // about a third of the earlier 160 / 60
				const rpx = L.spread * pxR;
				if (rpx < 26 || rpx > 0.9 * minDim) continue;
				const p = L.p, q = [0, 1, 2].map((j) => rot[3 * j] * p[0] + rot[3 * j + 1] * p[1] + rot[3 * j + 2] * p[2]);
				let x, y;
				if (!flat) { if (q[2] < 0.15) continue; x = q[0]; y = q[1]; }
				else {
					const lam = Math.atan2(q[0], q[2]), phi = Math.asin(Math.max(-1, Math.min(1, q[1])));
					let t = phi; for (let k = 0; k < 6; k++) t -= (2 * t + Math.sin(2 * t) - Math.PI * Math.sin(phi)) / (2 + 2 * Math.cos(2 * t) + 1e-6);
					x = 0.9003163 * lam * Math.cos(t) * 0.5; y = 1.4142136 * Math.sin(t) * 0.5;
				}
				const sx = (x * sc[0] + 1) / 2 * w, sy = (1 - y * sc[1]) / 2 * h;
				const fs = L.cls === 'L0' ? 17 : L.cls === 'L1' ? 13.6 : L.cls === 'L4' ? 11.8 : 12.5, cw = L.cls === 'L0' ? fs * 0.95 : fs * 0.56;
				const tw = L.text.length * cw, th = fs * 1.3;
				const x0 = sx - tw / 2, y0 = sy - th / 2;
				// each label keeps a clear margin (GAPX, GAPY) around it, so the ones shown spread over the globe
				if (x0 < 4 || y0 < 4 || x0 + tw > w - 4 || y0 + th > h - 4 || !fits(x0 - GAPX, y0 - GAPY, x0 + tw + GAPX, y0 + th + GAPY)) continue;
				taken.push([x0 - GAPX, y0 - GAPY, x0 + tw + GAPX, y0 + th + GAPY]);
				let el = labelPool[used];
				if (!el) { el = document.createElement('span'); box.appendChild(el); labelPool.push(el); }
				if (el.textContent !== L.text) el.textContent = L.text;
				if (el.className !== L.cls) el.className = L.cls;
				el.style.transform = `translate(${x0.toFixed(1)}px, ${y0.toFixed(1)}px)`;
				el.hidden = false; used++; shownHere++;
			}
		}
		for (let k = used; k < labelPool.length; k++) labelPool[k].hidden = true;
	}

	// ---------- draw
	let dirty = true, morph = null, current = 'sculpt', flagMode = false, flags = null, majg = null, flagBuf = null;
	// the data version goes on every URL, so a rebuilt globe is fetched fresh whatever a browser has cached
	const url = (name) => `${base}/${name}` + (version ? `?v=${encodeURIComponent(version)}` : '');
	async function fetchBin(name) {
		const r = await fetch(url(name));
		if (!r.ok) throw new Error(`${r.status} ${name}`);
		return new Uint8Array(await r.arrayBuffer());
	}
	async function setColour(mode) {
		if (mode && !flags) {
			$('status').textContent = 'Loading label checks…';
			let b;
			try { b = await fetchBin('flags.bin'); } catch { $('status').textContent = 'The label checks did not load. Try again.'; return; }
			if (!alive) return;
			flags = b.subarray(0, N); majg = b.subarray(N, 2 * N);
			gl.bindBuffer(gl.ARRAY_BUFFER, flagBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, flags);
		}
		flagMode = mode;
		$('cTax').setAttribute('aria-pressed', mode ? 'false' : 'true'); $('cFlag').setAttribute('aria-pressed', mode ? 'true' : 'false');
		if (mode) {
			let d = 0, p = 0; for (let i = 0; i < N; i++) { if (flags[i] === 2) d++; else if (flags[i] === 1) p++; }
			$('status').innerHTML = `<span class="dot red"></span>${d.toLocaleString()} labelled with the wrong domain · <span class="dot amber"></span>${p.toLocaleString()} with the wrong phylum, judging by their 15 nearest neighbours`;
		} else $('status').textContent = IDLE;
		dirty = true;
	}
	const SCULPT = `Sculpted: each ${unitOne} is gently pulled toward its domain, phylum, class and order.${runs.length ? ' ASVs sit on their nearest reference.' : ''}`;
	async function showLayout(name) {
		if (name === current || morph) return;
		if (!layouts[name]) {
			$('status').textContent = 'Loading the sculpted layout…';
			let b;
			try { b = await fetchBin(`layout_${name}.bin`); } catch { $('status').textContent = 'The sculpted layout did not load. Try again.'; return; }
			if (!alive) return;
			layouts[name] = makeLayout(new Uint16Array(b.buffer, 0, N), new Uint16Array(b.buffer, 2 * N, N));
			if (asv) asvLayout(name);
		}
		$('status').textContent = name === 'sculpt' ? SCULPT : 'Placed by sequence similarity alone.';
		bindLayouts(layouts[current], layouts[name]);
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		morph = { to: layouts[name], t0: performance.now(), dur: reduce ? 1 : 2200, t: 0 };
		current = name;
		for (const [id, n] of [['lSim', 'similarity'], ['lSculpt', 'sculpt']]) $(id).setAttribute('aria-pressed', n === name ? 'true' : 'false');
	}
	function draw() {
		const sc = scale();
		gl.clearColor(0.008, 0.024, 0.090, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
		gl.useProgram(bgProg); gl.bindVertexArray(bgVao);
		gl.uniformMatrix3fv(gl.getUniformLocation(bgProg, 'uRot'), true, rot);
		gl.uniform1f(gl.getUniformLocation(bgProg, 'uFlat'), flat ? 1 : 0);
		gl.uniform2f(gl.getUniformLocation(bgProg, 'uScale'), sc[0], sc[1]);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		if (!layouts.similarity) return;  // N is known before the buffers are
		gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
		gl.useProgram(ptProg); gl.bindVertexArray(ptVao);
		gl.uniformMatrix3fv(gl.getUniformLocation(ptProg, 'uRot'), true, rot);
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uFlat'), flat ? 1 : 0);
		gl.uniform2f(gl.getUniformLocation(ptProg, 'uScale'), sc[0], sc[1]);
		const dpr = canvas.width / Math.max(1, canvas.clientWidth);
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uSize'), +$('size').value * dpr * Math.pow(zoom, 0.45));
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uAlpha'), +$('alpha').value * (asvShown() ? 0.28 : 1));
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uHasSel'), hasSel ? 1 : 0);
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uMode'), flagMode ? 1 : 0);
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uMix'), morph ? morph.t : 0);
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, colTex);
		gl.uniform1i(gl.getUniformLocation(ptProg, 'uColTex'), 0);
		gl.drawArrays(gl.POINTS, 0, N);
		if (asvShown()) {
			gl.disable(gl.DEPTH_TEST);
			gl.useProgram(asvProg); gl.bindVertexArray(asv.vao);
			gl.uniformMatrix3fv(gl.getUniformLocation(asvProg, 'uRot'), true, rot);
			gl.uniform1f(gl.getUniformLocation(asvProg, 'uFlat'), flat ? 1 : 0);
			gl.uniform2f(gl.getUniformLocation(asvProg, 'uScale'), sc[0], sc[1]);
			gl.uniform1f(gl.getUniformLocation(asvProg, 'uSize'), +$('size').value * dpr * Math.pow(zoom, 0.45));
			gl.drawArrays(gl.POINTS, 0, asv.n);
		}
	}
	let last = performance.now(), raf = 0;
	function frame(t) {
		if (!alive) return;
		const dt = Math.min(0.1, (t - last) / 1000); last = t;
		if (spin && !dragging) { rot = mul(rotY(0.06 * dt / Math.sqrt(zoom)), rot); dirty = true; }
		if (morph) {
			const u = Math.min(1, (t - morph.t0) / morph.dur);
			morph.t = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
			dirty = true;
			if (u >= 1) { const L = morph.to; morph = null; bindLayouts(L, L); buildIndex(L.lon, L.lat); if (asv) bindAsvLayout(current); }
		}
		if (dirty) { draw(); placeLabels(); dirty = false; }
		raf = requestAnimationFrame(frame);
	}

	// ---------- interaction
	let dragging = false, moved = 0, lastP = null;
	const pointers = new Map();
	function stopSpin() { if (spin) { spin = false; $('spin').setAttribute('aria-pressed', 'false'); $('spin').textContent = 'Spin'; } }
	on(canvas, 'pointerdown', (e) => {
		canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
		dragging = true; moved = 0; lastP = [e.clientX, e.clientY]; canvas.classList.add('dragging'); $('tip').hidden = true;
	});
	on(canvas, 'pointermove', (e) => {
		if (!pointers.has(e.pointerId)) { hover(e.clientX, e.clientY); return; }
		const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()], o = [...pointers.entries()].find(([k]) => k !== e.pointerId)[1];
			const d0 = Math.hypot(prev[0] - o[0], prev[1] - o[1]), d1 = Math.hypot(a[0] - b[0], a[1] - b[1]);
			if (d0 > 0) setZoom(zoom * d1 / d0);
			moved += 10; return;
		}
		const dx = e.clientX - lastP[0], dy = e.clientY - lastP[1]; lastP = [e.clientX, e.clientY];
		moved += Math.abs(dx) + Math.abs(dy);
		if (moved > 3) stopSpin();
		const px = (scale()[0] * canvas.clientWidth) / 2;  // pixels per unit radius
		rot = mul(rotY(dx / px), mul(rotX(dy / px), rot)); dirty = true;
	});
	function endPointer(e) {
		pointers.delete(e.pointerId);
		if (pointers.size === 0) {
			dragging = false; canvas.classList.remove('dragging');
			if (moved < 4 && e.type === "pointerup") pickPoint(e.clientX, e.clientY);
		} else lastP = [...pointers.values()][0];
	}
	on(canvas, 'pointerup', endPointer); on(canvas, 'pointercancel', endPointer);
	on(canvas, 'pointerleave', () => { if (!dragging) $('tip').hidden = true; });
	function setZoom(z) { zoom = Math.max(0.6, Math.min(80, z)); dirty = true; }
	on(canvas, 'wheel', (e) => { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
	on(canvas, 'dblclick', (e) => {
		const p = screenToWorld(e.clientX, e.clientY); if (!p) return;
		stopSpin(); centreOn(Math.atan2(p[1], p[0]), Math.asin(Math.max(-1, Math.min(1, p[2])))); setZoom(zoom * 1.6);
	});

	// screen -> world unit vector (or null off the map)
	function screenToWorld(cx, cy) {
		const r = canvas.getBoundingClientRect(), sc = scale();
		const x = ((cx - r.left) / r.width * 2 - 1) / sc[0], y = (1 - (cy - r.top) / r.height * 2) / sc[1];
		let q;
		if (!flat) { const r2 = x * x + y * y; if (r2 > 1) return null; q = [x, y, Math.sqrt(1 - r2)]; }
		else {
			const mx = 2 * x, my = 2 * y, st = my / Math.SQRT2; if (Math.abs(st) > 1) return null;
			const t = Math.asin(st), lam = mx / (0.9003163 * Math.cos(t)); if (Math.abs(lam) > Math.PI) return null;
			const phi = Math.asin(Math.max(-1, Math.min(1, (2 * t + Math.sin(2 * t)) / Math.PI)));
			q = [Math.cos(phi) * Math.sin(lam), Math.sin(phi), Math.cos(phi) * Math.cos(lam)];
		}
		return [0, 1, 2].map((j) => rot[j] * q[0] + rot[3 + j] * q[1] + rot[6 + j] * q[2]);  // rot^T q
	}
	function nearest(cx, cy) {
		const p = screenToWorld(cx, cy); if (!p || !N) return -1;
		return nearestIn(p, xyz, cellStart, cellIdx, (i) => hasSel && !sel[i]);
	}
	function nearestAsv(cx, cy) {
		const p = screenToWorld(cx, cy); if (!p) return -1;
		return nearestIn(p, asv.xyz, asv.cellStart, asv.cellIdx, (i) => !asv.runOn[asv.run[i]]);
	}
	function placeTip(tip, cx, cy) {
		tip.style.left = cx + 'px'; tip.style.top = cy + 'px'; tip.style.transform = 'translate(14px, 14px)'; tip.hidden = false;
		const r = tip.getBoundingClientRect();
		tip.style.transform = `translate(${r.right > innerWidth - 8 ? -r.width - 14 : 14}px, ${r.bottom > innerHeight - 8 ? -r.height - 14 : 14}px)`;
	}
	let hoverReq = 0;
	function hover(cx, cy) {
		if (hoverReq) return;
		hoverReq = requestAnimationFrame(() => {
			hoverReq = 0;
			const tip = $('tip');
			if (asvShown()) {
				const a = nearestAsv(cx, cy);
				if (a >= 0) {
					const t = asv.taxa[asv.tax[a]].split(';').filter(Boolean);
					const run = runs[asv.run[a]];
					tip.innerHTML = '<div class="g"></div><div></div><div class="m"></div><div class="m"></div>';
					tip.children[0].textContent = t.length > 1 ? t[t.length - 1] : (t[0] || 'Unclassified');
					tip.children[1].textContent = t.slice(0, -1).join(' › ');
					tip.children[2].textContent = `${asv.ids[a]} · ${asv.reads[a].toLocaleString()} reads in ${asv.ns[a].toLocaleString()} samples`;
					tip.children[3].textContent = `${run.name} · ${regionName(asv.regions[asv.reg[a]])}`;
					placeTip(tip, cx, cy);
					return;
				}
			}
			const i = nearest(cx, cy);
			if (i < 0) { tip.hidden = true; return; }
			const g = meta.genera[gen[i]], sp = meta.species[spc[i]], gr = meta.groups[grp[i]] || 'other';
			const ln = meta.lineages[lin[i]], lr = { f: 'family', o: 'order', c: 'class', p: 'phylum' }[meta.lineageRank[lin[i]]];
			tip.innerHTML = '<div class="g"></div><div></div><div class="m"></div>';
			tip.children[0].textContent = sp || (g ? g + ' sp.' : 'Unclassified genus');
			tip.children[1].textContent = ln ? `${lr} ${ln}` : '';
			tip.children[2].textContent = gr.replace(' · ', ' › ');
			if (flags && flags[i] > 0) {
				const d = document.createElement('div'); d.className = 'w';
				d.textContent = `Labelled ${gr.split(' · ')[1] || gr}, but its neighbours are ${(meta.groups[majg[i]] || 'other').replace(' · ', ' › ')}`;
				tip.appendChild(d);
			}
			placeTip(tip, cx, cy);
		});
	}

	// ---------- taxa: rank codes per reference, the picker's view
	// rank 0 domain (from the group), 1-4 phylum..family (ranks.bin), 5 genus, 6 species (tax.bin); NONE = unranked
	const rankCode = (r, i) => r === 0 ? domIx[grp[i]] : r <= 4 ? rankArr[r - 1][i] : r === 5 ? gen[i] : spc[i];
	function lineageOf(i) {
		const out = [];
		for (let r = 0; r < rankNames.length; r++) { const c = rankCode(r, i); if (c !== NONE && rankNames[r][c] != null) out.push({ rank: r, code: c, name: rankNames[r][c] }); }
		return out;
	}
	// every (rank, code) a name is used at, with its reference count, biggest first
	let byName = null;
	function namesIndex() {
		byName = new Map();
		rankNames.forEach((names, r) => {
			const n = new Int32Array(names.length);
			for (let i = 0; i < N; i++) { const c = rankCode(r, i); if (c !== NONE) n[c]++; }
			names.forEach((name, c) => {
				if (name == null) return;
				const k = name.toLowerCase();
				if (!byName.has(k)) byName.set(k, []);
				byName.get(k).push({ rank: r, code: c, count: n[c] });
			});
		});
		for (const v of byName.values()) v.sort((a, b) => b.count - a.count);
	}
	const uses = (name) => byName.get((name || '').toLowerCase()) || [];
	// the most-used taxon of that name (exact, case-insensitive) and the lineage above it: at each higher rank
	// the taxon most of its members carry, so a few mislabelled references cannot hang it under the wrong domain
	function find(name) {
		const hit = uses(name)[0];
		if (hit) {
			const r = hit.rank, c = hit.code;
			const tally = Array.from({ length: r }, () => new Map());
			for (let i = 0; i < N; i++) {
				if (rankCode(r, i) !== c) continue;
				for (let q = 0; q < r; q++) { const k = rankCode(q, i); tally[q].set(k, (tally[q].get(k) || 0) + 1); }
			}
			const out = [];
			tally.forEach((m, q) => {
				let best = NONE, n = -1;
				for (const [k, v] of m) if (k !== NONE && v > n) { best = k; n = v; }
				if (best !== NONE) out.push({ rank: q, code: best, name: rankNames[q][best] });
			});
			out.push({ rank: r, code: c, name: rankNames[r][c] });
			return out;
		}
		return null;
	}
	const count = (name) => uses(name)[0]?.count ?? 0;
	function describe(name) {
		const u = uses(name);
		if (!u.length) return '';
		return `${meta.ranks.levels[u[0].rank]} · ${u[0].count.toLocaleString()}` + (u.length > 1 ? ` (+${u.length - 1} more)` : '');
	}
	function view(level, filter) {
		if (!rankArr) return [];
		const counts = new Map();
		let members = 0;
		for (let i = 0; i < N; i++) {
			const inside = (!filter || rankCode(filter.rank, i) === filter.code) && (trait < 0 || (traits[i] >> trait) & 1);
			sel[i] = inside ? 1 : 0;
			if (!inside) continue;
			members++;
			const c = rankCode(level, i);
			counts.set(c, (counts.get(c) || 0) + 1);
		}
		hasSel = (!!filter || trait >= 0) && members < N;
		const ranked = [...counts].sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1] - a[1])
			.map(([code, count]) => ({ code, count, name: code === NONE ? 'unclassified' : rankNames[level][code] }));
		// every listed taxon gets its own slot and colour; unclassified is the bright one
		const palette = generatePalette(ranked.length), slot = new Map(), cols = new Float32Array(3 * Math.max(1, ranked.length));
		ranked.forEach((t, k) => {
			const c = t.code === NONE ? BRIGHT : palette[k];
			t.color = css(c);
			slot.set(t.code, k); cols.set(c, 3 * k);
		});
		setColours(cols);
		const outside = ranked.length;  // points outside the filter are dimmed; any colour will do
		for (let i = 0; i < N; i++) { const k = slot.get(rankCode(level, i)); cidx[i] = k === undefined ? outside : k; }
		gl.bindBuffer(gl.ARRAY_BUFFER, cidxBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, cidx);
		gl.bindBuffer(gl.ARRAY_BUFFER, selBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, sel);
		// ASVs: kept when their lineage names the filter taxon; counted against each listed taxon by name
		asvFilter = filter ? norm(rankNames[filter.rank][filter.code]) : '';
		if (asv) {
			const byName = new Map(ranked.map((t) => [norm(t.name), t]));
			for (const t of ranked) t.asvs = 0;
			for (let j = 0; j < asv.n; j++) {
				const comps = asv.comps[asv.tax[j]];
				if (asvFilter && !comps.has(asvFilter)) continue;
				for (const c of comps) { const t = byName.get(c); if (t) t.asvs++; }
			}
			syncAsvOn();
		}
		const what = [filter ? rankNames[filter.rank][filter.code] : '', trait >= 0 ? TRAIT_LABEL[meta.traits[trait]] || meta.traits[trait] : ''].filter(Boolean).join(' · ');
		$('status').textContent = what ? `${what} · ${members.toLocaleString()} ${unit}` : IDLE;
		dirty = true;
		return ranked;
	}
	function pickPoint(cx, cy) {
		const i = nearest(cx, cy);
		if (i >= 0 && rankArr) onPick(lineageOf(i).filter((x) => x.rank <= 5));
	}
	on(window, 'keydown', (e) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) onClear(); });
	const press = (a, b, v) => { $(a).setAttribute('aria-pressed', v ? 'true' : 'false'); $(b).setAttribute('aria-pressed', v ? 'false' : 'true'); };
	on($('vGlobe'), 'click', () => { flat = false; press('vGlobe', 'vFlat', true); dirty = true; });
	on($('vFlat'), 'click', () => { flat = true; press('vGlobe', 'vFlat', false); dirty = true; });
	on($('spin'), 'click', () => { spin = !spin; $('spin').setAttribute('aria-pressed', spin ? 'true' : 'false'); $('spin').textContent = spin ? 'Pause spin' : 'Spin'; });
	on($('labelsBtn'), 'click', () => { labelsOn = !labelsOn; $('labelsBtn').setAttribute('aria-pressed', labelsOn ? 'true' : 'false'); dirty = true; });
	on($('lSim'), 'click', () => showLayout('similarity'));
	on($('lSculpt'), 'click', () => showLayout('sculpt'));
	on($('cTax'), 'click', () => setColour(false));
	on($('cFlag'), 'click', () => setColour(true));
	on($('asvBtn'), 'click', () => toggleAsv());
	on($('size'), 'input', () => (dirty = true)); on($('alpha'), 'input', () => (dirty = true));
	const ro = new ResizeObserver(() => resize()); ro.observe(canvas); cleanups.push(() => ro.disconnect());

	// ---------- amplicon runs: each run's ASVs as placed by PLACE_GLOBE
	let asv = null, asvOn = false;
	const asvShown = () => asv && asvOn && !morph;
	async function fetchJson(url) {
		const r = await fetch(url);
		if (!r.ok) throw new Error(`${r.status}`);
		return r.json();
	}
	// one run's placed ASVs: { reference, regions, taxa, asvs: [[id, lon, lat, region, reads, samples, taxon]] }
	async function loadRun(run) {
		const g = await fetchJson(`/earthdna/runs/${encodeURIComponent(run.id)}`);
		const rel = g.reference && g.reference.release;
		if (rel && String(rel) !== String(release)) return { skipped: `reference SILVA ${rel}` };
		return { globe: g };
	}
	async function loadAsvs() {
		const got = new Array(runs.length);
		let next = 0;
		const worker = async () => {
			while (next < runs.length) {
				const k = next++;
				try { got[k] = await loadRun(runs[k]); } catch (e) { got[k] = { skipped: `globe did not load (${e.message})` }; }
				if (alive) $('status').textContent = `Loading amplicon runs… ${got.filter(Boolean).length} of ${runs.length}`;
			}
		};
		await Promise.all(Array.from({ length: Math.min(4, runs.length) }, worker));
		if (!alive) return;
		const regions = [], regIx = new Map(), taxa = [''], taxIx = new Map([['', 0]]);
		let n = 0;
		for (const g of got) if (g.globe) n += g.globe.asvs.length;
		const lon = new Uint16Array(n), lat = new Uint16Array(n), reads = new Uint32Array(n), ns = new Uint32Array(n);
		const tax = new Uint32Array(n), run = new Uint16Array(n), reg = new Uint8Array(n), ids = new Array(n);
		const perRun = runs.map(() => ({ n: 0, regs: {} }));
		let i = 0;
		got.forEach((g, k) => {
			if (!g.globe) return;
			const rmap = g.globe.regions.map((r) => { if (!regIx.has(r)) { regIx.set(r, regions.length); regions.push(r); } return regIx.get(r); });
			const tmap = g.globe.taxa.map((t) => { if (!taxIx.has(t)) { taxIx.set(t, taxa.length); taxa.push(t); } return taxIx.get(t); });
			for (const [id, lo, la, rg, rd, sm, tx] of g.globe.asvs) {
				ids[i] = id;
				lon[i] = Math.round((lo + 180) / 360 * 65535); lat[i] = Math.round((la + 90) / 180 * 65535);
				reads[i] = rd; ns[i] = sm;
				tax[i] = tmap[tx]; run[i] = k; reg[i] = Math.min(255, rmap[rg]);
				perRun[k].n++; perRun[k].regs[reg[i]] = (perRun[k].regs[reg[i]] || 0) + 1;
				i++;
			}
		});
		const runCols = runs.map((_, k) => k < PALETTE.length ? hex(PALETTE[k]) : hsl((k * 137.5) % 360, 0.55, 0.62));
		asv = { n, lon, lat, reads, ns, tax, run, reg, ids, taxa, regions, runOn: new Uint8Array(runs.length).fill(1), onArr: new Uint8Array(n).fill(1) };
		// each distinct lineage as a set of its lowercased names, for the picker's filter and counts
		// (plus the current name of any retired one, since run taxonomies can predate the reference's names)
		asv.comps = taxa.map((s) => {
			const out = new Set();
			for (const x of s.split(';')) {
				const n = norm(x); if (!n) continue;
				out.add(n); for (const c of TAXON_SYNONYMS[n] || []) out.add(norm(c));
			}
			return out;
		});
		// placements are on the similarity map; turn them with it onto the equator-aligned frame
		const Ws = layouts.similarity.W;
		for (let j = 0; j < n; j++) { const [a, b] = toLL(apply(Ws, toXyz(lon[j], lat[j]))); lon[j] = a; lat[j] = b; }
		const sz = new Uint8Array(n), col = new Uint8Array(3 * n);
		for (let j = 0; j < n; j++) {
			sz[j] = Math.min(255, Math.round(Math.log10(1 + reads[j]) / 7 * 255));
			const c = runCols[run[j]]; col[3 * j] = c[0] * 255; col[3 * j + 1] = c[1] * 255; col[3 * j + 2] = c[2] * 255;
		}
		asv.vao = gl.createVertexArray(); gl.bindVertexArray(asv.vao);
		for (const [name, data, k, normed] of [['aCol', col, 3, true], ['aOn', asv.onArr, 1, false], ['aSz', sz, 1, false]]) {
			const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, name === 'aOn' ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
			if (name === 'aOn') asv.onBuf = buf;
			const loc = gl.getAttribLocation(asvProg, name); gl.enableVertexAttribArray(loc);
			if (normed) gl.vertexAttribPointer(loc, k, gl.UNSIGNED_BYTE, true, 0, 0);
			else gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_BYTE, 0, 0);
		}
		// each ASV's nearest reference on the similarity map, so it can follow the references into other layouts
		const S = layouts.similarity;
		asv.ref = new Int32Array(n);
		for (let j = 0; j < n; j++) {
			const q = toXyz(lon[j], lat[j]);
			let r = -1;
			for (const deg of [0.5, 2, 8, 30, 180]) { r = nearestWithin(q, S.xyz, S.start, S.idx, deg * Math.PI / 180, () => false); if (r >= 0) break; }
			asv.ref[j] = Math.max(0, r);
		}
		asv.layouts = { similarity: null };
		asvLayout('similarity');
		for (const name in layouts) if (name !== 'similarity') asvLayout(name);
		bindAsvLayout(current);
		const ul = asv.ul = $('runs');
		asv.skipped = [];
		runs.forEach((r, k) => {
			if (!got[k].globe) { asv.skipped.push(`${r.name}: ${got[k].skipped}`); return; }
			const li = document.createElement('li'), b = document.createElement('button');
			li.dataset.k = k;
			b.setAttribute('aria-pressed', 'true');
			b.innerHTML = '<span class="sw"></span><span><span class="ph"></span> <span class="dom"></span></span><span class="n"></span>';
			const c = runCols[k]; b.querySelector('.sw').style.background = `rgb(${c[0] * 255},${c[1] * 255},${c[2] * 255})`;
			b.querySelector('.ph').textContent = r.name;
			b.querySelector('.dom').textContent = [r.lab_name, ...Object.entries(perRun[k].regs).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([g]) => regionName(regions[g]))].join(' · ');
			b.querySelector('.n').textContent = perRun[k].n.toLocaleString();
			b.title = `/${r.slug}/`;
			on(b, 'click', (e) => {
				if (e.shiftKey || e.metaKey || e.ctrlKey) asv.runOn[k] ^= 1;
				else { const only = asv.runOn[k] && asv.runOn.reduce((x, y) => x + y, 0) === 1; asv.runOn.fill(only ? 1 : 0); asv.runOn[k] = 1; }
				syncAsvOn();
			});
			li.appendChild(b); ul.appendChild(li);
		});
		asv.shown = ul.children.length;
		// the search box: typing narrows the list (name, lab, regions); Enter turns on just the listed runs
		const q = $('runsearch'), none = $('runsnone');
		const text = Array.from(ul.children, (li) => li.textContent.toLowerCase());
		function filterRuns() {
			const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
			let shown = 0;
			Array.from(ul.children).forEach((li, j) => { const hit = words.every((w) => text[j].includes(w)); li.hidden = !hit; shown += hit; });
			none.hidden = shown > 0;
			$('nruns').textContent = words.length ? `${shown} of ${asv.shown}` : asv.shown;
		}
		on(q, 'input', filterRuns);
		on(q, 'keydown', (e) => {
			if (e.key === 'Escape') { q.value = ''; filterRuns(); e.stopPropagation(); }
			if (e.key !== 'Enter') return;
			const listed = Array.from(ul.children).filter((li) => !li.hidden).map((li) => +li.dataset.k);
			if (!listed.length) return;
			asv.runOn.fill(0); for (const k of listed) asv.runOn[k] = 1;
			syncAsvOn();
		});
		asv.filterRuns = filterRuns;
	}
	// an ASV's position in a layout: its own placement on the similarity map, its nearest reference's elsewhere
	function asvLayout(name) {
		const n = asv.n, L = layouts[name], lon = new Uint16Array(n), lat = new Uint16Array(n), ll = new Uint16Array(2 * n);
		for (let j = 0; j < n; j++) {
			lon[j] = name === 'similarity' ? asv.lon[j] : L.lon[asv.ref[j]]; lat[j] = name === 'similarity' ? asv.lat[j] : L.lat[asv.ref[j]];
			ll[2 * j] = lon[j]; ll[2 * j + 1] = lat[j];
		}
		const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, ll, gl.STATIC_DRAW);
		const xyzA = new Float32Array(3 * n), [start, idx] = cellIndex(lon, lat, n, xyzA);
		asv.layouts[name] = { buf, xyz: xyzA, start, idx };
	}
	function bindAsvLayout(name) {
		const A = asv.layouts[name]; if (!A) return;
		gl.bindVertexArray(asv.vao);
		const loc = gl.getAttribLocation(asvProg, 'aLL');
		gl.bindBuffer(gl.ARRAY_BUFFER, A.buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.UNSIGNED_SHORT, true, 0, 0);
		asv.xyz = A.xyz; asv.cellStart = A.start; asv.cellIdx = A.idx;
		dirty = true;
	}
	// an ASV shows when its run is on and its lineage names the picker's taxon
	function syncAsvOn() {
		for (let j = 0; j < asv.n; j++) asv.onArr[j] = asv.runOn[asv.run[j]] && (!asvFilter || asv.comps[asv.tax[j]].has(asvFilter)) ? 1 : 0;
		gl.bindBuffer(gl.ARRAY_BUFFER, asv.onBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, asv.onArr);
		for (const el of asv.ul.children) el.firstChild.setAttribute('aria-pressed', asv.runOn[+el.dataset.k] ? 'true' : 'false');
		dirty = true;
	}
	async function toggleAsv() {
		if (!runs.length) return;
		if (!asv) {
			$('asvBtn').disabled = true;
			await loadAsvs();
			if (!alive) return;
			$('asvBtn').disabled = false;
			syncAsvOn(); onAsvs();
		}
		asvOn = !asvOn;
		$('asvBtn').setAttribute('aria-pressed', asvOn ? 'true' : 'false');
		$('asvBtn').textContent = asvOn ? 'Hide amplicon runs' : 'Show amplicon runs';
		$('runcard').hidden = !asvOn;
		asv.filterRuns();
		const skip = asv.skipped.length ? ` · ${asv.skipped.length} not shown (${asv.skipped.join('; ')})` : '';
		$('status').textContent = asvOn ? `${asv.n.toLocaleString()} ASVs from ${asv.shown} amplicon runs, placed by sequence on the reference globe${skip}` : IDLE;
		dirty = true;
	}

	// ---------- load
	async function load() {
		const mres = await fetch(url('globe.json'));
		if (!mres.ok) throw new Error('data files missing');
		meta = await mres.json(); N = meta.n;
		// positions + group (5 bytes per sequence), streamed for a progress count
		const bres = await fetch(url('pos.bin'));
		if (!bres.ok) throw new Error('data files missing');
		const total = 5 * N, reader = bres.body.getReader(), parts = []; let got = 0;
		for (;;) {
			const { done, value } = await reader.read(); if (done) break;
			if (!alive) { reader.cancel(); return; }
			parts.push(value); got += value.length;
			$('loading').textContent = `Loading ${N.toLocaleString()} ${unit}… ${Math.min(100, Math.round(100 * got / total))}%`;
		}
		const ab = await new Blob(parts).arrayBuffer();
		if (ab.byteLength !== 5 * N) throw new Error('data file has the wrong size');
		grp = new Uint8Array(ab, 4 * N, N);
		$('loading').textContent = 'Loading the taxonomy…';
		const sculptReq = fetchBin('layout_sculpt.bin').catch(() => null);
		const ranksReq = fetchBin('ranks.bin');
		const tx = await fetchBin('tax.bin');
		const sb4 = meta.speciesBytes === 4;
		if (tx.length !== (sb4 ? 8 : 6) * N) throw new Error('taxonomy file has the wrong size');
		if (!alive) return;
		gen = new Uint16Array(tx.buffer, 0, N); lin = new Uint16Array(tx.buffer, 2 * N, N);
		if (sb4) {
			// more species than uint16 holds (GTDB): uint32 codes, 2^32-1 = none. Codes from 65535 up move up one and
			// 65535 becomes none, so every NONE check keeps working; the species list gets a gap at 65535 to match.
			const raw = new Uint32Array(tx.buffer, 4 * N, N);
			spc = new Uint32Array(N);
			for (let i = 0; i < N; i++) { const c = raw[i]; spc[i] = c === 0xffffffff ? NONE : c >= NONE ? c + 1 : c; }
			if (meta.species.length >= NONE) meta.species.splice(NONE, 0, null);
		} else spc = new Uint16Array(tx.buffer, 4 * N, N);
		sel = new Uint8Array(N);
		const ng = meta.groups.length;
		const doms = [...new Set(meta.groups.map((g) => g.split(' · ')[0]))];
		domIx = meta.groups.map((g) => doms.indexOf(g.split(' · ')[0]));
		const gcols = new Float32Array(3 * ng);
		for (let g = 0; g < ng; g++) gcols.set(g < PALETTE.length ? hex(PALETTE[g]) : hsl((g * 137.5) % 360, 0.32, 0.56), 3 * g);
		setColours(gcols);
		upload(ab);
		// the sculpted layout opens the page; the similarity map stands in if it did not load
		const sb = await sculptReq;
		if (!alive) return;
		if (sb && sb.length === 4 * N) {
			layouts.sculpt = makeLayout(new Uint16Array(sb.buffer, 0, N), new Uint16Array(sb.buffer, 2 * N, N));
			bindLayouts(layouts.sculpt, layouts.sculpt);
		} else current = 'similarity';
		for (const [id, n] of [['lSim', 'similarity'], ['lSculpt', 'sculpt']]) $(id).setAttribute('aria-pressed', n === current ? 'true' : 'false');
		buildIndex(layouts[current].lon, layouts[current].lat);
		// rank codes for the picker: domain (from the groups), phylum..family, genus, species. The globe opens
		// coloured by class (TaxonPicker's default), so it is coloured that way before it first shows.
		const rk = await ranksReq;
		if (!alive) return;
		if (rk.length !== 8 * N) throw new Error('rank file has the wrong size');
		rankArr = [0, 1, 2, 3].map((k) => new Uint16Array(rk.buffer, 2 * k * N, N));
		const R = meta.ranks;
		rankNames = [doms, ...R.levels.slice(1, 5).map((l) => R.names[l]), meta.genera, meta.species];
		if (meta.traits?.length) {
			// optional: a globe without traits.bin just has no Highlight control
			const tb = await fetchBin('traits.bin').catch(() => null);
			if (tb && tb.length === N) {
				traits = tb;
				const selEl = $('trait');
				for (const [k, name] of meta.traits.entries()) {
					let n = 0; for (let i = 0; i < N; i++) n += (tb[i] >> k) & 1;
					selEl.add(new Option(`${TRAIT_LABEL[name] || name} (${n.toLocaleString()})`, String(k)));
				}
				$('traitRow').hidden = false;
				on(selEl, 'change', () => { trait = +selEl.value; onRefresh(); });
			}
		}
		view(Math.max(0, R.levels.indexOf('class')), null);
		$('nseq').textContent = N.toLocaleString();
		$('loading').hidden = true; dirty = true;
		// amplicon runs load and show only when asked (Show amplicon runs)
		namesIndex();
		onTaxa({ levels: R.levels, names: rankNames, find, count, describe });
	}
	resize(); centreOn(0, 0.12); raf = requestAnimationFrame(frame);
	load().catch((e) => { if (alive) $('loading').textContent = `The ${unitOne} data did not load (${e.message}). Reload the page to try again.`; });

	const destroy = () => {
		alive = false;
		cancelAnimationFrame(raf); if (hoverReq) cancelAnimationFrame(hoverReq);
		for (const f of cleanups) f();
		gl.getExtension('WEBGL_lose_context')?.loseContext();
	};
	return { destroy, view };
}
