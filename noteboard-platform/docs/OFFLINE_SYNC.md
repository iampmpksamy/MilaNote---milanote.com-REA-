# Saving reliably now, offline editing next

**What exists in 3.0.0-alpha.4 is reliable online saving, not offline editing.** The apps need the
server to open and change boards. They keep unsent changes safe when the connection drops, but you
can't open the app without the server and work on your boards. That is the next milestone.

## Built and tested (all clients: browser, Android, iOS, Windows)

| Guarantee | How |
| --- | --- |
| A stale copy never overwrites newer boards | every save carries the revision it was made on; the server refuses it (`409`) if someone saved in between |
| A save is acknowledged | the server answers with the new revision; only then is the change considered saved ("Saved to server") |
| Retried saves are idempotent | every save has an operation id; if an answer is lost and the same save is sent again, the server acknowledges it (`replayed: true`) instead of reporting a conflict |
| Save failures are visible | a banner: "Can't reach the server … kept on this device", "changed somewhere else", or "refused" |
| Retries | 2 s, 5 s, 10 s, 20 s, 30 s, then every 60 s; *Try now* and any new edit retry at once; the save that was in flight is repeated unchanged first, newer edits follow |
| Drafts survive closing the app | until the server confirms a save, the change (and edits made after it) are kept on the device (IndexedDB, per server and account); on the next start they are sent if the boards weren't changed elsewhere |
| Conflicts don't lose work | if the boards were changed elsewhere, the kept change can be saved as a file (*Save my unsent changes as a file*, a `boards.json` that Settings → Privacy & data can import) or discarded |
| A failed load never saves | if the boards can't be loaded, the app says so and saves nothing (no sample boards over real ones) |

Tests: integration (`saving from a flaky connection`), native app browser test (a broken connection:
edits made while every save fails are kept, sent when the server answers, and present after reopening).

## Next milestone: offline editing (designed, not built)

1. **Local copy per server+account** (IndexedDB on phones/Windows) loaded first, then refreshed.
2. **Persistent operation queue:** board edits recorded as operations (create/move/edit/delete card,
   line, board) with ids, base revision and timestamps instead of whole-workspace snapshots.
3. **Server operations endpoint** (`POST /api/v1/workspace/ops`) applying operations per board, with
   per-board revisions so edits on different boards never conflict.
4. **Conflict resolution:** field-level last-writer-wins for card text/position/style; edits to a
   deleted card come back as a "restored" card in Unsorted; text conflicts keep both versions.
5. **Deletion tombstones** kept for 30 days so a device that was offline learns about deletions.
6. **Picture upload queue:** pictures added offline are stored locally and uploaded first, before the
   operations that reference them.
7. **Isolation:** queues, caches and pictures stored per server and account and removed on sign-out.
8. **Tests:** two devices editing the same and different boards offline, reconnect in both orders;
   deletion vs. edit; picture added offline; sign-out while changes are queued.

Real-time collaboration (Yjs) builds on the same operation model later.
