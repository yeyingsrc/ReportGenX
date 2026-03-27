/**
 * 版本一致性检查脚本
 * 校验：tag(可选) / package.json / backend/config.yaml / backend/shared-config.json
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT_DIR, 'package.json');
const CONFIG_YAML = path.join(ROOT_DIR, 'backend', 'config.yaml');
const SHARED_CONFIG_JSON = path.join(ROOT_DIR, 'backend', 'shared-config.json');

function normalizeVersion(version) {
  if (!version) {
    return '';
  }

  const text = String(version).trim();
  if (text.toLowerCase().startsWith('v')) {
    return text.slice(1);
  }
  return text;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readBackendConfigVersion() {
  const content = fs.readFileSync(CONFIG_YAML, 'utf-8');
  const match = content.match(/^version:\s*V?([\d.]+)/m);
  if (!match) {
    throw new Error('Cannot find version in backend/config.yaml');
  }
  return normalizeVersion(match[1]);
}

function readSharedConfigVersion() {
  const shared = readJson(SHARED_CONFIG_JSON);
  return normalizeVersion(shared?.app?.version || '');
}

function getTagVersion() {
  const tagFlag = process.argv.find((arg) => arg.startsWith('--tag='));
  if (tagFlag) {
    return normalizeVersion(tagFlag.split('=')[1]);
  }

  const index = process.argv.indexOf('--tag');
  if (index >= 0 && process.argv[index + 1]) {
    return normalizeVersion(process.argv[index + 1]);
  }

  return '';
}

function main() {
  const packageVersion = normalizeVersion(readJson(PACKAGE_JSON).version);
  const backendVersion = readBackendConfigVersion();
  const sharedVersion = readSharedConfigVersion();
  const tagVersion = getTagVersion();

  const pairs = [
    ['package.json', packageVersion],
    ['backend/config.yaml', backendVersion],
    ['backend/shared-config.json', sharedVersion],
  ];

  if (tagVersion) {
    pairs.unshift(['git tag', tagVersion]);
  }

  const baseline = pairs[0][1];
  const mismatches = pairs.filter(([, version]) => version !== baseline);

  if (!baseline || mismatches.length > 0) {
    console.error('[check-version-sync] Version mismatch detected:');
    for (const [name, version] of pairs) {
      console.error(`  - ${name}: ${version || '(empty)'}`);
    }
    process.exit(1);
  }

  console.log(`[check-version-sync] OK: ${baseline}`);
}

main();
