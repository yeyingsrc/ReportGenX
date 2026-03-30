const fs = require('fs');
const path = require('path');

const os = process.env.RUNNER_OS || {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
}[process.platform];

function listMacSharedConfigCandidates() {
  const macRoots = [
    path.join('dist', 'mac'),
    path.join('dist', 'mac-arm64')
  ];

  const candidates = [];
  for (const root of macRoots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith('.app')) {
        continue;
      }

      candidates.push(
        path.join(root, entry.name, 'Contents', 'Resources', 'backend', 'shared-config.json')
      );
    }
  }

  return candidates;
}

const candidatesByOs = {
  Windows: [
    path.join('dist', 'win-unpacked', 'resources', 'backend', 'shared-config.json'),
    path.join('dist', 'win-arm64-unpacked', 'resources', 'backend', 'shared-config.json')
  ],
  macOS: listMacSharedConfigCandidates(),
  Linux: [
    path.join('dist', 'linux-unpacked', 'resources', 'backend', 'shared-config.json')
  ]
};

const requiredByOs = {
  Windows: 'all',
  macOS: 'any',
  Linux: 'any'
};

const candidates = candidatesByOs[os] || [];
const existing = candidates.filter((candidate) => fs.existsSync(candidate));
const missing = candidates.filter((candidate) => !fs.existsSync(candidate));

console.log(`[verify-shared-config] runner=${os}`);
console.log(`[verify-shared-config] candidates=${candidates.join(', ')}`);

if (requiredByOs[os] === 'all') {
  if (missing.length > 0) {
    throw new Error(`shared-config.json missing in one or more packaged outputs: ${missing.join(', ')}`);
  }
} else if (existing.length === 0) {
  throw new Error(`shared-config.json not found in packaged resources. Checked: ${candidates.join(', ')}`);
}

console.log(`[verify-shared-config] found=${existing.join(', ')}`);
