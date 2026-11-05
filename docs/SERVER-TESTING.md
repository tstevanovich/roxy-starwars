# Server testing

The server uses Vitest 5 in the Node environment. Run commands from the repository root in PowerShell:

```powershell
npm.cmd run test --workspace server
npm.cmd run test:watch --workspace server
npm.cmd run test:coverage --workspace server
npm.cmd exec --workspace server -- vitest run src/scene-editor.test.ts
npm.cmd run test:coverage
npm.cmd run check
```

The last coverage command checks the client, server and shared workspaces. `check` runs formatting, TypeScript, ESLint, Stylelint, all workspace and launcher tests, and the client build. Coverage is a separate, stricter gate.

## Source and matching tests

Keep each test beside the source module with the same base name: `scene-editor.ts` and `scene-editor.test.ts`, or `assistant/openart.ts` and `assistant/openart.test.ts`. Use `describe` groups within that file for related scenarios. Shared helpers and their matching tests live in the independent `shared` workspace; see [Shared testing](SHARED-TESTING.md). The old `server/test` directory and Node-runner server command have been replaced.

`server/vitest.config.ts` selects only `src/**/*.test.ts`. `vitest` and `@vitest/coverage-v8` are pinned to the same version. The shared `vitest-vscode-compat.ts` plugin supports the installed Vitest Explorer extension's older cache option without suppressing warnings.

## Coverage contract

The V8 provider includes every runtime `.ts` module under `server/src`, including `app.ts` and `server.ts`. Only test files are excluded. Shared modules imported by the server do not count toward the `/server` percentage; their own workspace measures their coverage. Configuration files and documentation are outside runtime coverage.

All four metrics are enforced for each runtime file with `thresholds: { 100: true, perFile: true }`. A passing assertion run does not imply passing coverage. Keep this scope intact; do not add ignore comments or omit difficult modules to satisfy the gate.

The November 4, 2026 verification after separating the shared suite passed the normal strict coverage command: **526 tests across 55 test files**, with **all 55 server runtime modules at 100%** for statements (6,058), branches (6,285), functions (1,259) and lines (5,342). Every server runtime module has a matching `.test.ts` file beside it. The prompt tests cover saved starting states, allowed motion and states at the cut independently of the shared regression suite.

Server-only timing rules, image prompt construction, shot image revisions, shot settings and sound-plan review rules now live under `server/src` and are included in this coverage scope. See [source ownership](TYPESCRIPT.md#source-ownership) for the module inventory and placement rules.

Reports are generated in `server/coverage`: open `index.html` to inspect branches, `coverage-summary.json` for per-file totals, or `coverage-final.json` for execution counts. Reports are also generated after assertion failures.

## Isolation and external services

Database integration tests use disposable MongoMemoryServer databases. Media fixtures and encrypted-store tests use temporary directories. Never point tests at the saved Studio database, `.data/media`, real owner credentials, or active provider connections.

Provider adapters use mock network/SDK boundaries. Their tests cover explicit generation, review scope, stale revisions, OAuth, persisted receipts, partial imports, cancellation and failure recovery without submitting paid jobs. Media integration tests require FFmpeg and FFprobe on PATH; production HTML tests supply a static-serving fixture and do not require a prebuilt client bundle.

Regression cases also cover missing media downloads, scene and shot draft scope, unchanged music approvals, sound repair, manual generation boundaries and legacy records with omitted optional fields. Source cleanup removed duplicate checks whose prerequisites had already validated the same inputs.

The suite uses one fork at a time because Mongoose registries, temporary databases and real media tools benefit from predictable resource usage. Keep tests isolated and reset mocks within their groups. In a hook, use a block body when clearing a mock so the returned mock function is not interpreted as a teardown callback.

## Cleanup

The unused starter `/api/tasks` API, Task model and their dedicated tests were removed. Authentication tests now exercise Studio endpoints, and the local database persistence test stores an episode. Saved databases and media are unaffected by this source cleanup.
