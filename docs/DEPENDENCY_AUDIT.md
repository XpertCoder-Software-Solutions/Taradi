# Dependency Audit

Audit date: 2026-07-11

## Current Dependency Shape

Backend package:
- Express 4
- Prisma 6
- BullMQ 5
- Socket.IO 4
- Axios
- Multer 2
- xlsx 0.18.5
- Zod 3

Frontend package:
- React 18
- Vite 6
- TypeScript 5
- React Query 5
- Socket.IO client 4
- Axios
- React Hook Form/Zod
- SweetAlert2

Installed versions are newer than some `package.json` ranges because lockfiles currently resolve later patch/minor releases. Keep lockfiles committed and deploy with `npm ci`.

## Known Risk: xlsx

The `xlsx` package is used for employee and customer imports.

Risk:
- `xlsx@0.18.5` is commonly flagged in audits and has limited maintenance compared with alternatives.
- The application parses uploaded Excel files in memory.

Current mitigations:
- Import file size limits exist.
- Import routes require authenticated privileged users.
- Files are not persisted during import.

Recommended next step:
- Evaluate replacing `xlsx` with a maintained parser such as `exceljs` for `.xlsx`.
- Consider dropping `.xls` support if not required, because older binary Excel support expands parser attack surface.
- Add content-signature validation before parsing.
- Move large imports to a background worker.

## Safe Upgrade Rules

Do:
- Use `npm ci` in production.
- Run backend tests and frontend typecheck/build after upgrades.
- Prefer patch/minor upgrades first.
- Upgrade one subsystem at a time when risk is high.

Do not:
- Run `npm audit fix --force` blindly.
- Upgrade major framework versions without a branch and regression pass.
- Remove lockfiles.
- Deploy dependency updates without testing WhatsApp send/webhook flows.

## Commands

Backend:

```bash
npm audit
npm outdated
npm test
npx prisma validate
npm run prisma:generate
```

Frontend:

```bash
cd frontend
npm audit
npm outdated
npm run typecheck
npm run build
```

## Dependency Findings

Critical:
- None reported by `npm audit --audit-level=moderate` on 2026-07-11.

High:
- Backend `npm audit --audit-level=moderate` reports 1 high severity vulnerability in `xlsx` with no fix available:
  - Prototype Pollution in SheetJS.
  - SheetJS Regular Expression Denial of Service.
- `xlsx` should be treated as high-risk until replaced or accepted with documented compensating controls.

Medium:
- Redis-backed rate limiting is not implemented; current package is in-memory `express-rate-limit`.
- No frontend test runner is installed.
- Frontend `npm audit --audit-level=moderate` reports 0 vulnerabilities.

Low:
- Some packages are broader than needed for current usage, but removal should wait until after feature stabilization.

## Outdated Inspection

Backend outdated packages reported on 2026-07-11:
- `@prisma/client` and `prisma`: current 6.19.3, latest 7.8.0.
- `bcryptjs`: current 2.4.3, latest 3.0.3.
- `bullmq`: current 5.79.2, wanted/latest 5.80.2.
- `dotenv`: current 16.6.1, latest 17.4.2.
- `express`: current 4.22.2, latest 5.2.1.
- `zod`: current 3.25.76, latest 4.4.3.

Frontend outdated packages reported on 2026-07-11:
- Patch/minor wanted: `@types/node` 22.20.1, `react-hook-form` 7.81.0.
- Major latest available: React 19, React Router 7, Vite 8, TypeScript 7, Tailwind 4, Zod 4, `@hookform/resolvers` 5, `@vitejs/plugin-react` 6, `lucide-react` 1.

Recommended safe dependency actions:
- Apply BullMQ 5.80.2 and frontend patch/minor wanted updates in a separate PR with tests/build.
- Defer Prisma 7, Express 5, React 19, Vite 8, Tailwind 4, TypeScript 7, Zod 4, and React Router 7 until compatibility is validated.
- Prioritize replacing `xlsx` over broad major upgrades.

## Recommended Additions

Backend testing:
- Keep `node:test` for utility tests.
- Add Supertest only when API integration tests are added.

Frontend testing:
- Add Vitest and React Testing Library when frontend tests are introduced.

Production:
- Add a vulnerability scan step in CI.
- Fail CI on critical/high vulnerabilities except documented accepted risks.
