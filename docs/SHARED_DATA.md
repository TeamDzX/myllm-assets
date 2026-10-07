# Shared data formats (v1)

Apps keep their own state in `myllmStorage`, which only that app can read. When another app should be able to use the data (a dashboard, a calendar, a heatmap), the owning app ALSO publishes it to the shared workspace with `myllmFiles.write`, in the format below. Readers depend on these formats and nothing else.

**Rules**
- **One writer per file.** Only the named source app writes it. The exception is `data/activity.json`, which several apps append to (see below).
- **Whole snapshots, not deltas.** The writer rewrites the file with its full current list after every change. Readers never need history.
- **Every file has `schema`, `version`, `source` and `updated`.**
  - Readers accept `version` 1. They ignore fields they don't know, and treat a missing file, or a file that isn't JSON, as empty.
  - A breaking change gets version 2, and readers say "this app needs updating" rather than guessing.
- **Dates:**
  - A day is local `YYYY-MM-DD`.
  - A moment is ISO 8601 with offset (`new Date().toISOString()`).
  - Money is a number in the receipt's own currency, plus a `currency` string.
- **Ids are stable strings,** so a reader can remember things per item (a category, a dismissal).
- **Publishing is best-effort.** If `myllmFiles` is missing or the user switched shared files off, the source app carries on normally, and readers show how to turn it on.

## data/receipts.json (source: receipt-logger)
```json
{ "schema": "myllm.receipts", "version": 1, "source": "receipt-logger", "updated": "2026-10-07T08:00:00Z",
  "items": [ { "id": "r_1759820000000", "merchant": "Tesco", "total": 23.4, "currency": "£",
               "date": "2026-10-06", "added": "2026-10-06T18:12:00Z", "category": "Groceries" } ] }
```
- `total` may be `null` when the receipt couldn't be read.
- `date` is the receipt's date when it could be read, otherwise the day it was added.
- `category` may be `null`.

## data/todos.json (source: quick-todo)
```json
{ "schema": "myllm.todos", "version": 1, "source": "quick-todo", "updated": "…",
  "items": [ { "id": "t_1759820000000", "text": "Book MOT", "done": false, "due": "2026-10-10",
               "added": "…", "doneAt": null } ] }
```
- `due` is optional; `null` means the item is undated.

## data/habits.json (source: habit-streaks)
```json
{ "schema": "myllm.habits", "version": 1, "source": "habit-streaks", "updated": "…",
  "habits": [ { "id": "h_1759820000000", "name": "Read 20 min", "days": ["2026-10-05", "2026-10-06"] } ] }
```

## data/activity.json (appended by several apps)
```json
{ "schema": "myllm.activity", "version": 1, "source": "shared", "updated": "…",
  "events": [ { "app": "box-breathing", "kind": "session", "date": "2026-10-06", "at": "…", "minutes": 4 } ] }
```
- **Appending:** read the file, append the event, keep the newest 3000, then write. Each event carries the app's gallery id in `app`.
- **Known kinds so far:**
  - `box-breathing/session`
  - `stretch/session`, with `minutes` and an optional `title`

## Who reads what
| File | Written by | Read by |
|---|---|---|
| data/receipts.json | Receipt Logger | Budget Dashboard |
| data/todos.json | Quick Todo | Calendar Planner |
| data/habits.json | Habit Streaks | Habit Streaks heatmap; any app |
| data/activity.json | Box Breathing, Stretch | Habit Streaks heatmap |
