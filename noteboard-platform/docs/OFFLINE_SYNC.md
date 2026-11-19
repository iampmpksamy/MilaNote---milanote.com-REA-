# Offline editing and sync — 3.0.0-alpha.5

The apps (Android, iOS, Windows) work without a connection: they open the boards from the copy kept
on the device, every change is saved there first, and everything is sent and merged with other
devices' changes when the server answers again. The browser uses the same sync layer (changes made
while the connection drops are kept and merged); it still needs the server to open the page.

## How it works

```
 device copy (IndexedDB, per server + account)          server (MongoDB)
 ┌──────────────────────────────────────────┐            ┌───────────────────────┐
 │ base   = server's boards at revision N   │  PUT rev N │ boards at revision N  │
 │ local  = boards on this device now        │──────────▶│  → N+1 (accepted)     │
 │ sent   = last saves sent (+ operation id) │  409       │  or "changed since"   │
 │ pictures (to upload / cached)             │◀──────────│ recentOps (last 20)   │
 └──────────────────────────────────────────┘            └───────────────────────┘
          │ 409 → GET → merge(base, local, server) → PUT merged → workspace shows it
```

1. **Every edit** goes into the device copy first (`apps/web/src/app/native/replica.ts`), then the
   sync loop (`apps/web/src/app/server/sync-storage.ts`) sends it.
2. **Online, nobody else saved:** the save carries the revision it was based on and is accepted.
3. **Another device saved meanwhile (409):** the device fetches the server's boards and merges
   them three-way with its own (`mergeStores`, `packages/board-model/src/lib/merge.ts`), takes the
   result itself, saves it, and the open boards update in place.
4. **No connection:** the change stays on the device; the header says "Saved on this device" and a
   banner says you're offline. Retries come after 2, 5, 10, 20, 30, then every 60 seconds, and at
   once when the connection returns (`online`), when the app comes back to the foreground, and on
   *Try now*.
5. **Opening without a connection (apps):** if the server can't be reached and this account has a
   copy on the device, the app opens it straight away (signed in as before). The sign-in is
   refreshed and the session re-checked when the server answers again.
6. **Other devices' changes** are fetched when the app comes to the foreground, when the connection
   returns and every minute while it is visible.
7. **Pictures** added offline are kept on the device and uploaded before the boards that use them;
   pictures already seen are cached so they show offline. Picture files get a random part in their
   name, so two devices adding pictures offline can't overwrite each other's.
8. **A save whose answer was lost:** the server keeps the operation ids of its last 20 saves and
   returns them; the device then uses what actually arrived as the starting point of the merge,
   so nothing is duplicated. Before sending a merge, the device adopts it itself, so a retry can
   never undo the other device's changes.
9. **Edits made while a merge runs** (or while a note is open for editing) are put on top of the
   merged boards afterwards; ids renumbered by the merge are translated first.

## Merge rules

Each board, card, line and trash item is compared field by field with the last synced version:

| Situation | Result |
| --- | --- |
| Changed on one device only | that change |
| Different cards / fields changed on each device | both changes |
| Same note/to-do/link/picture changed on both | the server's version stays; this device's version is added to **Unsorted** as "Conflicting copy (Android, date)" and a banner says so |
| Board name, column title or line label changed on both | the server's stays; this device's is added to Unsorted as a "Conflicting copy" note |
| Position, size, colour, order, lock, line style changed on both | this device's |
| Edited on one, deleted for good (trash emptied) on the other | the edited item comes back; a board that comes back also gets its board card back |
| Moved to the trash on one, edited on the other | stays in the trash, with the edit |
| Moved to the trash on one, deleted for good on the other | deleted |
| Cards added to the same column / Unsorted on both | all of them, in a sensible order |
| New items on both devices that got the same id | this device's are renumbered, all references (columns, lines, board cards, parents, trash) rewritten |
| New cards from both devices on the same spot | this device's moves down and right |

The merged result always satisfies the model's invariants (`repairStore`) and the server's check
(`checkStore`, now in the model package). Trash items keep what restoring needs (a card's column,
lines to cards still on the board).

## Isolation and sign-out

- Copies and pictures are stored per server **and** account; tokens never go to another server.
- Signing out deletes the account's copy and pictures from the device. If changes haven't reached
  the server yet, the app asks first.
- *Forget server* deletes every copy for that server.
- If the session was ended elsewhere while the device was offline, the app asks to sign in again;
  unsent changes stay on the device and are merged after signing in to the same account.

## Tests

| Suite | What |
| --- | --- |
| `packages/board-model/src/lib/merge.spec.ts` (22) | each rule above, invariants, 300 randomised two-device sessions (nothing typed lost, always valid) |
| `merge.attack-*.spec.ts` (69) | written by five independent adversarial reviewers (ids, data loss, deletion, invariants/server check, convergence/performance); 38 defects they found were fixed, the tests stay as regressions — including stores of 150 000 cards and 2 000-item lists |
| `apps/api/integration/native.test.mjs` | idempotent saves, `recentOps` |
| `apps/web-e2e/native/app.spec.ts` | the app opened with the server unreachable, a note and a picture added offline, the app reopened offline, another device editing meanwhile, reconnect → both devices have everything (picture included); the same note edited on both → conflicting copy in Unsorted on both |

## Limits (honest list)

- The browser can't open the page without the server (it is served by the server); the apps can.
- The apps can't be signed in for the first time, or switched to another account, without a
  connection.
- Merges work on the whole boards file (fine for thousands of cards; tested with 150 000).
- A save whose answer was lost and that is older than the server's last 20 saves could, in a very
  unlikely case, produce a duplicate card (never a loss).
- Real-time collaboration (seeing another device's typing live) is not part of this; changes
  arrive on save, foreground, reconnect or every minute.
- Not yet run on a physical phone with airplane mode (the tests cut the server connection in a
  mobile browser emulation of the app bundle).
