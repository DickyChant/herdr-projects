# Boss to Chief handoffs

Each local board task can have one Chief handoff. The board keeps its identity,
origin, scope, end condition and report. Chief executes through normal DSH Sessions.
Approvals remain with the human in both systems.

Boss can prepare a draft from its current coordinator pane:

```sh
herdr-projects bot-handoff draft TASK --scope "Review the search design"
herdr-projects bot-handoff show TASK
herdr-projects bot-handoff reports
```

The default end condition is `report_once`; `--end task_closed` ends the relay on
closure of the task, still allowing at most one report. There is no CLI send command.
The human can also prepare a direct request in the task's Chief handoff panel, then
review it and press **Send this handoff to Chief**. The UI shows **Boss on your
behalf** or **User directly**; the same origin appears in Chief's conversation.
The browser cannot override a saved origin or scope when sending. A watching device
cannot prepare, send or close handoffs.

A single Chief must be discoverable in the current local Ovis roster. Its runtime
and Bot IDs are saved, so renaming or replacing a Bot cannot redirect a saved
handoff. Multiple Bots named Chief require resolving the ambiguity first. Remote
boards and remote Bot targets are not supported by this first version.

Projects connects only to loopback `/herdr-bots/handoff`. The private credential is
`~/.config/ovis-dsh/handoff-token` (64 hexadecimal characters, mode 600). Configure
a non-default DSH port with `~/.config/ovis-dsh/handoff.json`, for example
`{"port":3080}`. The Herdr DSH plugin reads that separate credential at startup.
It cannot authorize ordinary chat sends, model settings, tools or approvals. Browser
cookies and the broader Bot bridge token are not used by this connection. These
are application permissions, not isolation between programs running as the same OS
user.

Both sides persist the handoff before delivery. Repeated clicks and repeated
requests cannot create a second send. After a timeout or restart, uncertain delivery
is labelled explicitly and never automatically replayed. Inspect Chief's native
chat before closing an uncertain record. The one-per-task rule retains closed
records; closing is not a retry/reset button. DS Bot retains up to 1,000 records and
refuses new admissions at that limit rather than forgetting delivery history.

The keeper checks one pending handoff every three seconds, so multiple pending
records are checked in turn. A report becomes visible in the task panel and in
`bot-handoff reports`. Boss reads reports on its next normal turn; a report does not
wake it or change the task stage. Reports are plain text and untrusted information,
never instructions. There are at most two hops: one request and one report, with no
automatic back-and-forth. A merged conversation or incomplete turn after restart
requires manual inspection instead of guessing which reply belongs to the task.

Marking a task done or archiving it ends its relay on the next keeper check. **Close
handoff** ends it explicitly. Closure suppresses late reports and prevents a late
create request through a retained receiver tombstone. It does not interrupt Chief's
unrelated conversations or grant approvals.

Check with `npm run check bot-handoff web-door`. The browser fixture
`scripts/real_programs_bot_handoff.mjs` checks draft retention, explicit sending,
watch-only controls, inert report text and mobile layout using fictional data.
