import { PAL } from "../sprites/palette";
import { renderText, textWidth, GLYPH_H } from "./font3x5";

const PAD = 2;

/**
 * One-line tag: "agent·project" with the agent in its outfit color and the
 * project in its accent color, on a translucent ink plate. Rendered once at
 * 1x font scale and cached; the HUD layer scales it to a fixed on-screen
 * size independent of the scene zoom.
 */
export function makeNametag(
	agent: string,
	project: string,
	agentColor: string,
	accentColor: string,
): OffscreenCanvas {
	const a = agent.toLowerCase();
	const p = project.toLowerCase();
	const aImg = renderText(a, agentColor);
	const dotImg = renderText("·", PAL.steel);
	const pImg = renderText(p, accentColor);

	const w = textWidth(a) + 1 + textWidth("·") + 1 + textWidth(p) + PAD * 2;
	const h = GLYPH_H + PAD * 2;
	const out = new OffscreenCanvas(w, h);
	const ctx = out.getContext("2d")!;
	ctx.fillStyle = "rgba(10,6,19,0.78)";
	ctx.fillRect(0, 0, w, h);
	ctx.strokeStyle = "rgba(76,74,130,0.5)";
	ctx.lineWidth = 1;
	ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
	let x = PAD;
	ctx.drawImage(aImg, x, PAD);
	x += textWidth(a) + 1;
	ctx.drawImage(dotImg, x, PAD);
	x += textWidth("·") + 1;
	ctx.drawImage(pImg, x, PAD);
	return out;
}
