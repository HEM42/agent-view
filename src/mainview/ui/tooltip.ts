/** Tooltip text for the canvas hover. Everything from outside is escaped: it lands in innerHTML. */

export function fmtDuration(ms: number): string {
	const s = Math.floor(Math.max(0, ms) / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}

const FOCUS_HINT = `<span class="k">double-click</span> to focus parent`;

export function droneTooltip(
	d: { type: string; model?: string; description?: string; startedAt: number },
	parent: { agent: string; project: string } | null,
	wallNow: number,
): string {
	const head = d.model ? `${d.type} · ${d.model}` : d.type;
	return [
		`<span class="k">${escapeHtml(head)}</span>`,
		...(d.description ? [escapeHtml(d.description)] : []),
		`running ${fmtDuration(wallNow - d.startedAt)}`,
		...(parent ? [`subagent of ${escapeHtml(parent.agent)} · ${escapeHtml(parent.project)}`] : []),
		FOCUS_HINT,
	].join("<br>");
}

export function moreTooltip(hidden: { type: string }[]): string {
	const counts = new Map<string, number>();
	for (const s of hidden) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
	const parts = [...counts]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
		.map(([type, n]) => (n > 1 ? `${escapeHtml(type)} ×${n}` : escapeHtml(type)));
	return `<span class="k">${hidden.length} more:</span> ${parts.join(", ")}<br>${FOCUS_HINT}`;
}
