// Copies static assets from src/ into dist/, mirroring their path.
const fs = require('fs');
const path = require('path');

const SRC_DIRS = [
  'db/patches',
  'mjml',
];

const STATIC_DIRS = [
  'static',
];

const SKIP_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

function copyDir(srcDir, destDir, skipExt) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, skipExt);
    } else if (!skipExt.has(path.extname(entry.name))) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

for (const relDir of SRC_DIRS) {
  const srcDir = path.join(__dirname, '..', 'src', relDir);
  const destDir = path.join(__dirname, '..', 'dist', relDir);
  if (fs.existsSync(srcDir)) copyDir(srcDir, destDir, SKIP_EXT);
}

for (const relDir of STATIC_DIRS) {
  const srcDir = path.join(__dirname, '..', 'src', relDir);
  const destDir = path.join(__dirname, '..', 'dist', relDir);
  if (fs.existsSync(srcDir)) copyDir(srcDir, destDir, new Set());
}

for (const file of ['schema.sql', 'schema_ref.sql', 'users.sql']) {
  fs.copyFileSync(
    path.join(__dirname, '..', 'src', 'db', file),
    path.join(__dirname, '..', 'dist', 'db', file),
  );
}
