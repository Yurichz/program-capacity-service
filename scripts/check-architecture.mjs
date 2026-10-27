#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkArchitecture(projectPath) {
  const project = resolve(projectPath);
  const ts = createRequire(join(project, 'package.json'))('typescript');
  const sourceRoot = join(project, 'src');
  const configFile = ts.readConfigFile(join(project, 'tsconfig.json'), ts.sys.readFile);
  if (configFile.error) throw new Error('Cannot read tsconfig.json');
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, project);
  const files = new Map();
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory() && entry.name !== 'generated') await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.set(
          path,
          ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true),
        );
      }
    }
  }
  await walk(sourceRoot);
  const problems = [];
  const graph = new Map();
  const classes = new Map();
  const modules = [];
  const registrations = new Set();
  const layerModules = [];
  const slash = (path) => relative(sourceRoot, path).split(sep).join('/');
  const report = (file, node, message) =>
    problems.push({
      file: slash(file),
      line: files.get(file).getLineAndCharacterOfPosition(node.getStart()).line + 1,
      message,
    });
  const decorators = (node) => (ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []);
  const decorator = (node, name) =>
    decorators(node).find(
      (item) =>
        ts.isCallExpression(item.expression) && item.expression.expression.getText() === name,
    )?.expression;
  const refs = (node) => {
    const result = new Set();
    if (node) {
      const visit = (part) => {
        if (ts.isIdentifier(part)) result.add(part.text);
        ts.forEachChild(part, visit);
      };
      visit(node);
    }

    return result;
  };
  for (const [file, source] of files) {
    const path = slash(file);
    if (!/^[a-z0-9./-]+$/.test(path)) report(file, source, 'Use kebab-case paths');
    if (
      file.endsWith('.controller.ts') &&
      !path.startsWith('core/app/') &&
      !/\/layers\/[^/]+-bl\/(?:controllers\/)?[^/]+\.controller\.ts$/.test(path)
    )
      report(file, source, 'Controllers belong to the BL layer');
    const edges = [];
    const prismaFields = new Set();
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const resolved = ts.resolveModuleName(specifier, file, config.options, ts.sys)
          .resolvedModule?.resolvedFileName;
        const isType =
          node.importClause?.isTypeOnly ||
          (node.importClause?.namedBindings &&
            ts.isNamedImports(node.importClause.namedBindings) &&
            !node.importClause.name &&
            node.importClause.namedBindings.elements.length > 0 &&
            node.importClause.namedBindings.elements.every((item) => item.isTypeOnly));
        if (resolved && files.has(resolved) && !isType) edges.push(resolved);
        const target = resolved ? slash(resolved) : specifier;
        if (
          file.endsWith('.controller.ts') &&
          (/prisma/i.test(specifier) ||
            /\.repository\.[jt]s$/.test(specifier) ||
            /providers\/prisma|generated\/prisma/.test(target))
        )
          report(file, node, 'Controller must use a BL service, not Prisma/repositories');
        if (
          /\/layers\/[^/]+-da\//.test(path) &&
          !isType &&
          /\/layers\/[^/]+-(?:bl|cl)\//.test(target)
        )
          report(file, node, 'DA cannot depend on BL/CL at runtime');
      }
      if (ts.isClassDeclaration(node) && node.name) {
        const identity = `${file}#${node.name.text}`;
        classes.set(identity, {
          file,
          node,
          name: node.name.text,
          injectable: Boolean(decorator(node, 'Injectable')),
          controller: Boolean(decorator(node, 'Controller')),
        });
        const module = decorator(node, 'Module');
        if (module) {
          modules.push({ file, node, name: node.name.text, metadata: module.arguments[0] });
          if (/\/layers\/[^/]+-(bl|da|cl)\//.test(path))
            layerModules.push({
              file,
              node,
              name: node.name.text,
              layer: /\/layers\/[^/]+-(bl|da|cl)\//.exec(path)[1],
            });
        }
      }
      if (
        ts.isParameter(node) &&
        node.type?.getText() === 'PrismaService' &&
        ts.isIdentifier(node.name)
      )
        prismaFields.add(node.name.text);
      if (ts.isCallExpression(node) && /\/layers\/[^/]+-(?:bl|cl)\//.test(path)) {
        const text = node.expression.getText();
        for (const field of prismaFields) {
          if (
            text.startsWith(`this.${field}.`) &&
            ![`this.${field}.$tx`, `this.${field}.$txe`].includes(text)
          )
            report(file, node, 'BL/CL must use repositories for database operations');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    graph.set(file, edges);
  }
  const knownClasses = new Map();
  for (const item of classes.values()) knownClasses.set(item.name, item);
  for (const module of modules) {
    if (!module.metadata || !ts.isObjectLiteralExpression(module.metadata)) continue;
    for (const property of module.metadata.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name.getText();
      if (['providers', 'controllers'].includes(key)) {
        for (const name of refs(property.initializer)) {
          if (knownClasses.has(name)) registrations.add(`${knownClasses.get(name).file}#${name}`);
        }
      }
    }
  }
  // Dynamic providers, such as CASL, may be declared in forRoot/forFeature methods.
  for (const [file, source] of files) {
    if (!file.endsWith('.module.ts')) continue;
    const visit = (node) => {
      if (
        ts.isPropertyAssignment(node) &&
        ['providers', 'controllers'].includes(node.name.getText())
      ) {
        for (const name of refs(node.initializer))
          if (knownClasses.has(name)) registrations.add(`${knownClasses.get(name).file}#${name}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const [identity, item] of classes) {
    if ((item.injectable || item.controller) && !registrations.has(identity))
      report(item.file, item.node, `${item.name} is not registered in a Nest module`);
  }
  for (const item of layerModules) {
    const list = join(sourceRoot, 'core/app', `app-${item.layer}-imports.ts`);
    const source = files.get(list);
    const arrayName = { bl: 'AppBLImports', da: 'AppDaImports', cl: 'AppCLImports' }[item.layer];
    let declared;
    const findArray = (node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText() === arrayName)
        declared = node.initializer;
      ts.forEachChild(node, findArray);
    };
    if (source) findArray(source);
    if (!declared || !refs(declared).has(item.name))
      report(item.file, item.node, `${item.name} is missing from app-${item.layer}-imports.ts`);
  }
  for (const item of modules.filter((module) => /-bl\.module\.ts$/.test(module.file))) {
    const path = slash(item.file);
    const ownDa = path.replace(/-bl\//, '-da/').replace(/-bl\.module\.ts$/, '-da.module.ts');
    const own = modules.find((module) => slash(module.file) === ownDa);
    if (own && !refs(item.metadata).has(own.name))
      report(
        item.file,
        item.node,
        `BL must explicitly import ${own.name}; root imports do not share its providers`,
      );
  }
  const visiting = new Set(),
    finished = new Set(),
    stack = [],
    cycleKeys = new Set();
  function visit(file) {
    if (finished.has(file)) return;
    if (visiting.has(file)) {
      const cycle = stack.slice(stack.indexOf(file)).concat(file);
      const key = [...new Set(cycle)].sort().join('|');
      if (!cycleKeys.has(key)) {
        cycleKeys.add(key);
        report(file, files.get(file), `Runtime import cycle: ${cycle.map(slash).join(' -> ')}`);
      }

      return;
    }
    visiting.add(file);
    stack.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    stack.pop();
    visiting.delete(file);
    finished.add(file);
  }
  for (const file of files.keys()) visit(file);

  return { ok: problems.length === 0, files: files.size, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--project')
      throw new Error('Usage: node check-architecture.mjs --project DIR');
    const result = await checkArchitecture(process.argv[3]);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
