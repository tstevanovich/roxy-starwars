# Roxy Star Wars

A local production studio for the Roxy Kane series, built with React, Material UI, Express, and MongoDB. Review creative directions, import original images/video/audio, finalize reusable assets, and prepare episode scenes and editing packages.

Read the [studio guide](docs/STUDIO-GUIDE.md) for saving choices, local storage, scene approvals, and CapCut exports. The [production brief](docs/PRODUCTION-BRIEF.md) records the creative requirements. [Production chat](docs/PRODUCTION-CHAT.md) adds story collaboration, reviewable scene drafts, OpenArt render requests and ElevenLabs dialogue generation. Each scene also has a sound-design plan, individual effects review, and local FFmpeg mixing before new video approval; see the [sound workflow](docs/STUDIO-GUIDE.md#sound-design-and-finished-video-review). FFmpeg and FFprobe must be on PATH (or set FFMPEG_PATH and FFPROBE_PATH). Connect your ChatGPT plan on the studio PC through its owner-only Connections screen. Studio chat has no API-key billing fallback; OpenArt and ElevenLabs use their own accounts/credits.

With MongoDB running, `npm.cmd run project:inquisitor` initializes the separate Sith Inquisitor workspace once and preserves existing records on subsequent runs.

Use the **Project / class storyline** selector for separate series. The Old Republic / Sith Inquisitor workspace has its own cinematic-only settings, episode source references, decisions, voice and wardrobe choices; see [projects and gameplay adaptations](docs/STUDIO-GUIDE.md#projects-and-gameplay-adaptations).

The studio now requires your single-owner login on desktop and phone. See [remote access and account setup](docs/REMOTE-ACCESS.md) for your private HTTPS tunnel, first sign-in, mobile controls, starting/stopping access and local password recovery.

## Requirements

- Node.js 24.15 or later within the 24.x line, or Node.js 26+ (Node 24 is recorded in `.nvmrc`).
- npm, included with Node.js.
- MongoDB is started automatically for local development. A separate installation, Docker Desktop, or MongoDB Atlas is optional.

## Start developing

Run these commands in PowerShell from the project root. For a fresh checkout, install the locked dependencies and create the local environment file:

```powershell
npm.cmd ci
Copy-Item server/.env.example server/.env
```

Skip the copy if `server/.env` already exists so you keep your local configuration.

The default `MONGODB_URI=mongodb://127.0.0.1:27017/roxy-starwars` works without installing MongoDB separately. `npm.cmd run dev` starts a MongoDB binary through the existing development dependency, waits for it to be ready, and then launches the API and React. The first run may download the pinned MongoDB 8.2.6 binary. Application records use WiredTiger storage in `.data/mongodb` and survive stopping and restarting the app. This directory is excluded from Git and formatting.

You can also choose another database:

- **Docker Desktop:** start Docker, then run `npm.cmd run db:up`. The Compose service exposes MongoDB on localhost only and stores data in the `mongo-data` volume. `npm.cmd run db:down` stops it and preserves the volume.
- **Local MongoDB:** start MongoDB on port 27017. The default URI is `mongodb://127.0.0.1:27017/roxy-starwars`.
- **MongoDB Atlas:** set `MONGODB_URI` in `server/.env` to your cluster's connection string, including a database name. Configure an Atlas database user and network access for your IP. Keep credentials in `.env`; environment files are ignored by Git.

Then run:

```powershell
npm.cmd run auth:setup
npm.cmd run dev
```

The owner setup command preserves existing credentials. On first use, open the development setup link in `.data/private/owner-access.txt` and choose your password. There is no public registration.

Open <http://127.0.0.1:5173>. Vite proxies `/api` requests to Express at <http://127.0.0.1:5000>. The app does not open a browser automatically. Ctrl+C stops the development processes and any database started by the launcher, preserving application data.

The launcher reuses a database already listening on port 27017. For a custom URI, including Atlas, it leaves database management to you and does not start a local instance. The automatic database is only for the default local URI and `npm.cmd run dev`; `npm.cmd start` and the server workspace commands still require a running database. If you change the API port, also update `client/vite.config.js`.

## Project layout

```text
client/
  src/App.jsx             Production dashboard and workspace navigation
  src/AssetLibrary.jsx    Candidate review, reference uploads, and final choices
  src/Episodes.jsx        Episode scripts, clip plans, approvals, and exports
  src/ProductionChat.jsx  Mobile production conversations, connections and job tracking
  src/StudioMedia.jsx     Local media library and inline playback
  src/SeriesBible.jsx     Editable series settings
  src/App.test.jsx        Studio interaction and draft-preservation tests
  src/api.js              Shared fetch helper
  src/theme.js            Shared MUI palette, typography, and component defaults
  src/styles.css          Fonts and root sizing
  vite.config.js          Development API proxy
  vitest.config.js        React tests in jsdom
server/
  src/app.js              Express middleware and routes
  src/server.js           Environment, startup, and shutdown
  src/db.js               MongoDB connection
  src/models/Task.js      Mongoose schema
  src/routes/tasks.js     Validated CRUD endpoints
  src/routes/studio.js    Studio records, approvals, and export endpoints
  src/models/Studio.js    Assets, media metadata, episodes, and series settings
  src/studio-media.js     Local file imports and range playback
  src/assistant/          OpenAI tool loop, OpenArt OAuth, durable jobs and story proposals
  test/studio.test.js     Studio persistence, media, approvals, and export tests
  test/tasks.test.js      Integration tests against temporary MongoDB
  .env.example            Environment template
compose.yaml              Optional local MongoDB container
scripts/dev.mjs           Database readiness and development process startup
scripts/local-database.mjs Persistent local development database
```

## Commands

| Command                       | Purpose                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `npm.cmd run dev`             | Start React and Express with automatic reload                                  |
| `npm.cmd run build`           | Build React into `client/dist`                                                 |
| `npm.cmd start`               | Run Express; uses `server/.env`                                                |
| `npm.cmd run auth:setup`      | Prepare the single owner and private first-sign-in instructions                |
| `npm.cmd run auth:reset`      | Recover the owner locally and revoke previous sessions                         |
| `npm.cmd run studio`          | Start the built, authenticated studio with local database readiness            |
| `npm.cmd run remote:install`  | Download and verify the official Windows tunnel executable                     |
| `npm.cmd run remote:start`    | Start the authenticated studio's HTTPS tunnel                                  |
| `npm.cmd run remote:status`   | Show the verified tunnel state and current address                             |
| `npm.cmd run remote:stop`     | Stop the studio tunnel while retaining the local studio                        |
| `npm.cmd test`                | Run frontend interaction tests and API integration tests                       |
| `npm.cmd run lint`            | Check JavaScript and React                                                     |
| `npm.cmd run lint:fix`        | Fix supported lint issues, including import ordering                           |
| `npm.cmd run lint:styles`     | Check CSS and SCSS                                                             |
| `npm.cmd run lint:styles:fix` | Fix supported CSS and SCSS lint issues                                         |
| `npm.cmd run format`          | Format source and documentation                                                |
| `npm.cmd run check`           | Check formatting, JavaScript and stylesheet lint, integration tests, and build |
| `npm.cmd run db:up`           | Start MongoDB with Docker Compose                                              |
| `npm.cmd run db:down`         | Stop Docker services without removing database data                            |

Tests start an isolated MongoDB using `mongodb-memory-server`; they never use your configured application database. The first test run downloads a MongoDB binary and needs internet access. The binary is cached for later runs.

`npm.cmd run test:tools` tests database reuse, records surviving a database restart, and handling external or missing connection settings. Database tests use an isolated temporary directory, not `.data/mongodb`. It also checks the guarded glob dependency used by Stylelint against normal patterns, deeply nested strings, and caller-supplied syntax trees.

## Dependency security

Run `npm.cmd audit` to check all dependencies, or `npm.cmd audit --omit=dev` to check production dependencies only.

The root `overrides` entry replaces transitive `braces` with the exact published fork `@dieub/braces-depth-guard@3.0.3-pn.3`. This is an unofficial MIT-licensed backport of `braces` 3.0.3, not an official upstream release. It adds nesting guards in the parser and recursive walkers for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), which has no official patched release as of October 17, 2026. The [fork source](https://github.com/dieub/braces-depth-guard) was compared with the installed upstream package, and its published package has no install lifecycle scripts. The lockfile records its actual package name, exact version, registry URL, and integrity hash.

This preserves Stylelint, CSS/SCSS support, and property-order checks. Patterns nested beyond 100 levels now throw a controlled error. The regression tests exercise the replacement through Stylelint's actual Micromatch dependency. The fork is a temporary dependency choice: review and remove the override when a suitable official release is available. A clean audit only describes the advisories known to the registry at the time it runs.

## ESLint

The root flat configuration uses ESLint 10, React Hooks and Refresh checks, and `eslint-plugin-simple-import-sort` for import and re-export ordering. `eslint-config-prettier` is applied last to disable rules that conflict with Prettier; formatting remains a separate command.

Formatting options are recorded in the root `prettier.config.mjs`: two-space indentation, single quotes in JavaScript, semicolons, no trailing commas, a 100-column print width, and LF line endings. `.editorconfig` also supplies editor whitespace conventions, and `.prettierignore` excludes generated files.

`eslint-plugin-testing-library` applies its React preset only to client `*.test.*`, `*.spec.*`, and `__tests__` files. The client uses Vitest, React Testing Library, and jsdom for frontend interaction tests. The Node/Supertest API tests do not receive Testing Library rules.

`typescript-eslint` recommended rules are scoped to `.ts`, `.tsx`, `.mts`, and `.cts` files, using a compatible TypeScript 6.0 dependency. This prepares syntax-based linting for future TypeScript files; the application and build remain JavaScript, and TypeScript compilation and type-aware linting are not configured.

`eslint-plugin-react` and `eslint-plugin-jsx-a11y` are deferred because their current published peer dependency ranges exclude ESLint 10.

## UI library

The client uses Material UI (MUI) with the Emotion styling engine and Material icons. `client/src/main.jsx` wraps the app in `ThemeProvider` and `CssBaseline`. Edit `client/src/theme.js` to adjust the shared palette, typography, and component defaults. Use MUI components and their responsive `sx` props for screen layouts and styles; `styles.css` handles font loading and root sizing.

MUI X Date Pickers and Day.js are installed in the client workspace. The root `LocalizationProvider` uses `AdapterDayjs`, so date and time pickers can be added anywhere in the app. Use Day.js objects (or `null` for an empty value) for picker values.

`npm.cmd test` runs both workspaces and the development tooling tests. Client tests cover navigation, local draft preservation after conflicts, media attachment and finalization, retry, and flexible episode clip durations. Server tests exercise MongoDB records, original file storage, HEAD/range playback, final-choice history, stale approvals, validation, and ZIP export. The original task API tests remain. Run `npm.cmd run test:watch --workspace client` for interactive frontend testing. Client tests mock the request helper and do not require a running API or database.

Stylelint checks CSS and SCSS files; it does not inspect MUI `sx` objects inside JavaScript.

## Stylelint

The root `stylelint.config.mjs` uses `stylelint-config-standard` for CSS and overrides `.scss` files with `stylelint-config-standard-scss`, which supplies the SCSS parser and rules. `stylelint-config-recess-order` and its `stylelint-order` plugin enforce consistent property ordering for both CSS and SCSS, with automatic fixes available through `npm.cmd run lint:styles:fix`. Both stylesheet types are checked by `npm.cmd run lint:styles` and the aggregate `npm.cmd run check`. Dependencies, generated `dist` and coverage directories, and minified stylesheets are excluded.

The workspace recommends the official Stylelint VS Code extension. `.vscode/settings.json` enables CSS/SCSS validation and Stylelint fixes on explicit saves, with Prettier handling formatting. Use **Stylelint: Restart Stylelint Server** from the Command Palette if editor diagnostics do not refresh after installing dependencies.

SCSS linting does not compile Sass. Install a Sass compiler in the client workspace when you start importing `.scss` files into the application.

## API

| Method | Route            | Body / behavior                                       |
| ------ | ---------------- | ----------------------------------------------------- |
| GET    | `/api/health`    | Database readiness; 200 when connected, 503 otherwise |
| GET    | `/api/tasks`     | Latest 100 tasks, newest first                        |
| POST   | `/api/tasks`     | `{ "title": "Build something" }`; returns 201         |
| PATCH  | `/api/tasks/:id` | Update `title` and/or boolean `completed`             |
| DELETE | `/api/tasks/:id` | Delete a task; returns 204                            |

Task titles must have 1–200 characters after trimming. Unknown fields, malformed IDs, and invalid request bodies are rejected. Errors have a `{ "message": "..." }` JSON body.

## Run the production build locally

```powershell
npm.cmd run build
$env:NODE_ENV = 'production'
npm.cmd start
```

Open <http://127.0.0.1:5000>. Express serves the built React client and API from the same origin. MongoDB must still be running. Remove the PowerShell override with `Remove-Item Env:NODE_ENV` when finished, or set `NODE_ENV` in the environment file instead. `npm.cmd run preview --workspace client` previews only the frontend build and does not supply the API.

This scaffold has no authentication: tasks are shared by everyone who can reach the API. The default host is localhost. Add authentication, authorization, and deployment configuration before exposing private data or deploying publicly.

## References

- [Vite guide](https://vite.dev/guide/)
- [Material UI documentation](https://mui.com/material-ui/)
- [Express documentation](https://expressjs.com/)
- [Mongoose connections](https://mongoosejs.com/docs/connections.html)

New Wan videos include native sound effects and ambience. Review and approve picture, performance and sound together; use the separate sound tools only for audio repairs. Music stays in CapCut. See [the production workflow](docs/STUDIO-GUIDE.md#production-approval-board).
