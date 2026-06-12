import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Agent View",
		identifier: "com.cygnisec.agentview",
		version: "0.1.1",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
		},
		mac: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
