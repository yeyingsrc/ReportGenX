/**
 * 版本同步脚本
 * 将 package.json 的版本同步到 backend/config.yaml
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT_DIR, 'package.json');
const CONFIG_YAML = path.join(ROOT_DIR, 'backend', 'config.yaml');

function syncVersion() {
  // 读取 package.json 版本
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'));
  const version = packageJson.version;
  
  // 读取 config.yaml
  let configContent = fs.readFileSync(CONFIG_YAML, 'utf-8');
  
  // 替换版本号 (格式: version: V0.17.3)
  const versionRegex = /^version:\s*V?[\d.]+/m;
  const newVersion = `version: V${version}`;
  
  if (versionRegex.test(configContent)) {
    configContent = configContent.replace(versionRegex, newVersion);
  } else {
    console.error('Warning: version field not found in config.yaml');
    return;
  }
  
  // 写回 config.yaml
  fs.writeFileSync(CONFIG_YAML, configContent, 'utf-8');
  
  console.log(`✓ Version synced: V${version}`);
}

syncVersion();
