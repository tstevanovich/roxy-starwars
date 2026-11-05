# TypeScript development

The app uses React 19 with TypeScript 6, Vite, Material UI, Express and Mongoose. Use `.tsx` for React components and JSX tests; use `.ts` for other source, tests and launchers. Native tooling configuration files are intentional exceptions: `eslint.config.js`, `prettier.config.mjs` and `stylelint.config.mjs`.

## Run the checks

From the root in PowerShell:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run lint:styles
npm.cmd test
npm.cmd run build
npm.cmd run check
```

`check` runs formatting, both TypeScript projects, ESLint, Stylelint, all workspace and launcher tests, then the Vite production build. `npm.cmd run format` and `npm.cmd run lint:fix` apply supported formatting/import fixes. `npm.cmd run test:watch --workspace client` watches React tests.

Tests use mock providers and isolated temporary databases. They do not use the saved studio database or submit paid generation requests. Do not substitute the normal application connection string in a test.

## Browser and Node configurations

- The root `tsconfig.json` checks server code, shared helpers and scripts using `NodeNext` resolution. Node 24.15+ or 26+ runs these `.ts` files directly; no server output directory is needed.
- `client/tsconfig.json` extends the root settings and uses `ESNext`/`Bundler` resolution, DOM types and `react-jsx` for Vite. Vitest and Testing Library types are scoped to this project.
- Both configurations use `noEmit`. Vite produces the browser JavaScript and CSS in `client/dist`.
- Relative source imports include their actual `.ts` or `.tsx` extension. Keep third-party package paths as their package documents specify; an SDK's published `index.js` path is not a local source rename.
- `erasableSyntaxOnly` and `verbatimModuleSyntax` keep the server compatible with native type stripping. Prefer interfaces, type aliases, literal unions and `import type`; do not introduce TypeScript enums or constructor parameter properties into native Node code.

Node and Vite remove types when running the code. Neither checks whether the types are correct. Run `typecheck` before treating a successful startup as validation.

## Source ownership

Keep code beside the application that uses it. `/client/src` owns browser UI and client-only helpers; `/server/src` owns request handling, persistence, generation and server-only rules. `/shared` contains types, defaults and functions consumed by both sides, plus tooling used by both workspace configurations.

Determine ownership using production imports, including indirect imports and type imports. A helper used by a shared module that both applications import still belongs in `/shared`. For example, `video-readiness.ts` is used by the client through `shot-revisions.ts`. A server test importing a helper does not make that helper server runtime code. Shared runtime modules must not import client or server implementation files.

The November 4 cleanup moved these single-workspace helpers and updated their callers:

| Location      | Modules                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `server/src/` | `animatic-timing-rules.ts`, `asset-image-prompts.ts`, `shot-image-revision.ts`, `shot-setting.ts`, `sound-plan-review.ts` |
| `client/src/` | `asset-source-links.ts`                                                                                                   |

`server/src/animatic-timing-rules.ts` contains the pure timing calculations and dialogue splitting. `server/src/animatic-timing.ts` handles audio inspection and saved timing drafts. Each moved helper has its own matching `.test.ts` file. Moving a runtime module into a workspace also brings it under that workspace's existing per-file 100% coverage gate.

## Typing boundaries

`shared/types.ts` describes serialized studio records, component/API contracts and persisted input views. MongoDB IDs and dates differ from browser JSON strings, so server evaluators accept persisted input types rather than pretending database documents are browser DTOs. Mongoose models infer their stored fields from their schemas; this migration does not change stored schemas or rewrite user records.

The migration uses incremental compiler strictness (`strict: false`). Existing dynamic provider payloads, Mongoose Mixed fields and older callbacks still have broad inferred types. The project is checked by TypeScript, but it is not a fully strict codebase. Prefer explicit types on new component props, state, public function parameters and API results. Do not add `@ts-nocheck`, `@ts-ignore` or blanket `any` annotations to hide errors. A future strictness pass should narrow these boundaries with runtime validation before enabling strict mode globally.

Untrusted request bodies still pass through server validators. A TypeScript annotation is not runtime validation. `shared/errors.ts` normalizes caught values without discarding native errors.

## React examples

Keep props small and name their types when a component grows:

```tsx
import { useState } from 'react';
import type { Clip } from '../../shared/types.ts';

type ShotTitleProps = {
  clip: Pick<Clip, 'id' | 'title'>;
  onSave: (id: string, title: string) => Promise<void>;
};

export function ShotTitle({ clip, onSave }: ShotTitleProps) {
  const [title, setTitle] = useState(clip.title);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await onSave(clip.id, title);
      }}
    >
      <input value={title} onChange={(event) => setTitle(event.target.value)} />
      <button type="submit">Save title</button>
    </form>
  );
}
```

Let React infer event types from JSX handlers. Use a generic when state starts empty, such as `useState<Clip | null>(null)`, or a DOM ref such as `useRef<HTMLVideoElement | null>(null)`. Use `Partial<Clip>` for a patch rather than a complete replacement. For a function with a body, put the return type after the parameters.

The fetch helper accepts typed results:

```ts
import { request } from './api.ts';
import type { Episode } from '../../shared/types.ts';

const result = await request<{ episode: Episode }>('/studio/episodes/' + episodeId, {
  method: 'PUT',
  body: savedEpisode
});
```

The generic describes the response expected at this endpoint. It does not validate arbitrary server JSON. Client test fixtures live in `client/src/test/fixtures.ts`; use those constructors so mock records include the defaults supplied by the API. Vitest mocks should use `vi.mocked(request)` for typed mock controls.

## Styling and linting

`client/src/main.tsx` imports `styles.scss`. Sass compilation is handled by Vite. Use SCSS only where a stylesheet is useful; retain MUI's responsive `sx` styling for existing components. Stylelint applies its SCSS preset/parser and property ordering rules to `.scss` files, and its CSS rules to `.css` files. It does not inspect `sx` objects.

`eslint.config.js` keeps ESLint 10, TypeScript recommended rules, React Hooks and Refresh checks, Testing Library rules for client tests, and sorted imports. Prettier's compatibility config stays last. Do not silence lint or compiler errors by excluding application folders from the checks.

## Editing and running

See [Client testing and file inventory](CLIENT-TESTING.md), [Server testing](SERVER-TESTING.md) and [Shared testing](SHARED-TESTING.md) for the four 100% coverage targets, workspace commands, VS Code compatibility and runtime versus tooling files. Client, server and shared each have their own Vitest configuration and coverage scope. Keep shared tests beside their matching `.ts` modules; they run through the `shared` workspace instead of the server configuration. Launcher tests under `scripts/` continue to use Node's test runner.

VS Code uses `node_modules/typescript/lib` and recommends the workspace TypeScript version. Prettier, ESLint and Stylelint fixes remain available on explicit saves.

`npm.cmd run dev` watches the TypeScript API and starts Vite. `npm.cmd run studio` serves the built browser bundle and runs the TypeScript launcher. Changes to built client files require `npm.cmd run build`; production server changes require a restart. Existing database records, media files, credentials and local recovery drafts are retained.
