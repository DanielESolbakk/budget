# ADR-002: Local Household Ledger Registry and Runtime Switching

## Status

Proposed

## Date

2026-11-13

## Context

The desktop application currently opens one local SQLite database at startup and constructs its persistence-backed services and IPC channel groups around that connection. First-run setup can initialize a household only when that database is empty. A non-empty installation has no in-app way to create or switch to another household.

The approved E7 scope allows one local user to manage multiple independent household ledgers. Each household must use a separate SQLite database. Creating a new household or starting fresh must preserve the existing ledger, while upgrade and restore behavior must not silently move, overwrite, or delete financial records.

E7 is an owner-approved scope expansion alongside the existing first-run household setup; it does not change the earlier first-ledger setup outcome or reopen its closed planning issue.

Switching the active ledger affects every main-process service and IPC responsibility group. It cannot be implemented safely as a renderer-only setup form or as a change to the database path alone.

## Decision

This ADR proposes the following boundaries for owner review:

- Store each household's financial data in its own SQLite database. Do not merge records between household ledgers.
- Keep a separate local household-ledger registry containing only stable ledger identity, display name, database location, and the active ledger identifier. The registry must not contain transaction content.
- Store newly created household ledgers under Electron's per-user application data directory. Register the existing database at its current path on upgrade; adoption does not copy, move, rewrite, or delete its saved records.
- Preserve `BUDGET_DB_PATH` as an explicit isolated test/development database override. A configured path must not be silently ignored or replaced by another household ledger.
- Keep registry access, database connection ownership, service construction, and mutable active-ledger runtime state in Electron main. IPC responsibility groups receive declared active-ledger context dependencies; they do not own connections or retain copied mutable runtime values.
- Prepare and validate the destination ledger before activation. Invalidate or finish operations tied to the previous ledger before its connection is closed. If creation or switching fails, retain the previous active ledger and surface a recoverable error.
- Treat “Start fresh” as an explicit action that creates and activates a new household ledger. It does not erase, reset, or permanently delete the previous ledger.
- Show the active household and backup snapshot identity before restore. A snapshot with a different household identity must not silently replace the active ledger.
- Keep household-ledger management local-only. Do not add bank APIs, cloud sync, telemetry, analytics, or background network requests.
- Keep the browser preview synthetic and explicitly reject desktop-only household-ledger operations.

## Decision Consequences

### Positive

- Existing installations can retain the current database file and saved records during registry adoption.
- Separate SQLite files provide a clear persistence boundary for reads, writes, imports, backups, and restores.
- Main-process ownership keeps database connections and mutable runtime state outside the renderer and IPC groups.
- “Start fresh” gives the user a recoverable path without manual database deletion.

### Negative

- Every IPC service and asynchronous workflow must resolve the currently active ledger without retaining stale references.
- Registry corruption, missing database files, and restore identity mismatches require visible recovery states rather than implicit fallback.
- Test fixtures and Electron relaunches must isolate both the SQLite path and Electron user-data directory.

## Alternatives Considered

### Store multiple households in one SQLite database

Rejected for E7. Separate SQLite ledgers are the approved product constraint and make household backup/restore identity explicit.

### Replace the current database when starting fresh

Rejected. It would make the user's existing ledger unavailable and could silently destroy financial history.

### Add only a renderer setup form

Rejected. The current main process and IPC groups retain one database connection and services created from it; renderer-only changes would not provide safe runtime switching.

### Copy the existing database into a new managed directory during upgrade

Not selected in this proposal. In-place registration minimizes upgrade risk and avoids rewriting or deleting existing records. Any future physical migration requires a separate, verified recovery decision.

## Open Implementation Decisions

- Final registry file name and serialization format, including atomic update and corruption recovery behavior.
- Exact app-data directory layout for newly created ledgers and backup catalog metadata.
- Active-ledger context rebinding strategy across every IPC group and long-running operation.
- Restore behavior when the snapshot household identity differs from the active household, including whether the user may restore it as a new ledger.
- Precise migration precedence when both a registered ledger and an explicit `BUDGET_DB_PATH` are present.

## Implementation Gate

Owner acceptance of this ADR is required before product implementation begins. Resolve each open implementation decision in the owning Feature or Story without expanding the approved E7 scope.

## Validation Implications

- Unit tests cover registry validation, path handling, active-ledger state transitions, and failed/canceled creation.
- Integration tests prove legacy adoption, independent database creation, cross-ledger read/write/import isolation, and restore identity handling.
- Playwright tests cover create/switch and “Start fresh” as distinct desktop workflows, including compact-window behavior and restart persistence with isolated Electron user data.
- No-network verification confirms that registry and household-ledger workflows make no outbound requests.
