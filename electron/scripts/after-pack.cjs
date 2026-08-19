/**
 * electron-builder afterPack: ensure server dist + production node_modules are
 * present under resources/server. FileSet skips gitignored paths (including
 * node_modules and electron-resources/), which otherwise ships a broken API
 * (express missing → health check timeout on port 3001).
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

function assertExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[afterPack] Missing ${label}: ${filePath}`);
  }
}

exports.default = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const stagedServer = path.join(projectDir, 'electron-resources', 'server');
  const resourcesServer = path.join(context.appOutDir, 'resources', 'server');

  assertExists(path.join(stagedServer, 'dist', 'index.js'), 'staged server dist/index.js');
  assertExists(path.join(stagedServer, 'package.json'), 'staged server package.json');
  assertExists(
    path.join(stagedServer, 'node_modules', 'express', 'package.json'),
    'staged express (run prepare-server-resources first)',
  );

  fs.mkdirSync(resourcesServer, { recursive: true });

  // dist + package metadata (FileSet may have partially copied these)
  const distDest = path.join(resourcesServer, 'dist');
  fs.rmSync(distDest, { recursive: true, force: true });
  copyDir(path.join(stagedServer, 'dist'), distDest);
  fs.copyFileSync(
    path.join(stagedServer, 'package.json'),
    path.join(resourcesServer, 'package.json'),
  );
  const exampleEnv = path.join(stagedServer, '.env.example');
  if (fs.existsSync(exampleEnv)) {
    fs.copyFileSync(exampleEnv, path.join(resourcesServer, '.env.example'));
  }

  const stagedPublic = path.join(stagedServer, 'public');
  if (fs.existsSync(stagedPublic)) {
    const publicDest = path.join(resourcesServer, 'public');
    fs.rmSync(publicDest, { recursive: true, force: true });
    copyDir(stagedPublic, publicDest);
    console.log(`[afterPack] Copied frontend public -> ${publicDest}`);
  }

  const srcModules = path.join(stagedServer, 'node_modules');
  const destModules = path.join(resourcesServer, 'node_modules');
  console.log(`[afterPack] Copying server node_modules -> ${destModules}`);
  fs.rmSync(destModules, { recursive: true, force: true });
  copyDir(srcModules, destModules);

  assertExists(path.join(resourcesServer, 'dist', 'index.js'), 'packaged dist/index.js');
  assertExists(path.join(destModules, 'express', 'package.json'), 'packaged express');

  fs.writeFileSync(
    path.join(resourcesServer, '.desktop-packaged'),
    JSON.stringify(
      {
        packagedAt: new Date().toISOString(),
        hasExpress: true,
        entry: 'dist/index.js',
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log('[afterPack] server dist + node_modules OK');
};
