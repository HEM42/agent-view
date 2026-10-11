import type { RoomState, ScoreRow } from "../shared/types";
import { PAL, peekAccent, peekAgentColor } from "./sprites/palette";

/** Rows for agents and projects not on screen: they must not claim a palette slot. */
const NEUTRAL: string = PAL.lilac;

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

/** Yesterday's winner as the header shows them: identity plus nametag colours. */
export interface Champion {
	agent: string;
	project: string;
	agentColor: string;
	accent: string;
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
	private lastRows: readonly ScoreRow[] | null = null;
	/** yesterday's winner (room mode only; local duels have no past day) */
	champion: Champion | null = null;

	record(winner: Fighter, loser: Fighter): void {
		this.row(winner).wins++;
		this.row(loser).losses++;
		this.replaced = null;
		this.lastRows = null;
		this.version++;
	}

	/** Room mode: the daemon's standings, coloured like the nametags. */
	replace(rows: readonly ScoreRow[], champion: RoomState["champion"] = null): void {
		const crowned = this.setChampion(champion);
		if (rows === this.lastRows) {
			// the same snapshot again
			if (crowned) this.version++;
			return;
		}
		this.lastRows = rows;
		const next = rows
			.map((r) => ({
				key: r.key,
				agent: r.agent,
				project: r.project,
				agentColor: peekAgentColor(r.agent) ?? NEUTRAL,
				accent: peekAccent(r.project) ?? NEUTRAL,
				wins: r.wins,
				losses: r.losses,
			}))
			.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		const sig = JSON.stringify(next);
		if (sig === this.replaced) {
			if (crowned) this.version++;
			return;
		}
		this.replaced = sig;
		this.rows = new Map(next.map((s) => [s.key, s]));
		this.version++;
	}

	/** Room mode's champion, coloured like the rows. True when it changed. */
	private setChampion(c: RoomState["champion"]): boolean {
		const next: Champion | null = c
			? {
					agent: c.agent,
					project: c.project,
					agentColor: peekAgentColor(c.agent) ?? NEUTRAL,
					accent: peekAccent(c.project) ?? NEUTRAL,
				}
			: null;
		if (JSON.stringify(next) === JSON.stringify(this.champion)) return false;
		this.champion = next;
		return true;
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
