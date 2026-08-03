/**
 * electron-builder afterPack: ensure server node_modules are copied into
 * resources/server. The default FileSet ignores gitignored node_modules,
 * which leaves a broken desktop API (express missing → health timeout).
 */
'use strict';

const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

exports.default = async function afterPack(context) {
  const resourcesServer = path.join(context.appOutDir, 'resources', 'server');
  const srcModules = path.join(
    context.packager.projectDir,
    'electron-resources',
    'server',
    'node_modules',
  );
  const destModules = path.join(resourcesServer, 'node_modules');

  if (!fs.existsSync(path.join(srcModules, 'express'))) {
    throw new Error(
      `[afterPack] Missing ${path.join(srcModules, 'express')}. Run prepare-server-resources first.`,
    );
  }

  console.log(`[afterPack] Copying server node_modules -> ${destModules}`);
  fs.rmSync(destModules, { recursive: true, force: true });
  copyDir(srcModules, destModules);

  if (!fs.existsSync(path.join(destModules, 'express'))) {
    throw new Error('[afterPack] express was not copied into resources/server/node_modules');
  }
  console.log('[afterPack] server node_modules OK');
};
