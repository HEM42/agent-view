import type { ScoreRow } from "../shared/types";
import { accentFor, outfitFor } from "./sprites/palette";

/** A duelist as the scoreboard knows them: identity plus nametag colours. */
export interface Fighter {
	agent: string;
	project: string;
	agentColor: string;
	accent: string;
}

export interface Standing extends Fighter {
	key: string; // "agent·project", like the nametag
	wins: number;
	losses: number;
}

/**
 * Lightsaber duel wins and losses per agent·project. Local mode records
 * results in memory (the board starts empty with every launch); room mode
 * replaces it with the daemon's standings. Pure bookkeeping, so the wall
 * sign just redraws when `version` moves.
 */
export class Scoreboard {
	version = 0;
	private rows = new Map<string, Standing>();
	/** what replace() last set, to skip no-op redraws; null after a local record */
	private replaced: string | null = "[]";

	record(winner: Fighter, loser: Fighter): void {
		this.row(winner).wins++;
		this.row(loser).losses++;
		this.replaced = null;
		this.version++;
	}

	/** Room mode: the daemon's standings, coloured like the nametags. */
	replace(rows: readonly ScoreRow[]): void {
		const next = rows
			.map((r) => ({
				key: r.key,
				agent: r.agent,
				project: r.project,
				agentColor: outfitFor(r.agent).base,
				accent: accentFor(r.project),
				wins: r.wins,
				losses: r.losses,
			}))
			.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		const sig = JSON.stringify(next);
		if (sig === this.replaced) return;
		this.replaced = sig;
		this.rows = new Map(next.map((s) => [s.key, s]));
		this.version++;
	}

	/** Most wins first, then fewest losses, then name. */
	top(n: number): Standing[] {
		return [...this.rows.values()]
			.sort((a, b) => b.wins - a.wins || a.losses - b.losses || (a.key < b.key ? -1 : 1))
			.slice(0, n);
	}

	private row(f: Fighter): Standing {
		const key = `${f.agent}·${f.project}`;
		const s = this.rows.get(key);
		if (s) {
			// colours can change between duels (registry reassignments)
			s.agentColor = f.agentColor;
			s.accent = f.accent;
			return s;
		}
		const fresh = { ...f, key, wins: 0, losses: 0 };
		this.rows.set(key, fresh);
		return fresh;
	}
}
