// Copies non-TS/JS static assets from src/ into dist/, mirroring their path.
// (.ts/.js files are handled by tsc itself since allowJs is enabled.)
const fs = require('fs');
const path = require('path');

const SRC_DIRS = [
  'db/patches',
  'mjml',
  'static',
];

const SKIP_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

function copyDir(srcDir, destDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (!SKIP_EXT.has(path.extname(entry.name))) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

for (const relDir of SRC_DIRS) {
  const srcDir = path.join(__dirname, '..', 'src', relDir);
  const destDir = path.join(__dirname, '..', 'dist', relDir);
  if (fs.existsSync(srcDir)) copyDir(srcDir, destDir);
}

for (const file of ['schema.sql', 'schema_ref.sql', 'users.sql']) {
  fs.copyFileSync(
    path.join(__dirname, '..', 'src', 'db', file),
    path.join(__dirname, '..', 'dist', 'db', file),
  );
}
