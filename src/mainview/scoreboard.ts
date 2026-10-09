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
 * Lightsaber duel wins and losses per agent·project. In memory only: the
 * board starts empty with every app launch. Pure bookkeeping, so the wall
 * sign just redraws when `version` moves.
 */
export class Scoreboard {
	version = 0;
	private rows = new Map<string, Standing>();

	record(winner: Fighter, loser: Fighter): void {
		this.row(winner).wins++;
		this.row(loser).losses++;
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
