const fs = require('fs')
const path = require('path')

const DEFAULT_SHARED_CONFIG = {
  server: {
    host: '127.0.0.1',
    port: 8000
  },
  app: {
    version: '0.0.0'
  },
  security: {
    external_protocols: ['https:'],
    external_hosts: ['github.com', 'www.github.com']
  }
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback
  }

  const cleaned = value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())

  return cleaned.length > 0 ? cleaned : fallback
}

function normalizeSharedConfig(raw) {
  const config = (raw && typeof raw === 'object') ? raw : {}
  const server = (config.server && typeof config.server === 'object') ? config.server : {}
  const appConfig = (config.app && typeof config.app === 'object') ? config.app : {}
  const security = (config.security && typeof config.security === 'object') ? config.security : {}

  const host = server.host === 'localhost' ? '127.0.0.1' : server.host
  const portCandidate = Number(server.port)
  const port = Number.isInteger(portCandidate) && portCandidate >= 1 && portCandidate <= 65535
    ? portCandidate
    : DEFAULT_SHARED_CONFIG.server.port

  return {
    server: {
      host: typeof host === 'string' && host.trim() ? host.trim() : DEFAULT_SHARED_CONFIG.server.host,
      port
    },
    app: {
      version: typeof appConfig.version === 'string' && appConfig.version.trim()
        ? appConfig.version.trim()
        : DEFAULT_SHARED_CONFIG.app.version
    },
    security: {
      external_protocols: normalizeStringArray(
        security.external_protocols,
        DEFAULT_SHARED_CONFIG.security.external_protocols
      ),
      external_hosts: normalizeStringArray(
        security.external_hosts,
        DEFAULT_SHARED_CONFIG.security.external_hosts
      ).map((hostName) => hostName.toLowerCase())
    }
  }
}

function loadSharedConfig(app, baseDir) {
  const configPath = app && app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'shared-config.json')
    : path.join(baseDir, 'backend', 'shared-config.json')

  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return normalizeSharedConfig(raw)
    }
  } catch (e) {
    console.error('Failed to load shared-config.json:', e)
  }

  return normalizeSharedConfig(DEFAULT_SHARED_CONFIG)
}

function encodeBootstrapArgs(sharedConfig, appApiToken) {
  return [
    `--app-api-token=${encodeURIComponent(appApiToken)}`,
    `--app-server-host=${encodeURIComponent(sharedConfig.server.host)}`,
    `--app-server-port=${encodeURIComponent(String(sharedConfig.server.port))}`,
    `--app-version=${encodeURIComponent(sharedConfig.app.version)}`,
    `--app-external-hosts=${encodeURIComponent(sharedConfig.security.external_hosts.join(','))}`
  ]
}

function decodeArgValue(rawValue) {
  if (!rawValue) {
    return ''
  }

  try {
    return decodeURIComponent(rawValue)
  } catch (_e) {
    return rawValue
  }
}

function getArgValue(argv, prefix) {
  const arg = argv.find((item) => typeof item === 'string' && item.startsWith(prefix))
  if (!arg) {
    return ''
  }
  return arg.slice(prefix.length)
}

function parseBootstrapConfig(argv) {
  const host = normalizeSharedConfig({
    server: { host: decodeArgValue(getArgValue(argv, '--app-server-host=')) }
  }).server.host

  const port = normalizeSharedConfig({
    server: { port: decodeArgValue(getArgValue(argv, '--app-server-port=')) }
  }).server.port

  const appVersion = decodeArgValue(getArgValue(argv, '--app-version=')) || DEFAULT_SHARED_CONFIG.app.version
  const appApiToken = decodeArgValue(getArgValue(argv, '--app-api-token='))

  const externalHostsRaw = decodeArgValue(getArgValue(argv, '--app-external-hosts='))
  const externalHostAllowlist = normalizeStringArray(
    typeof externalHostsRaw === 'string'
      ? externalHostsRaw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
      : [],
    DEFAULT_SHARED_CONFIG.security.external_hosts
  )

  return {
    serverHost: host,
    serverPort: port,
    apiBaseUrl: `http://${host}:${port}`,
    appApiToken,
    appVersion,
    externalHostAllowlist
  }
}

module.exports = {
  loadSharedConfig,
  encodeBootstrapArgs,
  parseBootstrapConfig
}
