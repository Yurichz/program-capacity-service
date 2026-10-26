# NestJS Core backend

Use named exports and kebab-case files. Routes live in src/core/routes/<feature>/layers/<feature>-bl/-da/-cl.
Controllers call BL services; only DA repositories and infrastructure perform Prisma model queries. CL coordinates multiple operations; simple CRUD needs no CL. Register layers in app-bl/da/cl-imports and explicitly import dependency modules within features. Runtime cycles are forbidden.
Preserve /api/v1, success/data, numeric errors, DTO 422, response entities and empty 204. Use ApiResult for pagination. Authentication checks active PostgreSQL sessions; CASL checks actual resources. Registration never accepts roles.
Use PrismaService.$tx/$txe and transaction-aware repositories; never mutate singleton transaction state. No organizations, stores, Redis or cloud integrations are assumed.
Run db:generate, typecheck, build, check:architecture, tests and the built runtime as applicable. DB integration tests require an isolated TEST_DATABASE_URL named app_test_*. Do not run resets against ordinary development/production databases.
