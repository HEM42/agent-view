import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const stamp = (msg: string): void => console.log(`${new Date().toISOString()} ${msg}`);

export interface ScoreRow {
	key: string; // agent·project, as on the nametag
	agent: string;
	project: string;
	wins: number;
	losses: number;
}

/** Yesterday's winner, as stored and served. */
export interface ChampionRow {
	agent: string;
	project: string;
	wins: number;
	losses: number;
	day: string; // the local day they won, YYYY-MM-DD
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

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isChampion = (c: unknown): c is ChampionRow => {
	const o = c as Partial<ChampionRow> | null;
	return (
		!!o &&
		typeof o.agent === "string" &&
		typeof o.project === "string" &&
		Number.isInteger(o.wins) &&
		Number.isInteger(o.losses) &&
		typeof o.day === "string" &&
		DAY.test(o.day)
	);
};

/** The local calendar date as YYYY-MM-DD. */
export function today(now: Date | number): string {
	const d = new Date(now);
	const p = (n: number): string => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The persistent duel scoreboard. A null path keeps it in memory only. */
export class ScoreBook {
	private byKey = new Map<string, ScoreRow>();
	private day: string;
	private champ: ChampionRow | null = null;
	/** writes run one after another, so a rollover and a result save never interleave */
	private chain: Promise<void> = Promise.resolve();

	constructor(
		private path: string | null,
		private log: (msg: string) => void = stamp,
		now: Date | number = Date.now(),
	) {
		this.day = today(now);
	}

	async load(): Promise<void> {
		if (!this.path) return;
		let text: string;
		try {
			text = await readFile(this.path, "utf8");
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
			// EACCES, EIO, a directory...: the file may be fine, so leave it where it is
			this.byKey = new Map();
			this.champ = null;
			this.log(`scores file unreadable (left in place): ${String(e)}; starting empty`);
			return;
		}
		try {
			const data = JSON.parse(text) as { version?: unknown; rows?: unknown; day?: unknown; champion?: unknown };
			if (data.version !== 1 || !Array.isArray(data.rows) || !data.rows.every(isRow)) throw new Error("unexpected shape");
			if (data.day !== undefined && !(typeof data.day === "string" && DAY.test(data.day))) throw new Error("bad day");
			this.byKey = new Map((data.rows as ScoreRow[]).map((r) => [r.key, { ...r }]));
			if (data.day !== undefined) this.day = data.day as string; // no day: an old file, today's
			this.champ = isChampion(data.champion) ? { ...data.champion } : null;
		} catch (e) {
			await this.quarantine(`corrupt: ${String(e)}`);
		}
	}

	private async quarantine(why: string): Promise<void> {
		this.byKey = new Map();
		this.champ = null;
		let moved = true;
		try {
			await rename(this.path!, `${this.path}.bad`);
		} catch {
			moved = false; // already gone, or not movable: start empty regardless
		}
		this.log(
			`scores file ${why}; ${moved ? `moved to ${this.path}.bad` : "could not move it aside"}, starting empty`,
		);
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

	champion(): ChampionRow | null {
		return this.champ ? { ...this.champ } : null;
	}

	/**
	 * Start a new local day: archive the finished day's rows, crown its top row
	 * (only with a win; otherwise the old champion stays) and begin empty. The
	 * in-memory flip happens before the first await, so results recorded right
	 * after the call count for the new day. Resolves true when it rolled over.
	 */
	async rollover(now: Date | number): Promise<boolean> {
		const next = today(now);
		if (!(next > this.day)) return false; // same day, or a clock gone backwards: nothing to do
		const day = this.day;
		const rows = this.rows();
		const top = rows[0];
		if (top && top.wins >= 1) {
			this.champ = { agent: top.agent, project: top.project, wins: top.wins, losses: top.losses, day };
		}
		this.byKey = new Map();
		this.day = next;
		if (!this.path) return true;
		const path = this.path;
		await this.enqueue(async () => {
			if (rows.length > 0) {
				try {
					await this.writeHistory(path, day, rows);
				} catch (e) {
					// keep the old day on disk so the next start retries the archive
					this.log(`could not write scores history for ${day}: ${String(e)}; leaving scores.json on ${day} to retry`);
					return;
				}
			}
			await this.write(path);
		});
		return true;
	}

	private async writeHistory(path: string, day: string, rows: ScoreRow[]): Promise<void> {
		const dir = join(dirname(path), "history");
		await mkdir(dir, { recursive: true });
		const file = join(dir, `${day}.json`);
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify({ version: 1, day, rows }, null, 2));
		await rename(tmp, file);
	}

	/** Run a write after the ones already queued; a failure reaches only its own caller. */
	private enqueue(job: () => Promise<void>): Promise<void> {
		const run = this.chain.then(job);
		this.chain = run.catch(() => {});
		return run;
	}

	async save(): Promise<void> {
		if (!this.path) return;
		const path = this.path;
		await this.enqueue(() => this.write(path));
	}

	private async write(path: string): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		const body = { version: 1, day: this.day, champion: this.champ, rows: this.rows() };
		await writeFile(tmp, JSON.stringify(body, null, 2));
		await rename(tmp, path);
	}
}
