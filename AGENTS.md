# NestJS Core backend

Use named exports and kebab-case files. Routes live in src/core/routes/<feature>/layers/<feature>-bl/-da/-cl.
Controllers call BL services; only DA repositories and infrastructure perform Prisma model queries. CL coordinates multiple operations; simple CRUD needs no CL. Register layers in app-bl/da/cl-imports and explicitly import dependency modules within features. Runtime cycles are forbidden.
Preserve /api/v1, success/data, numeric errors, DTO 422, response entities and empty 204. Use ApiResult for pagination. Authentication checks active PostgreSQL sessions; CASL checks actual resources. Registration never accepts roles.
Use PrismaService.$tx/$txe and transaction-aware repositories; never mutate singleton transaction state. No organizations, stores, Redis or cloud integrations are assumed.
Run db:generate, typecheck, build, check:architecture, tests and the built runtime as applicable. DB integration tests require an isolated TEST_DATABASE_URL named app_test_*. Do not run resets against ordinary development/production databases.

# Code style

- Use 2 spaces, never tabs. Indent case/default one additional level inside switch.
- Keep code lines within 150 characters. Wrap long imports, signatures, calls and objects manually when ESLint cannot fix them.
- Use single quotes; double quotes are allowed to avoid escaping. JSON uses double quotes.
- Use semicolons and trailing commas in multiline objects, arrays, imports, calls and parameter lists.
- Put spaces around operators, after commas and type colons. Use { id } for objects and [id] for arrays.
- Leave exactly one blank line between class members and before return after other statements.
  A return that is the first or only statement in its block needs no preceding blank line.
- Put each class, method and property decorator on its own line immediately before the declaration, with no blank lines between them.
  Keep short parameter decorators inline, e.g. @Body() input: CreateDto.
- Put each parameter of a constructor with multiple DI dependencies on its own line; use a trailing comma in multiline signatures.
- Leave a blank line after the import block; preserve import and operation order.
- Save UTF-8 with LF, a final newline and no trailing whitespace. JSON/config files use 2 spaces.
- ESLint is the single code-style tool. Run npm run lint to check and npm run lint:fix to apply fixes.
  Do not add a conflicting formatter. The root configuration also covers web sources, scripts and tests.
- Exclude node_modules, dist, coverage and generated code. Review decorator placement, DI signatures and long lines manually.
