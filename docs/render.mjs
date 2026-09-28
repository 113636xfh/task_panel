// Render SVG -> PNG with resvg (deterministic, no browser, crisp at any width).
// Port of the svg-diagram-authoring skill's scripts/render.mjs.
//
//   node docs/render.mjs                 # render every non-underscore .svg in docs/src
//   node docs/render.mjs 01-name         # render just these (bare names, no extension)
//
// Requires: @resvg/resvg-js (devDependency).
//
// Rules baked in (see skill §1/§5.8/§5.9):
//   * resvg only paints text if a system font is present -> loadSystemFonts.
//   * resvg does NOT apply CSS classes or <style> blocks — inline attrs only.
//   * `fitTo` is untrusted (silently ignored on complex docs): rewrite root
//     width/height from the viewBox, then assert the real PNG dims (IHDR).
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const srcDir = process.env.SRC_DIR || "docs/src";
const outDir = process.env.OUT_DIR || "docs/images";
const width = Number(process.env.WIDTH || 1600);

if (!existsSync(srcDir)) {
	console.error(`error: source dir not found: ${srcDir} (set SRC_DIR to your SVG directory)`);
	process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// Rewrite root <svg> width/height from the viewBox (fitTo is untrusted).
function scaleSvg(svg, targetWidth) {
	const m = svg.match(/<svg[^>]*\bviewBox="0 0 ([0-9.]+) ([0-9.]+)"[^>]*>/);
	if (!m) throw new Error('svg has no viewBox="0 0 w h" — cannot scale deterministically');
	const targetH = Math.round((targetWidth / Number(m[1])) * Number(m[2]));
	return svg.replace(
		/<svg([^>]*)>/,
		(_all, attrs) =>
			`<svg${attrs.replace(/\s(width|height)="[^"]*"/g, " ").replace(/\s*$/, ` width="${targetWidth}" height="${targetH}"`)}>`
	);
}

// PNG IHDR: width/height are big-endian u32 at offsets 16/20.
function pngDims(buf) {
	return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const names = process.argv.slice(2).length
	? process.argv.slice(2)
	: readdirSync(srcDir)
			.filter((f) => f.endsWith(".svg") && !f.startsWith("_"))
			.map((f) => f.replace(/\.svg$/, ""));

for (const name of names) {
	const srcPath = join(srcDir, `${name}.svg`);
	if (!existsSync(srcPath)) {
		console.error(`error: no such source: ${srcPath}`);
		console.error(`available: ${readdirSync(srcDir).filter((f) => f.endsWith(".svg")).join(" ") || "(none)"}`);
		process.exit(1);
	}
	const svg = scaleSvg(readFileSync(srcPath, "utf-8"), width);
	const png = new Resvg(svg, {
		background: "#ffffff",
		fonts: { loadSystemFonts: true },
	}).render().asPng();
	const { w, h } = pngDims(png);
	if (w !== width) {
		console.error(`error: ${name} rendered ${w}px, expected ${width}px — resvg ignored the root size; investigate before shipping`);
		process.exit(1);
	}
	writeFileSync(join(outDir, `${name}.png`), png);
	console.log(`rendered ${outDir}/${name}.png (${png.length} bytes, ${w}x${h})`);
}
