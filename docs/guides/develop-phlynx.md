# Developer Guide

**Requirements:** Node.js 20.19+ or 22.12+ (CI uses 24), and Yarn 4 via Corepack.

## Set up and run

```bash
git clone https://github.com/physiomelinks/phlynx.git
cd phlynx
corepack enable
yarn install
yarn dev
```

The app runs at http://localhost:5173. Simulation needs localhost or https.

## Common commands

| Command | Does |
| --- | --- |
| `yarn test:unit` | Unit tests (Vitest) |
| `yarn test:ui` | Browser tests (Playwright, Python) against `PHLYNX_BASE_URL` (default https://phlynx.com/) |
| `yarn build` | Production build to `dist/`; `yarn preview` serves it |
| `yarn app:dev` / `yarn app:build` | Desktop (Electron) app |
| `yarn update:docs:changelog` | Regenerate the [Change Log](../reference/change-log.md) from `changelogs/` |

Browser tests and screenshots need `pip install -r tests/requirements.txt` and `playwright install --with-deps chromium`.

To regenerate the docs images, start `yarn dev`, then run:

```bash
PHLYNX_BASE_URL=http://localhost:5173/ yarn docs:screenshots
```

Open pull requests against `main` on [physiomelinks/phlynx](https://github.com/physiomelinks/phlynx), one branch per PR.
