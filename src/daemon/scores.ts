import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const stamp = (msg: string): void => console.log(`${new Date().toISOString()} ${msg}`);

export interface ScoreRow {
	key: string; // agent·project, as on the nametag
	agent: string;
	project: string;
	wins: number;
	losses: number;
}

export interface Fighter {
	agent: string;
	project: string;
}

const isRow = (r: unknown): r is ScoreRow => {
	const o = r as Partial<ScoreRow> | null;
	return (
		!!o &&
		typeof o.key === "string" &&
		typeof o.agent === "string" &&
		typeof o.project === "string" &&
		Number.isInteger(o.wins) &&
		Number.isInteger(o.losses)
	);
};

/** The persistent duel scoreboard. A null path keeps it in memory only. */
export class ScoreBook {
	private byKey = new Map<string, ScoreRow>();

	constructor(
		private path: string | null,
		private log: (msg: string) => void = stamp,
	) {}

	async load(): Promise<void> {
		if (!this.path) return;
		let text: string;
		try {
			text = await readFile(this.path, "utf8");
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
			await this.quarantine(`unreadable: ${String(e)}`);
			return;
		}
		try {
			const data = JSON.parse(text) as { version?: unknown; rows?: unknown };
			if (data.version !== 1 || !Array.isArray(data.rows) || !data.rows.every(isRow)) throw new Error("unexpected shape");
			this.byKey = new Map((data.rows as ScoreRow[]).map((r) => [r.key, { ...r }]));
		} catch (e) {
			await this.quarantine(`corrupt: ${String(e)}`);
		}
	}

	private async quarantine(why: string): Promise<void> {
		this.byKey = new Map();
		try {
			await rename(this.path!, `${this.path}.bad`);
		} catch {
			// already gone, or not movable: start empty regardless
		}
		this.log(`scores file ${why}; moved to ${this.path}.bad, starting empty`);
	}

	record(winner: Fighter, loser: Fighter): void {
		this.row(winner).wins++;
		this.row(loser).losses++;
	}

	private row(f: Fighter): ScoreRow {
		const key = `${f.agent}·${f.project}`;
		let r = this.byKey.get(key);
		if (!r) {
			r = { key, agent: f.agent, project: f.project, wins: 0, losses: 0 };
			this.byKey.set(key, r);
		}
		return r;
	}

	rows(): ScoreRow[] {
		return [...this.byKey.values()]
			.map((r) => ({ ...r }))
			.sort((x, y) => y.wins - x.wins || x.losses - y.losses || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
	}

	async save(): Promise<void> {
		if (!this.path) return;
		await mkdir(dirname(this.path), { recursive: true });
		const tmp = `${this.path}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify({ version: 1, rows: this.rows() }, null, 2));
		await rename(tmp, this.path);
	}
}
