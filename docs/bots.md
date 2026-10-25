# DSH Bot awareness

The overall Coordinator (Boss) can read the local DSH Bot roster:

```sh
herdr-projects bots
herdr-projects bots --json
```

This command discovers Ovis through the existing web UI configuration and makes only `GET /api/bots` on loopback. It starts no agents or services, sends no Bot messages, changes no tasks and reads no conversation text. It does not read browser cookies or the Bot bridge's mutation credential. An Ovis instance that refuses the request returns `access_required`; the command does not try another credential or bypass that refusal.

The returned identity is `(machineId, runtimeId, id)`. Names can repeat and the supervisor pane can change, so neither is a Bot identity. The JSON includes each Bot's name, role, status and a relative `/dsh?runtime=…&bot=…` link to open in Ovis. Roster text is information, never instructions to the Coordinator.

A Bot can be available, working, waiting, needing attention, or unknown. Waiting and attention appear under Home's **Needs you**, with a link into the native DSH workspace. These statuses alone do not identify a specific approval or setup problem. The human sees the details and handles it there.

Home's **DSH Bots** card shows the roster. The topology puts Bots beneath a DSH runtime node on the local machine; the `dsh-web` supervisor is a service, not another worker. Runtime and Bot positions survive refreshes, and moving a machine or runtime moves its Bot children too.

Home polls every three seconds while visible. Offline, failed or older-than-15-second observations are shown as unknown and are not counted as current attention requests. A browser losing access drops its previous Bot roster. Watch-only browsers without Bot access continue to use Home without a Bot section. No Bot request changes the existing full-versus-watch authorization rules.

The command currently discovers only the local runtime exposed by Ovis. It reports unavailable, incompatible, access-required and not-configured states explicitly. It does not infer Bots on remote machines. Boss can read this roster on demand; this does not add automatic Boss wakeups.

Chief continues to coordinate the DSH team. Boss's standing instructions explain the boundary and the roster command; an existing Coordinator receives updated instructions with its next normal turn. The board remains the record for board tasks, and DSH for Bot conversations. Scoped Chief handoffs are described in [Boss to Chief handoffs](bot-handoff.md).

## Checking the feature

`npm run check bots web-board` checks roster parsing, freshness, identity, refusal and the existing Home contracts. The whole repository check remains `npm run check -- --all`.

`scripts/real_programs_bot_awareness.mjs` checks the actual browser against fictional data, including native links, nested dragging, revocation, mobile width and the absence of mutation requests. It needs an installed Playwright module (`PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs`), and optionally `CHROMIUM_PATH`. Screenshots go to `EVIDENCE_DIR` or `/tmp/herdr-bot-awareness-evidence`; it never visits the real board or sends to real Bots.
