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
 *            With globe.json `records` (GTDB, all fragments), tax.bin, ranks.bin and traits.bin hold one entry per
 *            record (genome) and records.bin gives each point its record (uint32)
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
 * URL parameters (read once at mount):
 *   ?dome[=ALT]    open in the dome view, the looked-at point ALT degrees (default 40) above the dome's front horizon
 *   &labelScale=k  dome label size (default 1.5)
 *   &ui=0          hide the cards (for a projector or a dome)
 *   ?show=URL      play a keyframed show (static/earthdna/shows/; the format is above initShow), panels hidden
 *   ?wall=COLS&screen=I[&bezel=PX]  draw column I (0 = leftmost) of a picture COLS screens wide, full window, with PX css
 *                  pixels hidden behind each bezel (a multi-screen wall such as a Liquid Galaxy)
 *   ?sync=ROOM     follow the other screens in ROOM through /earthdna/sync/ROOM (see the sync section); &lead to lead at
 *                  start and take the 3D mouse, &navspeed=k its sensitivity
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
// phones turn the globe with taps and drags only (no point picking), so their hint points to the taxa list instead
const IDLE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
	? 'Drag to turn the globe. Pick a taxon in the list to highlight it.'
	: 'Drag to turn the globe. Click a point to copy its details; click empty space to clear a pick.';

// danaSeq viz's palette (illumina_amplicon/viz/src/stores/data.svelte.js), so a rank list reads the same in both: a spiral
// round the colour wheel (golden-angle hue steps, saturation and lightness cycling), one colour per taxon however many
function generatePalette(n) {
	const colors = [];
	for (let i = 0; i < n; i++) colors.push(hsl((120 + i * 137.508) % 360, (55 + (i % 3) * 15) / 100, (45 + (i % 4) * 8) / 100));
	return colors;
}
// unclassified is drawn bright, so it stands out from dimmed points
// camera distance (globe radii) and focal length of the globe's mild perspective; the shaders use the same
const CAM = 4.5, FOC = Math.sqrt(CAM * CAM - 1);
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
uniform mat3 uRot; uniform float uFlat; uniform vec2 uScale; uniform vec3 uCam; uniform vec2 uOff;
const float PI = 3.14159265;
float pDist = 1.0;  // dome: the point's distance from the camera, set by project()
// how squarely a point faces the viewer on the globe (1 centre, 0 limb; 1 everywhere on the flat map): points are
// shaded and shrunk by it like the ocean behind them, so the dots read as part of the sphere, not a flat sticker
float facing(vec3 p) { return uFlat < 0.5 ? clamp((uRot * p).z, 0.0, 1.0) : 1.0; }
float shade(vec3 p) { return 0.5 + 0.5 * facing(p); }
// dome: nearer points are drawn bigger instead (project() runs first and sets pDist)
float shrink(vec3 p) { return uFlat > 1.5 ? clamp(pow(pDist, -0.6), 0.5, 6.0) : 0.45 + 0.55 * sqrt(facing(p)); }
// world unit vector -> clip xy, visible flag.  uFlat: 0 globe, 1 equal-area, 2 dome
// globe: a mild perspective from a camera CAM radii away; FOC = sqrt(CAM^2 - 1) keeps the outline on the unit circle,
// and a point is visible when it is in front of the horizon seen from the camera (q.z > 1 / CAM)
const float CAM = 4.5, FOC = 4.3874822;
vec3 projectWall(vec3 p);
// on a wall (uOff), this screen's slice of the whole picture
vec3 project(vec3 p) { vec3 s = projectWall(p); s.xy += uOff; return s; }
vec3 projectWall(vec3 p) {
  vec3 q = uRot * p;
  if (uFlat > 1.5) {
    // dome: camera inside the sphere at uCam, looking at the zenith (+z); equidistant fisheye, 180 degrees across the
    // disc. Seen from inside, so x is mirrored relative to the globe
    vec3 v = q - uCam; pDist = length(v); v /= pDist;
    float r = acos(clamp(v.z, -1.0, 1.0)) / (0.5 * PI), s = length(v.xy);
    vec2 d = s > 1e-6 ? vec2(-v.x, v.y) / s : vec2(0.0);
    return vec3(d * r * uScale, r <= 1.0 ? 1.0 : 0.0);
  }
  if (uFlat < 0.5) return vec3(q.xy * (FOC / (CAM - q.z)) * uScale, q.z > 1.0 / CAM ? 1.0 : 0.0);
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
  gl_PointSize = s.z > 0.5 ? uSize * shrink(p) * ((on && uHasSel > 0.5) || flagged ? 1.6 : 1.0) : 0.0;
  vec3 c = texelFetch(uColTex, ivec2(int(aGrp % 2048u), int(aGrp / 2048u)), 0).rgb * shade(p);
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
  vec3 p = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat)), s = project(p);
  bool vis = s.z > 0.5 && aOn > 0u;
  gl_Position = vec4(s.xy, 0.0, vis ? 1.0 : 0.0);
  gl_PointSize = vis ? uSize * shrink(p) * (0.3 + float(aSz) / 255.0 * 29.7) : 0.0;  // 100x from the rarest ASV to the most read
  vCol = vec4(aCol * shade(p), 0.95);
}`, `#version 300 es
precision mediump float;
in vec4 vCol; out vec4 o;
void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; o = r > 0.15 ? vec4(vCol.rgb * 0.3, 0.9) : vCol; }`);
	// overlays: placed sequences (e.g. a run's nanopore reads), one flat colour each
	const ovProg = prog(`#version 300 es
in vec2 aLL;
uniform vec3 uCol; uniform float uSize, uAlpha;
out vec4 vCol;
${PROJ}
void main() {
  float lon = aLL.x * 2.0 * PI - PI, lat = aLL.y * PI - 0.5 * PI;
  vec3 p = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat)), s = project(p);
  gl_Position = vec4(s.xy, 0.0, s.z > 0.5 ? 1.0 : 0.0);
  gl_PointSize = s.z > 0.5 ? uSize * shrink(p) : 0.0;
  vCol = vec4(uCol * shade(p), uAlpha);
}`, `#version 300 es
precision mediump float;
in vec4 vCol; out vec4 o;
void main() { vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; o = vCol; }`);
	// coastlines under a map layout (globe.json geoLayouts): one instance per segment, both ends projected together so a
	// segment that crosses the equal-area map's seam, or runs over the globe's horizon, is dropped whole
	const coastProg = prog(`#version 300 es
in vec4 aSeg;
uniform float uAlpha;
out float vA;
${PROJ}
vec3 unit(vec2 d) { float lon = radians(d.x * 0.01), lat = radians(d.y * 0.01); return vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat)); }
void main() {
  vec3 a = unit(aSeg.xy), b = unit(aSeg.zw);
  vec3 sa = project(a), sb = project(b);
  bool vis = sa.z > 0.5 && sb.z > 0.5;
  if (uFlat > 0.5 && uFlat < 1.5) { vec3 qa = uRot * a, qb = uRot * b; vis = vis && abs(atan(qa.x, qa.z) - atan(qb.x, qb.z)) < 1.5; }
  vec3 s = gl_VertexID == 0 ? sa : sb, p = gl_VertexID == 0 ? a : b;
  gl_Position = vis ? vec4(s.xy, 0.9, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  vA = uAlpha * shade(p);
}`, `#version 300 es
precision mediump float;
in float vA; out vec4 o;
uniform vec3 uCol;
void main() { o = vec4(uCol, vA); }`);
	const bgProg = prog(`#version 300 es
in vec2 aP; out vec2 vP;
void main() { vP = aP; gl_Position = vec4(aP, 0.99, 1.0); }`, `#version 300 es
precision highp float;
in vec2 vP; out vec4 o;
uniform mat3 uRot; uniform float uFlat; uniform vec2 uScale; uniform vec3 uCam; uniform vec2 uOff;
uniform sampler2D uLandTex; uniform float uLand;
const float PI = 3.14159265, CAM = 4.5, FOC = 4.3874822;
// land under a map layout: the view-space point q back to the world, then the land mask (equirectangular, north up),
// filled in the coastlines' colour
vec3 land(vec3 c, vec3 q) {
  if (uLand <= 0.0) return c;
  vec3 p = transpose(uRot) * q;
  vec2 uv = vec2(atan(p.y, p.x) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(p.z, -1.0, 1.0)) / PI);
  return mix(c, vec3(0.62, 0.70, 0.80) * (0.6 + 0.4 * c.b / 0.157), 0.16 * uLand * texture(uLandTex, uv).r);
}
void main() {
  vec2 s = (vP - uOff) / uScale;
  vec3 ocean = vec3(0.047, 0.094, 0.157), space = vec3(0.008, 0.024, 0.090);
  if (uFlat > 1.5) {
    // dome master: the sphere's inside fills the disc, kept dark (a dome lights itself); black outside it
    float r = length(s);
    if (r > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
    // the fisheye backwards: the viewing direction for this pixel, then where its ray from the camera meets the sphere
    float th = r * 0.5 * PI; vec2 d = r > 1e-6 ? s / r : vec2(0.0);
    vec3 v = vec3(-d.x * sin(th), d.y * sin(th), cos(th));
    float b = dot(uCam, v), t = -b + sqrt(max(0.0, b * b - dot(uCam, uCam) + 1.0));
    o = vec4(land(ocean * 0.55, uCam + t * v), 1.0);
  } else if (uFlat < 0.5) {
    float r2 = dot(s, s);
    if (r2 > 1.0) { float h = exp(-(sqrt(r2) - 1.0) * 28.0); o = vec4(mix(space, vec3(0.16, 0.30, 0.48), h * 0.55), 1.0); return; }
    float shade = 0.55 + 0.45 * sqrt(1.0 - r2);
    // the perspective backwards: the ray from the camera through this pixel, to its nearer meeting with the sphere
    vec3 c = vec3(0.0, 0.0, CAM), v = normalize(vec3(s, -FOC));
    float b = dot(c, v), t = -b - sqrt(max(0.0, b * b - CAM * CAM + 1.0));
    o = vec4(land(ocean * shade, c + t * v), 1.0);
  } else {
    vec2 m = s * 2.0;
    float st = m.y / 1.4142136;
    if (abs(st) > 1.0) { o = vec4(space, 1.0); return; }
    float t = asin(st);
    float lam = m.x / (0.9003163 * cos(t));
    if (abs(lam) > PI) { o = vec4(space, 1.0); return; }
    float phi = asin(clamp((2.0 * t + sin(2.0 * t)) / PI, -1.0, 1.0));
    o = vec4(land(ocean, vec3(cos(phi) * sin(lam), sin(phi), cos(phi) * cos(lam))), 1.0);
  }
}`);

	// ---------- state
	const R0 = [0, 1, 0, 0, 0, 1, 1, 0, 0];  // world -> view: lon 0 / lat 0 faces the viewer, north up
	let rot = R0.slice(), zoom = 1, flat = false, spin = false;  // spin starts off; the Spin toggle turns it on
	let N = 0, meta = null, grp, gen, lin, spc, rec = null, LL, cellStart, cellIdx, selBuf, sel, hasSel = false;
	// genome traits (globe.json traits; GTDB: cultured, named, type_material): one byte per point, bit k = trait k
	// trait = bit highlighted (-1 none); traitNeg highlights the points without it (uncultured, unnamed)
	let traits = null, trait = -1, traitNeg = false;
	// a point's row in the taxonomy arrays: itself, or its record (genome) when the data come per record
	const T = (i) => rec ? rec[i] : i;
	const TRAIT_LABEL = { cultured: 'Cultured isolates', named: 'Named species', type_material: 'Type material' };
	const TRAIT_NOT = { cultured: 'Uncultured (MAGs, single cells)', named: 'Unnamed species' };
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
	const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
	const RAD = Math.PI / 180;
	const Q = new URLSearchParams(location.search);
	// dome: the audience sits inside the sphere. The point being looked at sits at the front of the dome, domeAlt degrees
	// above the horizon (the bottom of the frame is the front); zooming moves the camera from the centre toward it.
	let dome = false, domeAlt = +(Q.get('dome') || 0) || 40;
	const labelScale = +(Q.get('labelScale') || 1.5);
	function poseRot(lon, lat, roll) {  // radians
		const c = mul(rotZ(roll || 0), mul(rotX(lat), mul(rotY(-lon), R0)));
		return dome ? mul(rotX((90 - domeAlt) * RAD), c) : c;
	}
	function centreOn(lon, lat) { rot = poseRot(lon, lat, 0); }
	function aim() { const a = domeAlt * RAD; return [0, -Math.cos(a), Math.sin(a)]; }  // view-space direction looked at
	function cam() { const d = 1 - 1 / Math.max(1, zoom), a = aim(); return [d * a[0], d * a[1], d * a[2]]; }
	const toView = (p) => [0, 1, 2].map((j) => rot[3 * j] * p[0] + rot[3 * j + 1] * p[1] + rot[3 * j + 2] * p[2]);
	const toWorld = (q) => [0, 1, 2].map((j) => rot[j] * q[0] + rot[3 + j] * q[1] + rot[6 + j] * q[2]);
	const lookedAt = () => toWorld(dome ? aim() : [0, 0, 1]);
	function setView(mode) {  // 'globe' | 'flat' | 'dome', keeping the same place in view
		const p = lookedAt();
		flat = mode === 'flat'; dome = mode === 'dome';
		if (dome) zoom = Math.max(1, zoom);
		centreOn(Math.atan2(p[1], p[0]), Math.asin(Math.max(-1, Math.min(1, p[2]))));
		for (const [id, m] of [['vGlobe', 'globe'], ['vFlat', 'flat'], ['vDome', 'dome']]) $(id).setAttribute('aria-pressed', m === mode ? 'true' : 'false');
		dirty = true;
	}

	// ---------- wall (?wall=COLS&screen=I&bezel=PX): every screen works out the whole wall's picture (labels included,
	// so neighbouring screens agree) and draws its own column of it. All screens must be the same size.
	const WALL = Q.has('wall') ? { cols: Math.max(1, +Q.get('wall') || 1), i: Math.max(0, +(Q.get('screen') || 0)), bez: +(Q.get('bezel') || 0) } : null;
	const wallSpan = (w) => WALL ? WALL.cols * w + (WALL.cols - 1) * WALL.bez * w / Math.max(1, canvas.clientWidth) : w;  // in w's units
	const wallX0 = (w) => WALL ? WALL.i * (w + WALL.bez * w / Math.max(1, canvas.clientWidth)) : 0;  // this screen's left edge
	const wallOff = () => WALL ? (wallSpan(canvas.clientWidth) - 2 * wallX0(canvas.clientWidth)) / Math.max(1, canvas.clientWidth) - 1 : 0;  // clip x shift
	const wallMin = (w, h) => Math.min(wallSpan(w), h);
	function scale() {  // to this screen's clip space, before wallOff
		const w = canvas.width, h = canvas.height, W = wallSpan(w);
		if (dome) { const m = Math.min(W, h); return [m / w, m / h]; }  // the disc touches the frame; zoom is in cam()
		const b = flat ? Math.min(0.665 * W, 1.33 * h) : 0.92 * Math.min(W, h);  // pixels per two units of radius
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

	const layouts = {};  // name -> { ll, buf, W }
	// cos and sin of every uint16 longitude and latitude, so the per-point loops (millions of points) take no trig
	const COSLO = new Float64Array(65536), SINLO = new Float64Array(65536), COSLA = new Float64Array(65536), SINLA = new Float64Array(65536);
	for (let u = 0; u < 65536; u++) {
		const a = u / 65535 * 2 * Math.PI - Math.PI, b = u / 65535 * Math.PI - Math.PI / 2;
		COSLO[u] = Math.cos(a); SINLO[u] = Math.sin(a); COSLA[u] = Math.cos(b); SINLA[u] = Math.sin(b);
	}
	const toXyz = (lo, la) => [COSLA[la] * COSLO[lo], COSLA[la] * SINLO[lo], SINLA[la]];
	// dot product of point i of an interleaved lon, lat array with unit vector p (no stored unit vectors: 12 bytes a point)
	const dotLL = (ll, i, p0, p1, p2) => { const la = ll[2 * i + 1], lo = ll[2 * i]; return COSLA[la] * (COSLO[lo] * p0 + SINLO[lo] * p1) + SINLA[la] * p2; };
	const apply = (W, p) => [0, 1, 2].map((r) => W[3 * r] * p[0] + W[3 * r + 1] * p[1] + W[3 * r + 2] * p[2]);
	const toLL = (p) => [Math.round((Math.atan2(p[1], p[0]) + Math.PI) / (2 * Math.PI) * 65535), Math.round((Math.asin(Math.max(-1, Math.min(1, p[2]))) + Math.PI / 2) / Math.PI * 65535)];
	// Rotation that lays the domains along the equator: the pole is the axis the three domain centres sit
	// farthest from (smallest eigenvector of sum c c^T over their unit centres), then the largest domain is
	// turned to longitude 0.
	function equatorRotation(lon, lat) {
		const D = Math.max(...domIx) + 1, sum = new Float64Array(3 * D), n = new Int32Array(D);
		for (let i = 0; i < N; i++) {
			const d = domIx[grp[i]], cb = COSLA[lat[i]]; n[d]++;
			sum[3 * d] += cb * COSLO[lon[i]]; sum[3 * d + 1] += cb * SINLO[lon[i]]; sum[3 * d + 2] += SINLA[lat[i]];
		}
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
	// a layout turned onto the equator: interleaved uint16 lon, lat, kept as is and as its GL buffer
	// a layout of places on Earth (globe.json geoLayouts) keeps its own orientation
	function makeLayout(lon0, lat0, name) {
		const W = (meta.geoLayouts || []).includes(name) ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : equatorRotation(lon0, lat0), ll = new Uint16Array(2 * N), K1 = 65535 / (2 * Math.PI), K2 = 65535 / Math.PI;
		const [w0, w1, w2, w3, w4, w5, w6, w7, w8] = W;
		for (let i = 0; i < N; i++) {
			const cb = COSLA[lat0[i]], x = cb * COSLO[lon0[i]], y = cb * SINLO[lon0[i]], z = SINLA[lat0[i]];
			const X = w0 * x + w1 * y + w2 * z, Y = w3 * x + w4 * y + w5 * z, Z = w6 * x + w7 * y + w8 * z;
			const a = Math.round((Math.atan2(Y, X) + Math.PI) * K1), b = Math.round((Math.asin(Z > 1 ? 1 : Z < -1 ? -1 : Z) + Math.PI / 2) * K2);
			ll[2 * i] = a; ll[2 * i + 1] = b;
		}
		const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, ll, gl.STATIC_DRAW);
		return { ll, buf: b, W };
	}
	function bindLayouts(from, to) {
		gl.bindVertexArray(ptVao);
		for (const [name, L] of [['aLL', from], ['aLL2', to]]) {
			const loc = gl.getAttribLocation(ptProg, name);
			gl.bindBuffer(gl.ARRAY_BUFFER, L.buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.UNSIGNED_SHORT, true, 0, 0);
		}
	}
	// the similarity map (pos.bin), turned onto the equator the first time it is shown or runs are snapped to it:
	// the page opens on the sculpted layout, and each turn costs a pass over every point
	let simSrc = null;
	function similarity() {
		if (!layouts.similarity) layouts.similarity = makeLayout(new Uint16Array(simSrc, 0, N), new Uint16Array(simSrc, 2 * N, N), 'similarity');
		return layouts.similarity;
	}
	function upload(buf) {
		simSrc = buf;
		gl.bindVertexArray(ptVao);
		let loc;
		cidx = Uint32Array.from(grp);  // colour slot per reference; view() rewrites it
		cidxBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cidxBuf); gl.bufferData(gl.ARRAY_BUFFER, cidx, gl.DYNAMIC_DRAW);
		loc = gl.getAttribLocation(ptProg, 'aGrp'); gl.enableVertexAttribArray(loc); gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_INT, 0, 0);
		selBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, selBuf); gl.bufferData(gl.ARRAY_BUFFER, sel, gl.DYNAMIC_DRAW);
		loc = gl.getAttribLocation(ptProg, 'aSel'); gl.enableVertexAttribArray(loc); gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_BYTE, 0, 0);
		flagBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, flagBuf); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(N), gl.STATIC_DRAW);
		loc = gl.getAttribLocation(ptProg, 'aFlag'); gl.enableVertexAttribArray(loc); gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_BYTE, 0, 0);
	}
	// 1-degree lon/lat cells for hover lookup over an interleaved lon, lat array (each cell found twice rather than
	// stored: 4 bytes a point less at the peak)
	const cellOf = (ll, i) => Math.min(179, Math.floor(ll[2 * i + 1] / 65536 * 180)) * 360 + Math.min(359, Math.floor(ll[2 * i] / 65536 * 360));
	function cellIndex(ll, n) {
		const cnt = new Int32Array(360 * 180 + 1);
		for (let i = 0; i < n; i++) cnt[cellOf(ll, i) + 1]++;
		for (let c = 0; c < 360 * 180; c++) cnt[c + 1] += cnt[c];
		const start = cnt.slice(), idx = new Int32Array(n), cur = cnt.subarray(0, -1);
		for (let i = 0; i < n; i++) idx[cur[cellOf(ll, i)]++] = i;
		return [start, idx];
	}
	function buildIndex(L) {
		LL = L.ll; cellIdx = null;  // the old index goes before the new one is built
		[cellStart, cellIdx] = cellIndex(LL, N);
		buildLabels();
	}
	// the similarity map's cell index, which the runs' ASVs are snapped against; built the first time runs load
	function similarityIndex() {
		const S = similarity();
		if (!S.start) [S.start, S.idx] = S.ll === LL ? [cellStart, cellIdx] : cellIndex(S.ll, N);
		return S;
	}
	// nearest point within 8 px of the cursor, from a cell index
	function nearestIn(p, pts, start, idx, skip) {
		// the centre is magnified; in the dome, by nearness (hitDist from the screenToWorld just before)
		const pxPerRad = dome ? wallMin(canvas.clientWidth, canvas.clientHeight) / Math.PI / hitDist
			: (scale()[0] * canvas.clientWidth) / 2 * (flat ? 0.9 : FOC / (CAM - 1));
		return nearestWithin(p, pts, start, idx, 8 / pxPerRad, skip);
	}
	// nearest point within thr radians of unit vector p
	function nearestWithin(p, pts, start, idx, thr, skip) {
		const cosT = Math.cos(thr), [p0, p1, p2] = p;
		const lat = Math.asin(Math.max(-1, Math.min(1, p[2]))) * 180 / Math.PI, lon = Math.atan2(p[1], p[0]) * 180 / Math.PI;
		const dl = thr * 180 / Math.PI, cj = Math.floor(lon + 180);
		const r0 = Math.max(0, Math.floor(lat + 90 - dl)), r1 = Math.min(179, Math.floor(lat + 90 + dl));
		// columns either side of the cursor's; near a pole, where a degree of longitude is tiny, every column of each row
		const polar = Math.abs(lat) + dl > 85;
		const wl = polar ? 0 : Math.ceil(dl / Math.max(0.05, Math.cos((Math.abs(lat) + dl) * Math.PI / 180))) + 1;
		const j0 = polar ? 0 : cj - wl, ncol = polar ? 360 : 2 * wl + 1;
		let best = -1, bd = cosT;
		for (let r = r0; r <= r1; r++) for (let dj = 0; dj < ncol; dj++) {
			const c = r * 360 + ((j0 + dj) % 360 + 360) % 360;
			for (let k = start[c]; k < start[c + 1]; k++) {
				const i = idx[k];
				if (skip(i)) continue;
				const d = dotLL(pts, i, p0, p1, p2);
				if (d > bd) { bd = d; best = i; }
			}
		}
		return best;
	}

	// ---------- place names: domain, phylum, family, genus; each shown once its territory is big enough on screen
	let labelSets = [], labelPool = [], labelsOn = true;
	const SKIP = /^(|\?|other|incertae sedis|uncultured.*|unidentified.*|unclassified.*|metagenome.*|.*environmental sample.*)$/i;
	// built in slices of points between frames, so a big globe can be turned while its names are worked out; a newer
	// call (another layout) abandons an older one
	let labelGen = 0;
	const SLICE = 300000, breathe = () => new Promise((r) => setTimeout(r, 0));
	async function buildLabels() {
		const gen0 = ++labelGen, L0 = LL;
		labelSets = []; dirty = true;
		if (isGeo(current) && meta.geoLabels?.length) { labelSets = [geoLabels()]; return; }
		if (labelKey) return buildSetLabels(gen0, L0);
		const domName = meta.groups.map((g) => g.split(' · ')[0]);
		const doms = [...new Set(domName)], dIx = domName.map((d) => doms.indexOf(d));
		const levels = [
			{ cls: 'L0', names: doms, min: 1000 },
			{ cls: 'L1', names: meta.groups.map((g) => g.split(' · ')[1] || g), min: 200 },
			{ cls: 'L2', names: meta.lineages, min: 40 },
			{ cls: 'L3', names: meta.genera, min: 25 },
			{ cls: 'L4', names: meta.species, min: 5 }
		];
		// all levels in two passes over the points (centroids, then the member nearest each), in flat arrays: level k's
		// taxon g is slot off[k] + g, and each point's five slots are read once per pass
		const K = levels.length, Gs = levels.map((L) => L.names.length), off = [0];
		for (let k = 0; k < K; k++) off.push(off[k] + Gs[k]);
		const S = off[K], dI = Int32Array.from(dIx), R = rec, NG = Gs[1];
		const [o2, o3, o4] = [off[2], off[3], off[4]], [G2, G3, G4] = [Gs[2], Gs[3], Gs[4]];
		const slots = new Int32Array(5);
		function fill(i) {
			const r = R ? R[i] : i, g = grp[i], a = lin[r], b = gen[r], c = spc[r];
			slots[0] = g < NG ? dI[g] : -1; slots[1] = g < NG ? off[1] + g : -1;
			slots[2] = a < G2 ? o2 + a : -1; slots[3] = b < G3 ? o3 + b : -1; slots[4] = c < G4 ? o4 + c : -1;
		}
		const sum = new Float64Array(3 * S), n = new Int32Array(S);
		for (let i = 0; i < N; i++) {
			if (i % SLICE === 0 && i && N > SLICE) { await breathe(); if (gen0 !== labelGen || !alive) return; }
			fill(i);
			const lo = L0[2 * i], la = L0[2 * i + 1], cb = COSLA[la], x = cb * COSLO[lo], y = cb * SINLO[lo], z = SINLA[la];
			for (let k = 0; k < 5; k++) { const q = slots[k]; if (q < 0) continue; n[q]++; sum[3 * q] += x; sum[3 * q + 1] += y; sum[3 * q + 2] += z; }
		}
		const min = new Int32Array(S);
		for (let k = 0; k < K; k++) min.fill(levels[k].min, off[k], off[k + 1]);
		for (let q = 0; q < S; q++) { const l = Math.hypot(sum[3 * q], sum[3 * q + 1], sum[3 * q + 2]) || 1; sum[3 * q] /= l; sum[3 * q + 1] /= l; sum[3 * q + 2] /= l; }
		// anchor at the member nearest the centroid (a scattered group's centroid can sit in open ocean); spread = mean
		// chord to the centre (within 4% of the mean angle out to 1 rad, and no acos per point)
		const best = new Float64Array(S).fill(-2), at = new Int32Array(S).fill(-1), dsum = new Float64Array(S);
		for (let i = 0; i < N; i++) {
			if (i % SLICE === 0 && N > SLICE) { await breathe(); if (gen0 !== labelGen || !alive) return; }
			fill(i);
			const lo = L0[2 * i], la = L0[2 * i + 1], cb = COSLA[la], x = cb * COSLO[lo], y = cb * SINLO[lo], z = SINLA[la];
			for (let k = 0; k < 5; k++) {
				const q = slots[k]; if (q < 0 || n[q] < min[q]) continue;
				const d = x * sum[3 * q] + y * sum[3 * q + 1] + z * sum[3 * q + 2];
				dsum[q] += Math.sqrt(Math.max(0, 2 - 2 * d));
				if (d > best[q]) { best[q] = d; at[q] = i; }
			}
		}
		labelSets = levels.map((L, k) => {
			const out = [];
			for (let g = 0; g < Gs[k]; g++) {
				// names[g] is null at the species list's NONE gap (speciesBytes 4), which counts every unnamed point
				const q = off[k] + g;
				if (n[q] < L.min || at[q] < 0 || L.names[g] == null || SKIP.test(L.names[g])) continue;
				const i = at[q];
				out.push({ text: L.names[g], cls: L.cls, n: n[q], spread: dsum[q] / n[q], p: toXyz(L0[2 * i], L0[2 * i + 1]) });
			}
			out.sort((a, b) => b.n - a.n);
			return out;
		});
		dirty = true;
	}
	// place names on a map layout (globe.json geoLabels: places with more than 5 samples, named by their commonest
	// sample source): a place shows once it would span 26 px at a nominal radius growing with the root of its samples,
	// so the big sites show at once and the small ones as the view zooms in, and zooming further never hides them
	function geoLabels() {
		const u = (x, lo, hi) => Math.round((x - lo) / (hi - lo) * 65535);
		return meta.geoLabels.map((g) => ({ text: g.text, cls: 'Lg', n: g.n, geo: true, spread: 0.012 * Math.sqrt(g.n), p: toXyz(u(g.lon, -180, 180), u(g.lat, -90, 90)) }));
	}
	// the globe's names for a label set (globe.json labelSets, e.g. environment): one level per name tier, the
	// biggest categories first, anchored like the taxonomy's at the member nearest each category's centroid
	const SET_MIN = [1000, 200, 60, 25, 10, 5];
	async function buildSetLabels(gen0, L0) {
		const K = curLevels.length, Gs = rankNames.map((n) => n.length), off = [0];
		for (let k = 0; k < K; k++) off.push(off[k] + Gs[k]);
		const S = off[K], sum = new Float64Array(3 * S), n = new Int32Array(S);
		const slot = (k, i) => { const c = setArr[k][i]; return c < Gs[k] ? off[k] + c : -1; };
		for (let i = 0; i < N; i++) {
			const lo = L0[2 * i], la = L0[2 * i + 1], cb = COSLA[la], x = cb * COSLO[lo], y = cb * SINLO[lo], z = SINLA[la];
			for (let k = 0; k < K; k++) { const q = slot(k, i); if (q < 0) continue; n[q]++; sum[3 * q] += x; sum[3 * q + 1] += y; sum[3 * q + 2] += z; }
		}
		for (let q = 0; q < S; q++) { const l = Math.hypot(sum[3 * q], sum[3 * q + 1], sum[3 * q + 2]) || 1; sum[3 * q] /= l; sum[3 * q + 1] /= l; sum[3 * q + 2] /= l; }
		const best = new Float64Array(S).fill(-2), at = new Int32Array(S).fill(-1), dsum = new Float64Array(S);
		for (let i = 0; i < N; i++) {
			const lo = L0[2 * i], la = L0[2 * i + 1], cb = COSLA[la], x = cb * COSLO[lo], y = cb * SINLO[lo], z = SINLA[la];
			for (let k = 0; k < K; k++) {
				const q = slot(k, i); if (q < 0) continue;
				const d = x * sum[3 * q] + y * sum[3 * q + 1] + z * sum[3 * q + 2];
				dsum[q] += Math.sqrt(Math.max(0, 2 - 2 * d));
				if (d > best[q]) { best[q] = d; at[q] = i; }
			}
		}
		if (gen0 !== labelGen || !alive) return;
		labelSets = curLevels.map((_, k) => {
			const out = [], min = SET_MIN[Math.min(k, SET_MIN.length - 1)];
			for (let g = 0; g < Gs[k]; g++) {
				const q = off[k] + g;
				if (n[q] < min || at[q] < 0 || rankNames[k][g] == null) continue;
				const i = at[q];
				out.push({ text: rankNames[k][g], cls: `L${Math.min(k, 4)}`, n: n[q], spread: dsum[q] / n[q], p: toXyz(L0[2 * i], L0[2 * i + 1]) });
			}
			out.sort((a, b) => b.n - a.n);
			return out;
		});
		dirty = true;
	}
	function placeLabels() {
		const box = $('labels');
		if (!labelSets.length || morph || !labelsOn) { for (const el of labelPool) el.hidden = true; return; }
		if (dome) return placeDomeLabels();
		// worked out on the whole wall (w wide); each screen shows the ones on its slice
		const lw = canvas.clientWidth, h = canvas.clientHeight, sc = scale(), w = wallSpan(lw), X0 = wallX0(lw), cap = WALL ? WALL.cols : 1;
		const pxR = sc[0] * lw / 2 * (flat ? 0.9 : 1), minDim = Math.min(w, h);
		const taken = [], GAPX = 22, GAPY = 12;
		let used = 0, dom = 0;
		const fits = (x0, y0, x1, y1) => { for (const r of taken) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false; return true; };
		for (const set of labelSets) {
			let shownHere = 0;
			for (const L of set) {
				if (used >= 55 * cap || shownHere >= (L.geo ? 45 : 20) * cap) break;  // about a third of the earlier 160 / 60
				const rpx = L.spread * pxR;
				if (rpx < 26 || (!L.geo && rpx > 0.9 * minDim)) continue;
				const q = toView(L.p);
				let x, y;
				if (!flat) { if (q[2] < 0.15) continue; const w = FOC / (CAM - q[2]); x = q[0] * w; y = q[1] * w; }
				else {
					const lam = Math.atan2(q[0], q[2]), phi = Math.asin(Math.max(-1, Math.min(1, q[1])));
					let t = phi; for (let k = 0; k < 6; k++) t -= (2 * t + Math.sin(2 * t) - Math.PI * Math.sin(phi)) / (2 + 2 * Math.cos(2 * t) + 1e-6);
					x = 0.9003163 * lam * Math.cos(t) * 0.5; y = 1.4142136 * Math.sin(t) * 0.5;
				}
				const sx = x * sc[0] * lw / 2 + w / 2, sy = (1 - y * sc[1]) / 2 * h;
				const fs = L.cls === 'L0' ? 17 : L.cls === 'L1' ? 13.6 : L.cls === 'L4' || L.cls === 'Lg' ? 11.8 : 12.5, cw = L.cls === 'L0' ? fs * 0.95 : fs * 0.56;
				const tw = L.text.length * cw, th = fs * 1.3;
				const x0 = sx - tw / 2, y0 = sy - th / 2;
				// each label keeps a clear margin (GAPX, GAPY) around it, so the ones shown spread over the globe
				if (x0 < 4 || y0 < 4 || x0 + tw > w - 4 || y0 + th > h - 4 || !fits(x0 - GAPX, y0 - GAPY, x0 + tw + GAPX, y0 + th + GAPY)) continue;
				taken.push([x0 - GAPX, y0 - GAPY, x0 + tw + GAPX, y0 + th + GAPY]);
				used++; shownHere++;
				if (x0 + tw < X0 || x0 > X0 + lw) continue;  // on another screen
				let el = labelPool[dom];
				if (!el) { el = document.createElement('span'); box.appendChild(el); labelPool.push(el); }
				if (el.textContent !== L.text) el.textContent = L.text;
				if (el.className !== L.cls) el.className = L.cls;
				el.style.transform = `translate(${(x0 - X0).toFixed(1)}px, ${y0.toFixed(1)}px)`;
				el.hidden = false; dom++;
			}
		}
		for (let k = dom; k < labelPool.length; k++) labelPool[k].hidden = true;
	}
	// dome labels: centred on their anchor, upright for someone facing them (their tops point at the zenith), sized
	// as a fraction of the dome so a frame of any resolution reads the same
	function placeDomeLabels() {
		const lw = canvas.clientWidth, box = $('labels'), w = wallSpan(lw), X0 = wallX0(lw), h = canvas.clientHeight, R = Math.min(w, h) / 2;
		const k = R / 500 * labelScale, c = cam(), pxPerRad = R / (Math.PI / 2);
		const taken = []; let used = 0, dom = 0;
		const fits = (x0, y0, x1, y1) => { for (const r of taken) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false; return true; };
		for (const set of labelSets) {
			let shownHere = 0;
			for (const L of set) {
				if (used >= 48 || shownHere >= 24) break;
				const q = toView(L.p), v = [q[0] - c[0], q[1] - c[1], q[2] - c[2]], dist = Math.hypot(v[0], v[1], v[2]);
				const rpx = L.spread / dist * pxPerRad;
				if (rpx < 22 * k || rpx > 1.1 * R) continue;
				const r = Math.acos(Math.max(-1, Math.min(1, v[2] / dist))) / (Math.PI / 2), s = Math.hypot(v[0], v[1]);
				if (r > 0.93) continue;
				const dx = s > 1e-6 ? -v[0] / s * r : 0, dy = s > 1e-6 ? v[1] / s * r : 0;
				const sx = w / 2 + dx * R, sy = h / 2 - dy * R;
				const ang = r < 0.04 ? 0 : Math.atan2(-dx, -dy);  // clockwise turn that points the label's top at the centre
				const fs = (L.cls === 'L0' ? 17 : L.cls === 'L1' ? 13.6 : L.cls === 'L4' ? 11.8 : 12.5) * k, cw = L.cls === 'L0' ? fs * 0.95 : fs * 0.56;
				const tw = L.text.length * cw + 8 * k, th = fs * 1.5, ca = Math.abs(Math.cos(ang)), sa = Math.abs(Math.sin(ang));
				const hw = (tw * ca + th * sa) / 2, hh = (tw * sa + th * ca) / 2;
				if (Math.hypot(sx - w / 2, sy - h / 2) + Math.max(hw, hh) > R || !fits(sx - hw, sy - hh, sx + hw, sy + hh)) continue;
				taken.push([sx - hw, sy - hh, sx + hw, sy + hh]);
				used++; shownHere++;
				if (sx + hw < X0 || sx - hw > X0 + lw) continue;  // on another screen
				let el = labelPool[dom];
				if (!el) { el = document.createElement('span'); box.appendChild(el); labelPool.push(el); }
				if (el.textContent !== L.text) el.textContent = L.text;
				if (el.className !== L.cls) el.className = L.cls;
				el.style.transform = `translate(${(sx - X0).toFixed(1)}px, ${sy.toFixed(1)}px) rotate(${ang.toFixed(4)}rad) scale(${k.toFixed(3)}) translate(-50%, -50%)`;
				el.hidden = false; dom++;
			}
		}
		for (let j = dom; j < labelPool.length; j++) labelPool[j].hidden = true;
	}

	// ---------- draw
	// layouts are named <shape>[-<model>]: shape sculpt or similarity; model a key from globe.json `models` ('' = the first)
	let shape = 'sculpt', model = '';
	let dirty = true, morph = null, current = 'sculpt', flagMode = false, flags = null, majg = null, flagBuf = null;
	// the data version goes on every URL, so a rebuilt globe is fetched fresh whatever a browser has cached
	const url = (name) => `${base}/${name}` + (version ? `?v=${encodeURIComponent(version)}` : '');
	async function fetchBin(name) {
		const r = await fetch(url(name));
		if (!r.ok) throw new Error(`${r.status} ${name}`);
		return new Uint8Array(await r.arrayBuffer());
	}
	async function ensureFlags() {
		if (flags) return true;
		let b;
		try { b = await fetchBin('flags.bin'); } catch { return false; }
		if (!alive) return false;
		flags = b.subarray(0, N); majg = b.subarray(N, 2 * N);
		gl.bindBuffer(gl.ARRAY_BUFFER, flagBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, flags);
		return true;
	}
	// a layout by file name (layout_<name>.bin; similarity is pos.bin), loaded and turned onto the equator once
	async function ensureLayout(name) {
		if (name === 'similarity') similarity();
		if (layouts[name]) return true;
		let b;
		try { b = await fetchBin(`layout_${name}.bin`); } catch { return false; }
		if (!alive) return false;
		layouts[name] = makeLayout(new Uint16Array(b.buffer, 0, N), new Uint16Array(b.buffer, 2 * N, N), name);
		if (asv) asvLayout(name);
		return true;
	}
	async function setColour(mode) {
		if (mode && !flags) {
			$('status').textContent = 'Loading label checks…';
			if (!(await ensureFlags())) { if (alive) $('status').textContent = 'The label checks did not load. Try again.'; return; }
		}
		flagMode = mode;
		if (mode) {
			let d = 0, p = 0; for (let i = 0; i < N; i++) { if (flags[i] === 2) d++; else if (flags[i] === 1) p++; }
			$('status').innerHTML = `<span class="dot red"></span>${d.toLocaleString()} labelled with the wrong domain · <span class="dot amber"></span>${p.toLocaleString()} with the wrong phylum, judging by their 15 nearest neighbours`;
		} else $('status').textContent = IDLE;
		dirty = true;
	}
	const SCULPT = `Sculpted: each ${unitOne} is gently pulled toward its domain, phylum, class and order.${runs.length ? ' ASVs sit on their nearest reference.' : ''}`;
	const modelLabel = (m) => meta.models?.find((x) => x.key === m)?.label;
	async function showLayout(s, m = model) {
		const name = m ? `${s}-${m}` : s;
		if (name === current || morph) return false;
		if (!layouts[name]) $('status').textContent = 'Loading the layout…';
		if (!(await ensureLayout(name))) { if (alive) $('status').textContent = 'That layout did not load. Try again.'; return false; }
		const by = meta.models ? modelLabel(m) : 'sequence';
		const about = meta.layoutInfo?.[name]?.about;
		$('status').textContent = about ? about : s === 'sculpt' ? (meta.models ? `${by} map, ` + SCULPT.charAt(0).toLowerCase() + SCULPT.slice(1) : SCULPT)
			: `Placed by ${by} similarity alone.`;
		bindLayouts(layouts[current], layouts[name]);
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		morph = { to: layouts[name], t0: performance.now(), dur: reduce ? 1 : 2200, t: 0 };
		prevLayout = current; current = name; shape = s; model = m;
		for (const [id, n] of [['lSim', 'similarity'], ['lSculpt', 'sculpt']]) $(id).setAttribute('aria-pressed', n === s ? 'true' : 'false');
		return true;
	}
	// coastlines (static/earthdna/coast-50m.bin: Natural Earth 50 m coastline, int16 lon/lat pairs in 1/100 degree, one
	// segment per 8 bytes), loaded only for a globe with a map layout and drawn while one is shown
	let coast = null, prevLayout = null;
	const isGeo = (name) => (meta?.geoLayouts || []).includes(name);
	function coastAlpha() {
		if (!morph) return isGeo(current) ? 1 : 0;
		const a = isGeo(prevLayout) ? 1 : 0, b = isGeo(current) ? 1 : 0;
		return a + (b - a) * morph.t;
	}
	// a segment file (int16 lon/lat pairs in 1/100 degree, 8 bytes a segment) as an instanced vertex array
	async function loadSegments(path) {
		let b; try { const r = await fetch(path); if (!r.ok) return null; b = await r.arrayBuffer(); } catch { return null; }
		if (!alive) return null;
		const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
		const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Int16Array(b), gl.STATIC_DRAW);
		const loc = gl.getAttribLocation(coastProg, 'aSeg');
		gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.SHORT, false, 0, 0); gl.vertexAttribDivisor(loc, 1);
		return { vao, n: b.byteLength / 8 };
	}
	async function loadCoast() {
		if (!meta.geoLayouts?.length) return;
		const c = await loadSegments('/earthdna/coast-50m.bin');
		if (!c) return;
		coast = { ...c, land: null, rivers: null }; dirty = true;
		// rivers (static/earthdna/rivers-50m.bin: Natural Earth 50 m river and lake centre-lines)
		coast.rivers = await loadSegments('/earthdna/rivers-50m.bin'); dirty = true;
		// land mask (static/earthdna/land-50m.png: Natural Earth 50 m land less its 50 m lakes, 2048 x 1024
		// equirectangular, north up)
		try {
			const r = await fetch('/earthdna/land-50m.png');
			if (!r.ok) return;
			const img = await createImageBitmap(await r.blob());
			if (!alive) return;
			const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			coast.land = tex; dirty = true;
		} catch { /* coastlines only */ }
	}
	function draw() {
		const sc = scale();
		gl.clearColor(0.008, 0.024, 0.090, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
		// the projection's uniforms, shared by every program
		const cm = dome ? cam() : [0, 0, 0], fl = dome ? 2 : flat ? 1 : 0;
		const proj = (p) => {
			gl.uniformMatrix3fv(gl.getUniformLocation(p, 'uRot'), true, rot);
			gl.uniform1f(gl.getUniformLocation(p, 'uFlat'), fl);
			gl.uniform3f(gl.getUniformLocation(p, 'uCam'), cm[0], cm[1], cm[2]);
			gl.uniform2f(gl.getUniformLocation(p, 'uScale'), sc[0], sc[1]);
			gl.uniform2f(gl.getUniformLocation(p, 'uOff'), wallOff(), 0);
		};
		const ca = coast ? coastAlpha() : 0;
		gl.useProgram(bgProg); gl.bindVertexArray(bgVao);
		proj(bgProg);
		gl.uniform1f(gl.getUniformLocation(bgProg, 'uLand'), coast?.land ? ca : 0);
		if (coast?.land) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, coast.land); gl.uniform1i(gl.getUniformLocation(bgProg, 'uLandTex'), 1); gl.activeTexture(gl.TEXTURE0); }
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		if (!layouts[current]) return;  // N is known before the buffers are
		gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
		if (ca > 0.01) {
			gl.useProgram(coastProg);
			proj(coastProg);
			// rivers in the water's colour, then the coastline
			if (coast.rivers) {
				gl.bindVertexArray(coast.rivers.vao);
				gl.uniform3f(gl.getUniformLocation(coastProg, 'uCol'), 0.047, 0.094, 0.157);
				gl.uniform1f(gl.getUniformLocation(coastProg, 'uAlpha'), 0.9 * ca);
				gl.drawArraysInstanced(gl.LINES, 0, 2, coast.rivers.n);
			}
			gl.bindVertexArray(coast.vao);
			gl.uniform3f(gl.getUniformLocation(coastProg, 'uCol'), 0.62, 0.70, 0.80);
			gl.uniform1f(gl.getUniformLocation(coastProg, 'uAlpha'), 0.28 * ca);
			gl.drawArraysInstanced(gl.LINES, 0, 2, coast.n);
		}
		gl.useProgram(ptProg); gl.bindVertexArray(ptVao);
		proj(ptProg);
		const ov = show?.ov || syncOv, dpr = canvas.width / Math.max(1, canvas.clientWidth), alpha = ov ? ov.alpha : 1;
		// dome: sized as a fraction of the disc (so any frame resolution looks the same); nearness enlarges points in the shader
		// a point narrower than a pixel is drawn a pixel wide, so on an ordinary-resolution screen (a wall) a small base
		// size would make Size's steps look alike: each step is at least its own factor in device pixels
		const size = Math.max(SIZE_STEPS[sizeStep][1], (ov ? ov.size : pointSize()) * (dome ? wallMin(canvas.width, canvas.height) / 900 : dpr * Math.pow(zoom, 0.45)));
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uSize'), size);
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uAlpha'), alpha * (asvShown() ? 0.28 : ovShown() ? 0.35 : 1));
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uHasSel'), hasSel ? 1 : 0);
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uMode'), flagMode ? 1 : 0);
		gl.uniform1f(gl.getUniformLocation(ptProg, 'uMix'), morph ? morph.t : 0);
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, colTex);
		gl.uniform1i(gl.getUniformLocation(ptProg, 'uColTex'), 0);
		// in 4M-point chunks: Firefox refuses more than 30M vertices in one draw call
		for (let s = 0; s < N; s += 4000000) gl.drawArrays(gl.POINTS, s, Math.min(4000000, N - s));
		if (ovShown()) {
			gl.disable(gl.DEPTH_TEST);
			gl.useProgram(ovProg);
			proj(ovProg);
			gl.uniform1f(gl.getUniformLocation(ovProg, 'uSize'), size);
			gl.uniform1f(gl.getUniformLocation(ovProg, 'uAlpha'), Math.min(1, alpha * 0.8));
			for (const o of overlays) {
				const v = o.on && o.vao && o.vao[current];
				if (!v) continue;
				gl.uniform3fv(gl.getUniformLocation(ovProg, 'uCol'), hex(o.colour));
				gl.bindVertexArray(v); gl.drawArrays(gl.POINTS, 0, o.n);
			}
			gl.enable(gl.DEPTH_TEST);
		}
		if (asvShown()) {
			gl.disable(gl.DEPTH_TEST);
			gl.useProgram(asvProg); gl.bindVertexArray(asv.vao);
			proj(asvProg);
			gl.uniform1f(gl.getUniformLocation(asvProg, 'uSize'), size);
			gl.drawArrays(gl.POINTS, 0, asv.n);
		}
	}
	let last = performance.now(), raf = 0;
	function frame(t) {
		if (!alive) return;
		const dt = Math.min(0.1, (t - last) / 1000); last = t;
		if (SYNC && !leading) { if (dirty) { draw(); placeLabels(); dirty = false; } raf = requestAnimationFrame(frame); return; }
		if (navActive()) applyNav(dt);
		if (show?.ready) { if (!show.paused) show.t = (show.t + dt) % show.duration; applyShow(show.t); raf = requestAnimationFrame(frame); return; }
		// dome: the sky turns about the zenith, slowly (fast motion overhead is uncomfortable)
		if (spin && !dragging) { const a = 0.06 * dt / Math.sqrt(zoom); rot = dome ? mul(rotZ(a / 3), rot) : flat ? mul(rotY(a), rot) : mul(rot, rotZ(a)); dirty = true; }
		if (morph) {
			const u = Math.min(1, (t - morph.t0) / morph.dur);
			morph.t = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
			dirty = true;
			if (u >= 1) { const L = morph.to; morph = null; bindLayouts(L, L); buildIndex(L); if (asv) bindAsvLayout(current); }
		}
		if (dirty) { draw(); placeLabels(); dirty = false; broadcast(); }
		raf = requestAnimationFrame(frame);
	}

	// ---------- interaction
	let dragging = false, moved = 0, lastP = null;
	const pointers = new Map();
	// Google Earth-style turning: across = about the Earth's polar axis; up and down = tilt toward a pole, stopping short
	// of it so the globe never turns over the top; and while dragging, any roll eases back so north stays up (except near a
	// pole, where up has no meaning). rot maps world to view: its third column is north in view, its third row the
	// world direction at the centre of the view.
	const MAX_LAT = Math.sin(89 * Math.PI / 180);
	function earthDrag(ax, ay) {
		rot = mul(rot, rotZ(ax));
		const tilted = mul(rotX(ay), rot);
		if (Math.abs(tilted[8]) < MAX_LAT || Math.abs(tilted[8]) < Math.abs(rot[8])) rot = tilted;
		if (Math.abs(rot[8]) < 0.97) rot = mul(rotZ(0.15 * Math.atan2(rot[2], rot[5])), rot);
	}
	function stopSpin() { if (spin) { spin = false; $('spin').setAttribute('aria-pressed', 'false'); } }
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
		if (dome) {  // take hold of the sky: the point under the pointer stays under it
			const a = screenToView(e.clientX - dx, e.clientY - dy), b = screenToView(e.clientX, e.clientY);
			if (a && b) { rot = mul(rotBetween(a, b), rot); dirty = true; }
			return;
		}
		const px = (scale()[0] * canvas.clientWidth) / 2;  // pixels per unit radius
		// the equal-area map turns freely; the globe turns like Google Earth
		if (flat) rot = mul(rotY(dx / px), mul(rotX(dy / px), rot));
		else earthDrag(dx / px, dy / px);
		dirty = true;
	});
	function endPointer(e) {
		pointers.delete(e.pointerId);
		if (pointers.size === 0) {
			dragging = false; canvas.classList.remove('dragging');
			// taps on a phone turn the globe only: a fingertip covers many points, and a pick on every stray tap gets in the way
			if (moved < 4 && e.type === "pointerup" && e.pointerType !== "touch") pickPoint(e.clientX, e.clientY);
		} else lastP = [...pointers.values()][0];
	}
	on(canvas, 'pointerup', endPointer); on(canvas, 'pointercancel', endPointer);
	on(canvas, 'pointerleave', () => { if (!dragging) $('tip').hidden = true; });
	function setZoom(z) { zoom = Math.max(dome ? 1 : 0.6, Math.min(80, z)); dirty = true; }
	// rotation taking unit vector a to unit vector b
	function rotBetween(a, b) {
		const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
		if (c < -0.9999) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
		const f = 1 / (1 + c), [x, y, z] = v;
		return [1 - f * (y * y + z * z), f * x * y - z, f * x * z + y, f * x * y + z, 1 - f * (x * x + z * z), f * y * z - x, f * x * z - y, f * y * z + x, 1 - f * (x * x + y * y)];
	}
	// dome: screen -> the point of the sphere seen there, in view space (unit vector); hitDist is its distance from the camera
	let hitDist = 1;
	function screenToView(cx, cy) {
		const r = canvas.getBoundingClientRect(), sc = scale();
		const x = ((cx - r.left) / r.width * 2 - 1 - wallOff()) / sc[0], y = (1 - (cy - r.top) / r.height * 2) / sc[1], rr = Math.hypot(x, y);
		if (rr > 1) return null;
		const th = rr * Math.PI / 2, s = rr > 1e-6 ? Math.sin(th) / rr : 0, d = [-x * s, y * s, Math.cos(th)], c = cam();
		const b = c[0] * d[0] + c[1] * d[1] + c[2] * d[2], t = -b + Math.sqrt(Math.max(0, b * b - (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) + 1));
		hitDist = t;
		return [c[0] + t * d[0], c[1] + t * d[1], c[2] + t * d[2]];
	}
	on(canvas, 'wheel', (e) => { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
	on(canvas, 'dblclick', (e) => {
		const p = screenToWorld(e.clientX, e.clientY); if (!p) return;
		stopSpin(); centreOn(Math.atan2(p[1], p[0]), Math.asin(Math.max(-1, Math.min(1, p[2])))); setZoom(zoom * 1.6);
	});

	// screen -> world unit vector (or null off the map)
	function screenToWorld(cx, cy) {
		const r = canvas.getBoundingClientRect(), sc = scale();
		const x = ((cx - r.left) / r.width * 2 - 1 - wallOff()) / sc[0], y = (1 - (cy - r.top) / r.height * 2) / sc[1];
		let q;
		if (dome) { q = screenToView(cx, cy); if (!q) return null; }
		else if (!flat) {
			// ray from the camera (0, 0, CAM) through the screen point: q = (x, y) (CAM - z) / FOC on the unit sphere
			const k = (x * x + y * y) / (FOC * FOC), disc = CAM * CAM - (k + 1) * (CAM * CAM - 1);
			if (disc < 0) return null;
			const u = (CAM - Math.sqrt(disc)) / (k + 1), z = CAM - u;
			q = [x * u / FOC, y * u / FOC, z];
		}
		else {
			const mx = 2 * x, my = 2 * y, st = my / Math.SQRT2; if (Math.abs(st) > 1) return null;
			const t = Math.asin(st), lam = mx / (0.9003163 * Math.cos(t)); if (Math.abs(lam) > Math.PI) return null;
			const phi = Math.asin(Math.max(-1, Math.min(1, (2 * t + Math.sin(2 * t)) / Math.PI)));
			q = [Math.cos(phi) * Math.sin(lam), Math.sin(phi), Math.cos(phi) * Math.cos(lam)];
		}
		return toWorld(q);
	}
	function nearest(cx, cy) {
		const p = screenToWorld(cx, cy); if (!p || !N) return -1;
		return nearestIn(p, LL, cellStart, cellIdx, (i) => hasSel && !sel[i]);
	}
	function nearestAsv(cx, cy) {
		const p = screenToWorld(cx, cy); if (!p) return -1;
		return nearestIn(p, asv.ll, asv.cellStart, asv.cellIdx, (i) => !asv.runOn[asv.run[i]]);
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
			if (labelKey && setInfo[labelKey]) { setTip(tip, i); placeTip(tip, cx, cy); return; }
			// two lines: genus + species, then the taxon at the rank the globe is coloured by (family when that rank is
			// genus or species, which the first line already names)
			const g = meta.genera[gen[T(i)]], sp = meta.species[spc[T(i)]], gr = meta.groups[grp[i]] || 'other';
			tip.innerHTML = '<div class="g"></div><div class="m"></div>';
			const pc = tipPct && tipPct[i] !== 255 ? `${tipPct[i]}% ` : '';  // the dominant taxon's share (globe.json tipPercent)
			tip.children[0].textContent = pc + (sp || (g ? g + ' sp.' : 'Unclassified'));
			let second = gr.replace(' · ', ' › ');
			if (rankArr) {
				const r = labelKey ? curLevel : curLevel >= 5 ? 4 : curLevel, c = rankCode(r, i), lv = curLevels[r];
				second = `${lv.charAt(0).toUpperCase()}${lv.slice(1)} · ${c !== NONE && rankNames[r][c] != null ? rankNames[r][c] : 'unclassified'}`;
			}
			tip.children[1].textContent = second;
			// with a taxon picked or searched: first the share of the point's own taxon at the rank its colour shows (one
			// rank below the pick), then any searched taxon's share; the predominant species after
			const cs = (lastView?.filter || lastView?.mark) && !labelKey ? rankShare(curLevel, i) : '';
			if (cs || picked.length) {
				tip.children[0].textContent = [cs, ...picked.map((p) => `${fmtShare(p.a[i])} ${p.name}`)].filter(Boolean).join(' · ');
				tip.children[1].textContent = `Predominant species: ${pc}${sp || (g ? g + ' sp.' : 'unclassified')}`;
			}
			if (flagMode && flags && flags[i] > 0) {
				const d = document.createElement('div'); d.className = 'w';
				d.textContent = `Labelled ${gr.split(' · ')[1] || gr}, but its neighbours are ${(meta.groups[majg[i]] || 'other').replace(' · ', ' › ')}`;
				tip.appendChild(d);
			}
			placeTip(tip, cx, cy);
		});
	}

	// ---------- taxa: rank codes per reference, the picker's view
	// rank 0 domain (from the group), 1-4 phylum..family (ranks.bin), 5 genus, 6 species (tax.bin); NONE = unranked
	const taxCode = (r, i) => r === 0 ? domIx[grp[i]] : r <= 4 ? rankArr[r - 1][T(i)] : r === 5 ? gen[T(i)] : spc[T(i)];
	// a label set (globe.json labelSets) replaces the taxonomy everywhere the ranks are read: codes per point and level
	let labelKey = '', setArr = null, taxNames = null, curLevels = null, tipPct = null;
	let rankCode = taxCode;
	function lineageOf(i) {
		const out = [];
		for (let r = 0; r < rankNames.length; r++) { const c = rankCode(r, i); if (c !== NONE && rankNames[r][c] != null) out.push({ rank: r, code: c, name: rankNames[r][c] }); }
		return out;
	}
	// every (rank, code) a name is used at, with its reference count, biggest first
	let byName = null;
	function namesIndex() {
		byName = new Map();
		// with per-record taxonomy, ranks below domain are counted over the records, each weighted by its points
		let per = null;
		if (rec) { per = new Int32Array(spc.length); for (let i = 0; i < N; i++) per[rec[i]]++; }
		rankNames.forEach((names, r) => {
			const n = new Int32Array(names.length);
			if (per && r > 0 && !labelKey) for (let j = 0; j < per.length; j++) { const c = r <= 4 ? rankArr[r - 1][j] : r === 5 ? gen[j] : spc[j]; if (c !== NONE) n[c] += per[j]; }
			else for (let i = 0; i < N; i++) { const c = rankCode(r, i); if (c !== NONE) n[c]++; }
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
		return hit ? lineageAt(hit.rank, hit.code) : null;
	}
	function lineageAt(r, c) {
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
	// "contains" search (globe.json contains, contains_<rank>.bin from earthdna pack_globe.py --contains): every point
	// carrying a taxon at or above the threshold, not only the points it labels. A rank's file loads on first use.
	const containsFiles = new Map(), memberCache = new Map();
	let containsIndex = null;  // lower-cased name -> { rank, t }, first rank (phylum .. species) that has the name
	function containsLookup(name) {
		if (!meta.contains) return null;
		if (!containsIndex) {
			containsIndex = new Map();
			for (const rk of meta.contains.ranks) meta.contains.names[rk].forEach((n, t) => { const k = n.toLowerCase(); if (!containsIndex.has(k)) containsIndex.set(k, { rank: rk, t, name: n }); });
		}
		return containsIndex.get((name || '').toLowerCase()) || null;
	}
	async function containsMembers(hit) {
		const key = `${hit.rank}\t${hit.name}`;
		if (memberCache.has(key)) return key;
		let f = containsFiles.get(hit.rank);
		if (!f) {
			$('status').textContent = `Loading which ${unit} contain each ${hit.rank}…`;
			const b = await fetchBin(`contains_${hit.rank}.bin`);
			const n = new DataView(b.buffer, b.byteOffset).getUint32(0, true);
			f = { offs: new Uint32Array(b.buffer.slice(b.byteOffset + 4, b.byteOffset + 8 + 4 * n)), data: b.subarray(8 + 4 * n) };
			containsFiles.set(hit.rank, f);
		}
		const m = new Uint8Array(N), d = f.data;
		let x = 0, shift = 0, pos = -1;
		for (let k = f.offs[hit.t]; k < f.offs[hit.t + 1]; k++) {
			const c = d[k]; x |= (c & 0x7f) << shift; shift += 7;
			if (c < 0x80) { pos += x; m[pos] = 1; x = 0; shift = 0; }
		}
		memberCache.set(key, m);
		return key;
	}
	// a picked taxon's share of each point (abund_<rank>.bin, one byte per member of contains_<rank>.bin in the same
	// order: 1 + round(80 log10(share / min)); 0 here = below contains.min), for the tooltip
	const abundFiles = new Map(), abundCache = new Map();
	async function abundOf(rank, name) {
		const t = meta.contains?.abund ? (meta.contains.names[rank] ?? []).indexOf(name) : -1;
		if (t < 0) return null;
		const key = `${rank}\t${name}`;
		if (abundCache.has(key)) return abundCache.get(key);
		await containsMembers({ rank, t, name });
		let f = abundFiles.get(rank);
		if (!f) {
			const b = await fetchBin(`abund_${rank}.bin`);
			const n = new DataView(b.buffer, b.byteOffset).getUint32(0, true);
			f = { offs: new Uint32Array(b.buffer.slice(b.byteOffset + 4, b.byteOffset + 8 + 4 * n)), data: b.subarray(8 + 4 * n) };
			abundFiles.set(rank, f);
		}
		const m = memberCache.get(key), out = new Uint8Array(N);
		for (let i = 0, k = f.offs[t]; i < N; i++) if (m[i]) out[i] = f.data[k++];
		abundCache.set(key, out);
		return out;
	}
	// the share of a point's own taxon at taxonomy level r (globe.json rankPercent, rankpct.bin): '45% Lachnospirales'
	let rankPct = null;  // level index -> Uint16Array of hundredths of a percent (65535 = none)
	function rankShare(r, i) {
		const a = rankPct?.[r], c = rankCode(r, i);
		if (!a || a[i] === 65535 || c === NONE || rankNames[r][c] == null) return '';
		const p = a[i] / 100;
		return `${p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2)}% ${rankNames[r][c]}`;
	}
	const fmtShare = (b) => {
		const lo = 100 * meta.contains.min;
		if (!b) return `<${lo}%`;
		const p = lo * 10 ** ((b - 1) / 80);
		return `${p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2)}%`;
	};
	// the searched taxa whose shares the tooltip gives: one marked with + or the search box, and one a pick sits inside
	let picked = [], pickedFor = null, markFor = null;
	async function loadPicked(filter, mark) {
		pickedFor = filter; markFor = mark; picked = [];
		if ((!filter && !mark) || !meta.contains?.abund) return;
		const want = [];
		if (mark) { const h = containsLookup(mark.name); if (h) want.push([h.rank, h.name]); }
		if (filter && (filter.rank === -1 || filter.within)) { const h = containsLookup(filter.within ?? filter.name); if (h) want.push([h.rank, h.name]); }
		const got = [];
		for (const [rk, nm] of want) { try { const a = await abundOf(rk, nm); if (a) got.push({ name: nm, a }); } catch { /* no shares for it */ } }
		if (pickedFor === filter && markFor === mark) picked = got.filter((p, k) => got.findIndex((q) => q.name === p.name) === k);
	}
	// what the search box finds: with the taxonomy shown, a taxon matches every point that contains it; with a label
	// set (e.g. environment), its own names first, then taxa by what points contain
	async function findAny(name) {
		const hit = containsLookup(name);
		if (hit && !labelKey) { try { return [{ rank: -1, code: -1, name: hit.name, contains: await containsMembers(hit) }]; } catch { /* fall back to labels */ } }
		const own = find(name);
		if (own || !hit) return own;
		try { return [{ rank: -1, code: -1, name: hit.name, contains: await containsMembers(hit) }]; } catch { return null; }
	}
	const searchNames = () => meta.contains ? [...new Set([...rankNames.flat(), ...meta.contains.ranks.flatMap((rk) => meta.contains.names[rk])].filter(Boolean))] : undefined;
	const count = (name) => uses(name)[0]?.count ?? 0;
	function describe(name) {
		const u = uses(name);
		if (!u.length) { const h = containsLookup(name); return h ? `${h.rank} · present in ${unit}` : ''; }
		return `${curLevels[u[0].rank]} · ${u[0].count.toLocaleString()}` + (u.length > 1 ? ` (+${u.length - 1} more)` : '');
	}
	let curLevel = 2;  // the rank the globe is coloured by (view() sets it); the tooltip names the point's taxon there
	let lastView = null, lastRanked = [];  // view()'s last arguments and answer, for the other screens of a wall
	let baseLevel = 2, pickedLevel = -1;  // the Colour by rank (the level shown with nothing picked); a click picks at it
	// mark: a "contains" search shown on the globe without moving the picker (its + on a row); the list keeps counting
	// the filter's points, the highlight is every point carrying the marked taxon
	function view(level, filter, mark = null) {
		if (!rankArr) return [];
		lastView = { level, filter, mark };
		if (filter !== pickedFor || mark !== markFor) loadPicked(filter, mark);
		curLevel = level;
		if (!filter) { baseLevel = level; pickedLevel = -1; }
		const cm = filter?.contains ? memberCache.get(filter.contains) : null;  // a "contains" search (findAny), or a taxon picked inside one
		const mk = mark?.contains ? memberCache.get(mark.contains) : null;
		const counts = new Map();
		let members = 0, marked = 0;
		for (let i = 0; i < N; i++) {
			const traitOk = trait < 0 || (((traits[T(i)] >> trait) & 1) === 1) !== traitNeg;
			const inside = (!filter || ((!cm || cm[i] === 1) && (filter.rank < 0 || rankCode(filter.rank, i) === filter.code))) && traitOk;
			const lit = mk ? mk[i] === 1 && traitOk : inside;
			sel[i] = lit ? 1 : 0;
			if (lit) marked++;
			if (!inside) continue;
			members++;
			const c = rankCode(level, i);
			counts.set(c, (counts.get(c) || 0) + 1);
		}
		hasSel = (!!filter || !!mk || trait >= 0) && marked < N;
		const ranked = [...counts].sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1] - a[1])
			.map(([code, count]) => ({ code, count, name: code === NONE ? 'unclassified' : rankNames[level][code] }));
		// every listed taxon gets its own slot and colour; unclassified is the bright one
		const palette = generatePalette(ranked.length), slot = new Map(), cols = new Float32Array(3 * (ranked.length + 1));
		ranked.forEach((t, k) => {
			const c = t.code === NONE ? BRIGHT : palette[k];
			t.color = css(c);
			slot.set(t.code, k); cols.set(c, 3 * k);
		});
		// the slot after the list: points outside the filter, dimmed, and marked points the list does not count, light grey
		const outside = ranked.length;
		cols.set([0.8, 0.8, 0.78], 3 * outside);
		setColours(cols);
		for (let i = 0; i < N; i++) { const k = slot.get(rankCode(level, i)); cidx[i] = k === undefined ? outside : k; }
		gl.bindBuffer(gl.ARRAY_BUFFER, cidxBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, cidx);
		gl.bindBuffer(gl.ARRAY_BUFFER, selBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, sel);
		// ASVs: kept when their lineage names the filter taxon; counted against each listed taxon by name
		asvFilter = filter ? norm(filter.rank < 0 ? filter.name : rankNames[filter.rank][filter.code]) : '';
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
		const what = !filter ? '' : filter.rank < 0 ? `${filter.name} present` : rankNames[filter.rank][filter.code] + (filter.within ? ` with ${filter.within} present` : '');
		const said = mk ? `${mark.name} present · ${marked.toLocaleString()} ${unit}` + (what ? ` (list: ${what} · ${members.toLocaleString()})` : '')
			: what ? `${what} · ${members.toLocaleString()} ${unit}` : '';
		if (!flagMode) $('status').textContent = said || IDLE;  // disagreements keep their summary
		dirty = true;
		lastRanked = ranked;
		return ranked;
	}
	// a click copies the point's record (copyRecord); a click on empty space clears a pick made in the picker
	function pickPoint(cx, cy) {
		const i = nearest(cx, cy);
		if (i < 0) { if (hasSel || pickedLevel >= 0) onClear(); return; }
		if (rankArr) copyRecord(i);
	}
	// a clicked point's record to the clipboard, as "field<TAB>value" lines (pastes as two spreadsheet columns), the
	// same whichever labels are on: its record (the first label set with one), each label set's path, then its taxonomy
	// (on globes of metagenomes, the predominant lineage). Label sets not yet shown are loaded first.
	async function copyRecord(i) {
		for (const def of meta.labelSets ?? []) await loadSet(def, true);
		if (!alive) return;
		const out = [], cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
		const S = Object.values(setInfo)[0];
		if (S) {
			const v = S.rows[i].split('\t');
			S.cols.forEach((c, k) => { if (v[k] && c !== 'Dominant') out.push([c === 'lat' ? 'Latitude' : c === 'lon' ? 'Longitude' : cap(c), v[k]]); });  // the share goes on the species line
		}
		for (const [key, arr] of Object.entries(setCache)) {
			const def = meta.labelSets.find((x) => x.key === key);
			def.levels.forEach((l, r) => { const c = arr[r][i], nm = c !== NONE ? def.names[l][c] : null; if (nm != null) out.push([cap(l), nm]); });
		}
		const tl = meta.ranks.levels;
		for (let r = 0; r < tl.length; r++) {
			const c = taxCode(r, i), nm = c !== NONE ? taxNames[r][c] : null;
			const share = r === tl.length - 1 && tipPct && tipPct[i] !== 255 ? ` (${tipPct[i]}%)` : '';
			if (nm != null) out.push([meta.contains ? `Predominant ${tl[r]}` : cap(tl[r]), nm + share]);
		}
		if (!out.length || !navigator.clipboard) return;
		const text = out.map((x) => x.join('\t')).join('\n');
		navigator.clipboard.writeText(text).then(
			() => { if (alive) $('status').textContent = `Copied ${S ? `the ${unitOne} record` : 'the taxonomy'} to the clipboard.`; },
			() => {}
		);
	}
	// switch the labels (picker, colours, names on the globe, tooltip, search) to a label set, or back to the taxonomy
	const setCache = {}, setInfo = {};
	// a label set's tooltip: the point's own record (globe.json labelSets info: the first column is the title, lat and lon
	// are shown as one place), then its label path, top level down, with repeats dropped
	function setTip(tip, i) {
		const S = setInfo[labelKey], v = S.rows[i].split('\t'), cols = S.cols;
		tip.innerHTML = '';
		const line = (cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; tip.appendChild(d); };
		line('g', v[0] || 'unknown');
		const parts = [];
		let la = '', lo = '';
		cols.forEach((c, k) => {
			if (k === 0 || !v[k] || c === 'Dominant') return;
			if (c === 'lat') la = v[k]; else if (c === 'lon') lo = v[k];
			else if (/^\d+$/.test(v[k])) parts.push(`${c} ${(+v[k]).toLocaleString()}`);
			else parts.push(c === 'taxon' ? v[k] : `${c} ${v[k]}`);
		});
		if (parts.length) line('', parts.join(' · '));
		const di = cols.indexOf('Dominant');
		if (di > 0 && v[di]) line('', `Predominant species: ${v[di]}`);
		for (const p of picked) line('', `${p.name}: ${fmtShare(p.a[i])}`);
		const path = [];
		for (let r = 1; r < curLevels.length; r++) { const c = setArr[r][i]; const nm = c !== NONE ? rankNames[r][c] : null; if (nm && nm !== path[path.length - 1]) path.push(nm); }
		if (path.length) line('m', (S.tip ? S.tip + ' ' : '') + path.join(' › '));
		if (cols.includes('lat')) {
			// as given in the source, not rounded
			const f = (x, p, n) => `${x.trim().replace(/^[-+]/, '')}°${x.trim().startsWith('-') ? n : p}`;
			line('m', la && lo ? `${f(la, 'N', 'S')}, ${f(lo, 'E', 'W')}` : 'No coordinates');
		}
	}
	// a label set's codes (setCache) and, when it has one, its per-point record (setInfo)
	async function loadSet(def, quiet = false) {
		const key = def.key;
		if (setCache[key]) return true;
		if (!quiet) $('status').textContent = `Loading the ${def.name.toLowerCase()} labels…`;
		let b; try { b = await fetchBin(`labels_${key}.bin`); } catch { b = null; }
		if (!b || b.length !== 2 * def.levels.length * N) { if (!quiet) $('status').textContent = `The ${def.name.toLowerCase()} labels did not load. Try again.`; return false; }
		setCache[key] = def.levels.map((_, k) => new Uint16Array(b.buffer, 2 * k * N, N));
		if (def.info) {
			try {
				const r = await fetch(url(`info_${key}.txt`));
				const lines = r.ok ? (await r.text()).split('\n') : [];
				if (lines.length >= N) setInfo[key] = { cols: def.info, rows: lines, tip: def.tip || '' };
			} catch { /* the tooltip falls back to the label path */ }
		}
		return true;
	}
	async function setLabels(key) {
		if (key === labelKey) return true;
		if (key) {
			const def = meta.labelSets.find((x) => x.key === key);
			if (!def) return false;
			if (!(await loadSet(def))) return false;
			if (!alive) return false;
			setArr = setCache[key]; labelKey = key; curLevels = def.levels;
			rankNames = def.levels.map((l) => def.names[l]);
			rankCode = (r, i) => setArr[r][i];
		} else {
			labelKey = ''; setArr = null; curLevels = meta.ranks.levels; rankNames = taxNames; rankCode = taxCode;
		}
		onClear();
		namesIndex();
		buildLabels();
		const start = key ? Math.min(2, curLevels.length - 1) : Math.max(0, curLevels.indexOf('class'));
		view(start, null);
		onTaxa({ levels: curLevels, names: rankNames, find: findAny, count, describe, start, noun: key ? 'category' : 'taxon', title: key ? meta.labelSets.find((x) => x.key === key).name : 'Taxa', searchNames: searchNames(), predominant: !!meta.contains && !key, lineage: key ? undefined : find, at: lineageAt });
		return true;
	}
	on(window, 'keydown', (e) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) onClear(); });
	on($('vGlobe'), 'click', () => setView('globe'));
	on($('vFlat'), 'click', () => setView('flat'));
	on($('vDome'), 'click', () => setView('dome'));
	on($('spin'), 'click', () => { spin = !spin; $('spin').setAttribute('aria-pressed', spin ? 'true' : 'false'); });
	on($('labelsBtn'), 'click', () => { labelsOn = !labelsOn; $('labelsBtn').setAttribute('aria-pressed', labelsOn ? 'true' : 'false'); dirty = true; });
	on($('lSim'), 'click', () => showLayout('similarity'));
	on($('lSculpt'), 'click', () => showLayout('sculpt'));
	on($('asvBtn'), 'click', () => toggleAsv());
	// point size: small (the globe's own starting size) or medium; the Size button is pressed for medium
	const SIZE_STEPS = [['small', 1], ['medium', 2.2]];
	let sizeStep = 0;
	const pointSize = () => (+$('sizeBtn').dataset.small || 0.5) * SIZE_STEPS[sizeStep][1];
	on($('sizeBtn'), 'click', () => {
		sizeStep = (sizeStep + 1) % SIZE_STEPS.length;
		const b = $('sizeBtn'), next = SIZE_STEPS[(sizeStep + 1) % SIZE_STEPS.length][0];
		b.setAttribute('aria-pressed', sizeStep ? 'true' : 'false');
		b.title = `Points: ${SIZE_STEPS[sizeStep][0]} (click for ${next})`;
		dirty = true;
	});
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
		const Ws = similarity().W;
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
		const S = similarityIndex();
		asv.ref = new Int32Array(n);
		for (let j = 0; j < n; j++) {
			const q = toXyz(lon[j], lat[j]);
			let r = -1;
			for (const deg of [0.5, 2, 8, 30, 180]) { r = nearestWithin(q, S.ll, S.start, S.idx, deg * Math.PI / 180, () => false); if (r >= 0) break; }
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
		const n = asv.n, L = layouts[name], ll = new Uint16Array(2 * n);
		for (let j = 0; j < n; j++) {
			ll[2 * j] = name === 'similarity' ? asv.lon[j] : L.ll[2 * asv.ref[j]]; ll[2 * j + 1] = name === 'similarity' ? asv.lat[j] : L.ll[2 * asv.ref[j] + 1];
		}
		const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, ll, gl.STATIC_DRAW);
		const [start, idx] = cellIndex(ll, n);
		asv.layouts[name] = { buf, ll, start, idx };
	}
	function bindAsvLayout(name) {
		const A = asv.layouts[name]; if (!A) return;
		gl.bindVertexArray(asv.vao);
		const loc = gl.getAttribLocation(asvProg, 'aLL');
		gl.bindBuffer(gl.ARRAY_BUFFER, A.buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.UNSIGNED_SHORT, true, 0, 0);
		asv.ll = A.ll; asv.cellStart = A.start; asv.cellIdx = A.idx;
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

	// ---------- overlays (overlays.json beside the globe data, pipeline/pack_overlay.py): toggled per overlay,
	// fetched on first use; positions go through each layout's equator rotation like the references
	let overlays = [];
	const ovShown = () => !morph && overlays.some((o) => o.on && o.vao);
	function overlayVaos(o, raw) {
		const n = o.n, vao = {};
		o.layouts.forEach((name, k) => {
			const L = layouts[name]; if (!L) return;
			const lo = new Uint16Array(raw.buffer, raw.byteOffset + 4 * k * n, n), la = new Uint16Array(raw.buffer, raw.byteOffset + (4 * k + 2) * n, n);
			const W = L.W, ll = new Uint16Array(2 * n), K = 2 * Math.PI / 65535;
			for (let i = 0; i < n; i++) {
				const a = lo[i] * K - Math.PI, b = la[i] * Math.PI / 65535 - Math.PI / 2, cb = Math.cos(b);
				const x = cb * Math.cos(a), y = cb * Math.sin(a), z = Math.sin(b);
				const X = W[0] * x + W[1] * y + W[2] * z, Y = W[3] * x + W[4] * y + W[5] * z, Z = W[6] * x + W[7] * y + W[8] * z;
				ll[2 * i] = Math.round((Math.atan2(Y, X) + Math.PI) / (2 * Math.PI) * 65535);
				ll[2 * i + 1] = Math.round((Math.asin(Math.max(-1, Math.min(1, Z))) + Math.PI / 2) / Math.PI * 65535);
			}
			const v = gl.createVertexArray(); gl.bindVertexArray(v);
			const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, ll, gl.STATIC_DRAW);
			const loc = gl.getAttribLocation(ovProg, 'aLL'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.UNSIGNED_SHORT, true, 0, 0);
			vao[name] = v;
		});
		return vao;
	}
	async function toggleOverlay(o, btn) {
		if (!o.vao) {
			btn.disabled = true; $('status').textContent = `Loading ${o.label}…`;
			try { o.vao = overlayVaos(o, await fetchBin(o.file)); } catch { $('status').textContent = `${o.label} did not load. Try again.`; btn.disabled = false; return; }
			btn.disabled = false;
		}
		o.on = !o.on; btn.setAttribute('aria-pressed', o.on ? 'true' : 'false');
		const on = overlays.filter((x) => x.on);
		$('status').textContent = on.length
			? `${on.reduce((t, x) => t + x.n, 0).toLocaleString()} reads placed on the map (${on.map((x) => x.label).join(', ')})`
			: IDLE;
		dirty = true;
	}
	async function loadOverlays() {
		let list;
		try { const r = await fetch(url('overlays.json')); if (!r.ok) return; list = await r.json(); } catch { return; }
		if (!alive || !Array.isArray(list) || !list.length) return;
		overlays = list.map((o) => ({ ...o, on: false, vao: null }));
		const row = $('ovRow');
		for (const o of overlays) {
			const b = document.createElement('button');
			b.className = 'btn toggle ov'; b.setAttribute('aria-pressed', 'false');
			const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = o.colour;
			b.append(sw, document.createTextNode(o.label));
			b.title = `${o.n.toLocaleString()} reads`;
			o.btn = b;
			on(b, 'click', () => toggleOverlay(o, b));
			row.appendChild(b);
		}
		row.hidden = false;
	}

	// ---------- shows: a keyframed camera path, played in real time (?show=URL; space pauses, left/right step 5 s)
	// { "mode": "dome", "morph": 3, "keys": [ { "t": 0, "look": "Cyanobacteria", "zoom": 1, ... } ] }
	// A key holds the time t (s) and whatever changes there; the rest carries over from the key before.
	//   look (a taxon name) or lon, lat (degrees): what is looked at        zoom: 1 = from the centre, n = n times closer
	//   alt: how high above the dome's front horizon it sits (degrees)      roll (degrees)      ease: 'smooth' | 'linear' (arriving)
	//   size, alpha (points), labels (0..1 opacity): blended between keys   layout (a layout file name, e.g. sculpt or
	//   similarity; morphs over `morph` s), select (taxon name or ''), flags (the label checks): switch at t
	let show = Q.get('show') ? { url: Q.get('show'), ready: false, t: 0, paused: false, ov: null } : null;
	const matQuat = (m) => {
		const tr = m[0] + m[4] + m[8]; let w, x, y, z, S;
		if (tr > 0) { S = Math.sqrt(tr + 1) * 2; w = S / 4; x = (m[7] - m[5]) / S; y = (m[2] - m[6]) / S; z = (m[3] - m[1]) / S; }
		else if (m[0] > m[4] && m[0] > m[8]) { S = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / S; x = S / 4; y = (m[1] + m[3]) / S; z = (m[2] + m[6]) / S; }
		else if (m[4] > m[8]) { S = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / S; x = (m[1] + m[3]) / S; y = S / 4; z = (m[5] + m[7]) / S; }
		else { S = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / S; x = (m[2] + m[6]) / S; y = (m[5] + m[7]) / S; z = S / 4; }
		return [w, x, y, z];
	};
	const quatMat = ([w, x, y, z]) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
		2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
	function slerp(a, b, u) {
		let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const sg = d < 0 ? -1 : 1; d = Math.min(1, Math.abs(d));
		const th = Math.acos(d), sn = Math.sin(th), fa = sn < 1e-5 ? 1 - u : Math.sin((1 - u) * th) / sn, fb = sg * (sn < 1e-5 ? u : Math.sin(u * th) / sn);
		const q = a.map((v, i) => fa * v + fb * b[i]), l = Math.hypot(...q);
		return q.map((v) => v / l);
	}
	// a show's taxon: that name, else the most-used one containing it (SILVA says Cyanobacteriota, Prochlorococcus MIT9313)
	function showFind(name) {
		const t = name.trim().toLowerCase();
		if (uses(t).length) return find(t);
		let best = null, n = -1;
		for (const [k, v] of byName) if (k.includes(t) && v[0].count > n) { best = k; n = v[0].count; }
		return best && find(best);
	}
	// where a taxon sits in a layout: its member nearest the centroid, as [lon, lat] in degrees
	function anchorOf(name, layout) {
		const hit = showFind(name), L = layouts[layout]; if (!hit || !L) return null;
		const { rank, code } = hit[hit.length - 1], P = L.ll, c = [0, 0, 0];
		for (let i = 0; i < N; i++) if (rankCode(rank, i) === code) { const q = toXyz(P[2 * i], P[2 * i + 1]); c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; }
		let best = -Infinity, at = -1;
		for (let i = 0; i < N; i++) if (rankCode(rank, i) === code) { const d = dotLL(P, i, c[0], c[1], c[2]); if (d > best) { best = d; at = i; } }
		if (at < 0) return null;
		const q = toXyz(P[2 * at], P[2 * at + 1]);
		return [Math.atan2(q[1], q[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, q[2]))) / RAD];
	}
	async function initShow() {
		const r = await fetch(show.url); if (!r.ok) throw new Error(`${r.status}`);
		const S = await r.json();
		if (!alive) return;
		if (S.mode === 'dome') setView('dome');
		let st = { lon: 0, lat: 7, zoom: 1, alt: domeAlt, roll: 0, layout: current, select: '', flags: false, labels: 1, size: pointSize(), alpha: 1 };
		const keys = [];
		for (const k of S.keys) {
			const prev = st; st = { ...st, ...k, ease: k.ease || 'smooth' };
			if (!(await ensureLayout(st.layout))) { console.warn(`show: no layout "${st.layout}" in this globe`); st.layout = prev.layout; }
			if (st.flags && !(await ensureFlags())) { console.warn('show: this globe has no label checks'); st.flags = false; }
			if (!alive) return;
			if (k.look) { const p = anchorOf(k.look, st.layout); if (p) [st.lon, st.lat] = p; else console.warn(`show: nothing named "${k.look}"`); }
			if (dome) st.zoom = Math.max(1, st.zoom);
			domeAlt = st.alt; st.q = matQuat(poseRot(st.lon * RAD, st.lat * RAD, st.roll * RAD));
			keys.push(st);
		}
		keys.sort((a, b) => a.t - b.t);
		Object.assign(show, { keys, morphDur: S.morph || 3, duration: Math.max(1e-3, S.duration || keys[keys.length - 1].t), sel: '', bound: '', indexed: current, ready: true });
		applyShow(0);
	}
	function applyShow(t) {
		const K = show.keys; let j = 0; while (j + 1 < K.length && K[j + 1].t <= t) j++;
		const a = K[j], b = K[j + 1] || a;
		let u = b === a ? 0 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
		if (b.ease !== 'linear') u = u * u * u * (u * (6 * u - 15) + 10);
		const mix = (x, y) => x + (y - x) * u;
		rot = quatMat(slerp(a.q, b.q, u)); zoom = Math.exp(mix(Math.log(a.zoom), Math.log(b.zoom))); domeAlt = mix(a.alt, b.alt);
		show.ov = { size: mix(a.size, b.size), alpha: mix(a.alpha, b.alpha) };
		$('labels').style.opacity = mix(a.labels, b.labels).toFixed(3);
		// layout: morph for morphDur seconds from the key where it changed
		let m = j; while (m > 0 && K[m - 1].layout === a.layout) m--;
		const mu = m > 0 ? (t - K[m].t) / show.morphDur : 1, from = mu < 1 ? K[m - 1].layout : a.layout;
		if (show.bound !== from + '>' + a.layout) { bindLayouts(layouts[from], layouts[a.layout]); show.bound = from + '>' + a.layout; }
		morph = mu < 1 ? { t: mu < 0.5 ? 4 * mu * mu * mu : 1 - Math.pow(-2 * mu + 2, 3) / 2 } : null;
		if (morph) prevLayout = from;
		if (!morph && show.indexed !== a.layout) { buildIndex(layouts[a.layout]); if (asv) bindAsvLayout(a.layout); show.indexed = a.layout; }
		current = a.layout;
		// selection goes through the picker (as a click would), which colours the globe by the rank below it
		if (a.select !== show.sel) { show.sel = a.select; const lineage = a.select && showFind(a.select); if (lineage) onPick(lineage); else onClear(); }
		if (a.flags !== flagMode) setColour(a.flags);
		draw(); placeLabels(); dirty = false; broadcast();
	}
	on(window, 'keydown', (e) => {
		if (!show?.ready) return;
		if (e.key === ' ') { show.paused = !show.paused; e.preventDefault(); }
		if (e.key === 'ArrowRight') show.t = Math.min(show.duration, show.t + 5);
		if (e.key === 'ArrowLeft') show.t = Math.max(0, show.t - 5);
	});


	// ---------- sync across screens (?sync=ROOM through /earthdna/sync/ROOM, src/routes/earthdna/sync): one screen leads
	// and sends its state each time it draws; the others draw what they are sent. Touching a screen (pointer, wheel,
	// keys) makes it the leader, so the controls work from whichever screen the pointer is on. The state names the
	// leader's globe (its page path): a screen on another globe loads that one, keeping its own settings, except a
	// screen opened with &lead, which takes the lead for its own globe (the room still holds the last globe's state
	// when the lead screen has just switched). The 3D mouse arrives
	// through the same room (earthdna viewer/lg_server.py --relay); the leader applies it, and a screen opened with
	// &lead takes the lead when it moves. Followers hide the cards unless given &ui.
	const ROOM = Q.get('sync') || '';
	const SYNC = /^[A-Za-z0-9_-]{12,64}$/.test(ROOM) ? `/earthdna/sync/${ROOM}` : '';
	const ID = (WALL ? `s${WALL.i}-` : '') + Math.random().toString(36).slice(2, 8);
	let leading = !SYNC || Q.has('lead'), epoch = 0, lastSync = null, syncBound = '', syncIndexed = '', syncVw = '', syncOv = null;
	const r6 = (v) => Math.round(v * 1e6) / 1e6;
	const post = (what, body) => fetch(`${SYNC}/${what}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
	const filterDesc = (f) => (f ? (f.contains ? { n: f.within ?? f.name, k: 1, r: f.rank, c: f.code } : { r: f.rank, c: f.code }) : null);
	function snapshot() {
		return {
			e: epoch, from: ID, path: location.pathname, rot: rot.map(r6), zoom: r6(zoom), view: dome ? 'dome' : flat ? 'flat' : 'globe', alt: r6(domeAlt),
			cur: current, prev: morph ? prevLayout || current : current, mt: morph ? r6(morph.t) : 1,
			flags: flagMode, trait, traitNeg, labelKey, vw: lastView ? { l: lastView.level, f: filterDesc(lastView.filter), m: lastView.mark?.name ?? null } : null,
			labelsOn, sizeStep, spin, asv: asvOn, runs: asv ? runs.filter((_, k) => asv.runOn[k]).map((r) => r.id) : null,
			ovs: overlays.filter((o) => o.on).map((o) => o.file), sov: show?.ov || null, lop: $('labels').style.opacity || ''
		};
	}
	let lastSent = '', sendNext = null, sending = false;
	function broadcast() {
		if (!SYNC || !leading || !rankArr) return;
		const b = JSON.stringify(snapshot()); if (b === lastSent) return;
		lastSent = sendNext = b; if (!sending) pump();
	}
	async function pump() {  // one request at a time; frames drawn meanwhile are dropped, the newest goes next
		sending = true;
		while (sendNext && alive) { const b = sendNext; sendNext = null; try { await post('state', b); } catch { /* the relay is away: keep drawing */ } }
		sending = false;
	}
	function takeLead() {
		if (!SYNC || leading) return;
		leading = true; epoch++; syncBound = syncIndexed = syncVw = ''; syncOv = null;
		if (morph && !morph.t0) { const L = layouts[current]; morph = null; bindLayouts(L, L); buildIndex(L); if (asv) bindAsvLayout(current); }  // a follower's morph has no clock
		$('spin').setAttribute('aria-pressed', spin ? 'true' : 'false');
		$('labelsBtn').setAttribute('aria-pressed', labelsOn ? 'true' : 'false');
		lastSent = ''; dirty = true;
	}
	function stepDown() { leading = false; dragging = false; pointers.clear(); }
	for (const ev of ['pointerdown', 'wheel', 'keydown']) on(window, ev, takeLead, { capture: true, passive: true });
	// the picker asks view() too; on a following screen the leader's choice stands
	const pageView = (level, filter, mark = null) => (SYNC && !leading ? lastRanked : view(level, filter, mark));
	let syncBusy = false, syncNext = null;
	async function applySync(S) {  // newest wins; a state that needs data still loading waits for it
		syncNext = S; if (syncBusy) return; syncBusy = true;
		try { while (syncNext && alive) { const st = syncNext; syncNext = null; if (!leading && st.path === location.pathname) await applyState(st); } }
		catch (e) { console.warn('sync:', e); }
		finally { syncBusy = false; }
	}
	async function applyState(s) {
		if (!rankArr) return;  // load() applies lastSync once the taxonomy is in
		for (const L of new Set([s.cur, s.prev])) if (!(await ensureLayout(L))) return;
		if (s.labelKey !== labelKey) { if (!(await setLabels(s.labelKey))) return; syncVw = ''; }
		if (s.flags !== flagMode) await setColour(s.flags);
		let filter = null;
		const f = s.vw?.f;
		if (f?.k) {
			const hit = containsLookup(f.n), r = f.r ?? -1;
			if (hit) { try { filter = { rank: r, code: r < 0 ? -1 : f.c, name: r < 0 ? hit.name : rankNames[r][f.c], contains: await containsMembers(hit), within: r < 0 ? undefined : hit.name }; } catch { /* shown unfiltered */ } }
		}
		else if (f) filter = { rank: f.r, code: f.c };
		let mark = null;
		if (s.vw?.m) { const hit = containsLookup(s.vw.m); if (hit) { try { mark = { rank: -1, code: -1, name: hit.name, contains: await containsMembers(hit) }; } catch { /* shown unmarked */ } } }
		if (s.asv !== asvOn && runs.length) await toggleAsv();
		for (const o of overlays) if (o.btn && o.on !== s.ovs.includes(o.file)) await toggleOverlay(o, o.btn);
		if (!alive || leading) return;
		rot = s.rot.slice(); zoom = s.zoom; domeAlt = s.alt;
		if (dome !== (s.view === 'dome') || flat !== (s.view === 'flat')) {
			dome = s.view === 'dome'; flat = s.view === 'flat';
			for (const [id, m] of [['vGlobe', 'globe'], ['vFlat', 'flat'], ['vDome', 'dome']]) $(id).setAttribute('aria-pressed', m === s.view ? 'true' : 'false');
		}
		const bound = `${s.prev}>${s.cur}`;
		if (syncBound !== bound) { bindLayouts(layouts[s.prev], layouts[s.cur]); syncBound = bound; }
		const dash = s.cur.indexOf('-');
		prevLayout = s.prev; current = s.cur; shape = dash < 0 ? s.cur : s.cur.slice(0, dash); model = dash < 0 ? '' : s.cur.slice(dash + 1);
		morph = s.mt < 1 ? { t: s.mt } : null;
		if (!morph && syncIndexed !== s.cur) { buildIndex(layouts[s.cur]); if (asv) bindAsvLayout(s.cur); syncIndexed = s.cur; }
		const vw = JSON.stringify([s.vw, s.trait, s.traitNeg]);
		if (vw !== syncVw) { trait = s.trait; traitNeg = s.traitNeg; syncVw = vw; if (s.vw) view(s.vw.l, filter, mark); }
		if (asv && s.runs) {
			let changed = false;
			runs.forEach((r, k) => { const v = s.runs.includes(r.id) ? 1 : 0; if (asv.runOn[k] !== v) { asv.runOn[k] = v; changed = true; } });
			if (changed) syncAsvOn();
		}
		labelsOn = s.labelsOn; sizeStep = s.sizeStep; spin = s.spin; syncOv = s.sov; $('labels').style.opacity = s.lop;
		dirty = true;
	}
	// ---------- 3D mouse (SpaceNavigator): six axes, each about -1..1 at full push. Tilting and sliding turn the globe
	// (about its pole and toward one, like a drag), twisting turns it about the pole too (rolls the dome and map), pushing
	// down zooms in.
	const nav = { a: [0, 0, 0, 0, 0, 0], at: 0 }, NAVK = +(Q.get('navspeed') || 1);
	// pushed past the dead zone (a released device rests slightly off zero); a lost release ends after 1 s
	const navActive = () => nav.a.some((v) => Math.abs(v) >= 0.06) && performance.now() - nav.at < 1000;
	function applyNav(dt) {
		const dz = (v) => (Math.abs(v) < 0.06 ? 0 : v), [x, y, z, rx, ry, rz] = nav.a.map(dz);
		const k = 1.4 * dt * NAVK / Math.sqrt(zoom);
		stopSpin();
		if (flat || dome) rot = mul(rotZ(-rz * k), mul(rotY((x + ry) * k), mul(rotX((rx - y) * k), rot)));
		else earthDrag((x + ry - rz) * k, (rx - y) * k);
		setZoom(zoom * Math.exp(z * 1.6 * dt * NAVK));
		dirty = true;
	}
	if (SYNC) {
		// nobody sees a wall screen's console: its errors go to the server's log
		const report = (m) => post('log', JSON.stringify({ screen: WALL ? WALL.i : null, ua: (navigator.userAgent.match(/Firefox\/[\d.]+|Chrome\/[\d.]+/) || [''])[0], m: String(m).slice(0, 1500) })).catch(() => {});
		on(window, 'error', (e) => report(`${e.message} at ${e.lineno}:${e.colno}`));
		on(window, 'unhandledrejection', (e) => report(`unhandled: ${e.reason?.stack || e.reason?.message || e.reason}`));
		const es = new EventSource(`${SYNC}/events`);
		cleanups.push(() => es.close());
		es.onmessage = (m) => {
			const st = JSON.parse(m.data);
			if (st.from === ID) return;
			if (st.path && st.path !== location.pathname) {
				if (Q.has('lead')) { if (st.e >= epoch) { epoch = st.e + 1; leading = true; lastSent = ''; dirty = true; } return; }
				if (st.e >= epoch) { es.close(); location.assign(st.path + location.search); }
				return;
			}
			if (st.e < epoch) return;
			if (st.e > epoch || st.from > ID) { epoch = st.e; if (leading) stepDown(); }
			if (leading) return;
			lastSync = st; applySync(st);
		};
		es.addEventListener('nav', (m) => {
			const d = JSON.parse(m.data);
			if (Q.has('lead') && d.a.some((v) => Math.abs(v) > 0.06)) takeLead();
			nav.a = d.a; nav.at = performance.now();
		});
	}

	// ---------- load
	async function load() {
		const mres = await fetch(url('globe.json'));
		if (!mres.ok) throw new Error('data files missing');
		meta = await mres.json(); N = meta.n;
		// positions + group (5 bytes per sequence), streamed for a progress count
		const bres = await fetch(url('pos.bin'));
		if (!bres.ok) throw new Error('data files missing');
		// read straight into one buffer (no second copy of the chunks)
		const total = 5 * N, reader = bres.body.getReader(), ab = new ArrayBuffer(total), dst = new Uint8Array(ab); let got = 0;
		for (;;) {
			const { done, value } = await reader.read(); if (done) break;
			if (!alive) { reader.cancel(); return; }
			if (got + value.length > total) { reader.cancel(); throw new Error('data file has the wrong size'); }
			dst.set(value, got); got += value.length;
			$('loading').textContent = `Loading ${N.toLocaleString()} ${unit}… ${Math.min(100, Math.round(100 * got / total))}%`;
		}
		if (got !== total) throw new Error('data file has the wrong size');
		grp = new Uint8Array(ab, 4 * N, N);
		$('loading').textContent = 'Loading the taxonomy…';
		const sculptReq = fetchBin('layout_sculpt.bin').catch(() => null);
		const ranksReq = fetchBin('ranks.bin');
		const recReq = meta.records ? fetchBin('records.bin') : null;
		const tx = await fetchBin('tax.bin'), M = meta.records || N;  // taxonomy rows: per point, or per record
		const sb4 = meta.speciesBytes === 4;
		if (tx.length !== (sb4 ? 8 : 6) * M) throw new Error('taxonomy file has the wrong size');
		if (recReq) {
			const rb = await recReq;
			if (rb.length !== 4 * N) throw new Error('record file has the wrong size');
			rec = new Uint32Array(rb.buffer, 0, N);
		}
		if (!alive) return;
		gen = new Uint16Array(tx.buffer, 0, M); lin = new Uint16Array(tx.buffer, 2 * M, M);
		if (sb4) {
			// more species than uint16 holds (GTDB): uint32 codes, 2^32-1 = none. Codes from 65535 up move up one and
			// 65535 becomes none, so every NONE check keeps working; the species list gets a gap at 65535 to match.
			spc = new Uint32Array(tx.buffer, 4 * M, M);  // rewritten in place
			for (let i = 0; i < M; i++) { const c = spc[i]; spc[i] = c === 0xffffffff ? NONE : c >= NONE ? c + 1 : c; }
			if (meta.species.length >= NONE) meta.species.splice(NONE, 0, null);
		} else spc = new Uint16Array(tx.buffer, 4 * M, M);
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
			layouts.sculpt = makeLayout(new Uint16Array(sb.buffer, 0, N), new Uint16Array(sb.buffer, 2 * N, N), 'sculpt');
			bindLayouts(layouts.sculpt, layouts.sculpt);
		} else { current = shape = 'similarity'; similarity(); bindLayouts(layouts.similarity, layouts.similarity); }
		// a globe built without a sculpted layout (globe.json layouts) has nothing for Shaped by to switch to
		if (meta.layouts && !meta.layouts.includes('sculpt')) $('lSculpt').closest('.row').hidden = true;
		for (const [id, n] of [['lSim', 'similarity'], ['lSculpt', 'sculpt']]) $(id).setAttribute('aria-pressed', n === current ? 'true' : 'false');
		// Model: which embedding placed the points (the DNA-model globe); the first entry's layouts carry no suffix
		// a globe in a family (the Metagenomes menu) lists its models there, in place of its own entry, so one menu
		// picks both the globe and how it is laid out
		const vEl = $('variant');
		if (meta.models?.length > 1 && vEl) {
			// the globe's own entry keeps its value (the page keeps the menu on it) and stands for the first model
			const own = [...vEl.options].find((o) => o.selected) || vEl.options[0], slug = own.value, text = own.textContent;
			const val = (key) => (key ? `model:${key}` : slug);
			own.textContent = `${text} · ${meta.models[0].label}`;
			let after = own;
			for (const x of meta.models.slice(1)) { const o = new Option(`${text} · ${x.label}`, val(x.key)); after.after(o); after = o; }
			on(vEl, 'change', async () => {
				const v = vEl.value;
				if (v !== slug && !v.startsWith('model:')) return;  // another globe: the page loads it
				const key = v === slug ? '' : v.slice(6);
				if (!(await showLayout(shape, key))) vEl.value = val(model);
			});
		} else if (meta.models?.length > 1) {
			const mEl = $('model');
			for (const x of meta.models) mEl.add(new Option(x.label, x.key));
			$('modelRow').hidden = false;
			on(mEl, 'change', async () => { if (!(await showLayout(shape, mEl.value))) mEl.value = model; });
		}
		buildIndex(layouts[current]);
		// rank codes for the picker: domain (from the groups), phylum..family, genus, species. The globe opens
		// coloured by class (TaxonPicker's default), so it is coloured that way before it first shows.
		const rk = await ranksReq;
		if (!alive) return;
		if (rk.length !== 8 * M) throw new Error('rank file has the wrong size');
		rankArr = [0, 1, 2, 3].map((k) => new Uint16Array(rk.buffer, 2 * k * M, M));
		const R = meta.ranks;
		rankNames = taxNames = [doms, ...R.levels.slice(1, 5).map((l) => R.names[l]), meta.genera, meta.species];
		curLevels = R.levels;
		if (meta.tipPercent) { try { const b = await fetchBin('tippct.bin'); if (b.length === N) tipPct = b; } catch { /* no percentages */ } }
		if (meta.rankPercent) {
			try {
				const b = await fetchBin('rankpct.bin'), L = meta.rankPercent.length;
				if (b.length === 2 * L * N) {
					const u = new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
					rankPct = meta.ranks.levels.map((l) => { const q = meta.rankPercent.indexOf(l); return q < 0 ? null : u.subarray(q * N, (q + 1) * N); });
				}
			} catch { /* no shares */ }
		}
		// Highlight: genome traits (traits.bin, GTDB) and taxonomic disagreements (flags.bin, the label checks)
		const selEl = $('trait');
		selEl.options[0].textContent = `All ${unit}`;
		if (meta.traits?.length) {
			const tb = await fetchBin('traits.bin').catch(() => null);
			if (tb && tb.length === M) {
				traits = tb;
				for (const [k, name] of meta.traits.entries()) {
					selEl.add(new Option(TRAIT_LABEL[name] || name, String(k)));
					if (TRAIT_NOT[name]) selEl.add(new Option(TRAIT_NOT[name], `!${k}`));
				}
			}
		}
		if (meta.flags) selEl.add(new Option('Taxonomic disagreements', 'flags'));
		if (selEl.options.length > 1) {
			$('traitRow').hidden = false;
			on(selEl, 'change', async () => {
				const v = selEl.value;
				if (v === 'flags') { trait = -1; onRefresh(); await setColour(true); return; }
				traitNeg = v.startsWith('!'); trait = parseInt(v.replace('!', ''), 10);
				if (flagMode) await setColour(false);
				onRefresh();
			});
		}
		view(Math.max(0, R.levels.indexOf('class')), null);
		loadCoast();
		$('nseq').textContent = N.toLocaleString();
		$('loading').hidden = true; dirty = true;
		// amplicon runs load and show only when asked (Show amplicon runs)
		namesIndex();
		onTaxa({ levels: R.levels, names: rankNames, find: findAny, count, describe, searchNames: searchNames(), predominant: !!meta.contains, lineage: find, at: lineageAt });
		// Labels: the taxonomy, or a label set the globe carries (e.g. each point's environment)
		if (meta.labelSets?.length) {
			const lEl = $('labelSet');
			lEl.add(new Option('Taxonomy', ''));
			for (const x of meta.labelSets) lEl.add(new Option(x.name, x.key));
			$('labelSetRow').hidden = false;
			on(lEl, 'change', async () => { if (!(await setLabels(lEl.value))) lEl.value = labelKey; });
			if (meta.defaultLabels && (await setLabels(meta.defaultLabels))) lEl.value = labelKey;
		}
		loadOverlays();
		if (lastSync) applySync(lastSync);
		// a show that does not load leaves the globe as it is, with its panels back
		if (show) initShow().catch((e) => { if (!alive) return; show = null; root.classList.remove('clean'); $('labels').style.opacity = ''; $('status').textContent = `The show did not load (${e.message}).`; });
	}
	resize(); centreOn(0, 0.12);
	if (Q.has('dome')) setView('dome');
	if (Q.get('ui') === '0' || show || (SYNC && !Q.has('lead') && !Q.has('ui'))) root.classList.add('clean');
	// a wall screen: the globe fills the window, over the site's navigation
	if (WALL) { root.classList.add('wall'); document.documentElement.classList.add('earthdna-wall'); cleanups.push(() => document.documentElement.classList.remove('earthdna-wall')); }
	raf = requestAnimationFrame(frame);
	load().catch((e) => { if (alive) $('loading').textContent = `The ${unitOne} data did not load (${e.message}). Reload the page to try again.`; });

	const destroy = () => {
		alive = false;
		cancelAnimationFrame(raf); if (hoverReq) cancelAnimationFrame(hoverReq);
		for (const f of cleanups) f();
		gl.getExtension('WEBGL_lose_context')?.loseContext();
	};
	return { destroy, view: pageView };
}
