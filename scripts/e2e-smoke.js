const path = require('path')
const { _electron: electron } = require('playwright')

const TOKEN_ERROR_PATTERN = /invalid application token|令牌不一致|token mismatch/i

async function runSmoke() {
  const appPath = path.resolve(__dirname, '..')
  const isGithubLinux = process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true'
  const launchArgs = [appPath]
  if (isGithubLinux) {
    // Must be passed at process launch time for CI sandbox failures.
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox')
  }

  const electronApp = await electron.launch({
    args: launchArgs,
    timeout: 120000,
    env: {
      ...process.env,
      ...(isGithubLinux ? { ELECTRON_DISABLE_SANDBOX: '1' } : {})
    }
  })

  let page
  try {
    page = await electronApp.firstWindow()
    await page.waitForSelector('#btn-open-toolbox', { timeout: 120000 })
    await page.click('#btn-open-toolbox')

    await page.waitForSelector('.toolbox-nav-item[data-target="view-settings"]', { timeout: 10000 })
    await page.click('.toolbox-nav-item[data-target="view-settings"]')
    await page.waitForSelector('#runtime-settings-panel', { timeout: 10000 })

    const authHeaderValue = await page.evaluate(() => {
      const headers = window.AppAPI && window.AppAPI._buildAuthHeaders
        ? window.AppAPI._buildAuthHeaders()
        : {}
      return headers['X-App-Token'] || ''
    })

    if (!authHeaderValue) {
      throw new Error('Smoke failed: missing X-App-Token in renderer API headers')
    }

    const reportListResult = await page.evaluate(async () => {
      try {
        const data = await window.AppAPI.Reports.list()
        return { ok: true, data }
      } catch (err) {
        return { ok: false, message: err && err.message ? err.message : String(err) }
      }
    })

    if (!reportListResult.ok && TOKEN_ERROR_PATTERN.test(reportListResult.message || '')) {
      throw new Error(`Smoke failed: report list token error: ${reportListResult.message}`)
    }

    const mergeResult = await page.evaluate(async () => {
      try {
        const data = await window.AppAPI.Reports.merge([], 'smoke-merge.docx')
        return { ok: true, data }
      } catch (err) {
        return { ok: false, message: err && err.message ? err.message : String(err) }
      }
    })

    if (!mergeResult.ok && TOKEN_ERROR_PATTERN.test(mergeResult.message || '')) {
      throw new Error(`Smoke failed: report merge token error: ${mergeResult.message}`)
    }

    if (!mergeResult.ok && !TOKEN_ERROR_PATTERN.test(mergeResult.message || '')) {
      console.log('[e2e-smoke] merge returned non-token error (acceptable for smoke):', mergeResult.message)
    }

    const exportResult = await page.evaluate(async () => {
      try {
        const single = await window.AppAPI.Templates.export('vuln_report')
        const batch = await window.AppAPI.Templates.batchExport(['vuln_report', 'intrusion_report'])
        return {
          ok: true,
          singleSize: single && single.blob ? single.blob.size : 0,
          batchSize: batch && batch.blob ? batch.blob.size : 0,
          singleFilename: single && single.filename ? single.filename : '',
          batchFilename: batch && batch.filename ? batch.filename : ''
        }
      } catch (err) {
        return { ok: false, message: err && err.message ? err.message : String(err) }
      }
    })

    if (!exportResult.ok) {
      throw new Error(`Smoke failed: template export error: ${exportResult.message}`)
    }

    if (exportResult.singleSize <= 0 || exportResult.batchSize <= 0) {
      throw new Error(`Smoke failed: template export returned empty archive(s): ${JSON.stringify(exportResult)}`)
    }

    if (!/\.zip$/i.test(exportResult.singleFilename || '') || !/\.zip$/i.test(exportResult.batchFilename || '')) {
      throw new Error(`Smoke failed: template export filename missing zip extension: ${JSON.stringify(exportResult)}`)
    }

    const backupResult = await page.evaluate(async () => {
      let originalCreateObjectURL
      let originalRevokeObjectURL
      let originalAppendChild
      let originalRemoveChild

      try {
        let clickedDownload = ''
        let blobUrlCreated = false

        originalCreateObjectURL = window.URL.createObjectURL
        originalRevokeObjectURL = window.URL.revokeObjectURL
        originalAppendChild = document.body.appendChild.bind(document.body)
        originalRemoveChild = document.body.removeChild.bind(document.body)

        window.URL.createObjectURL = (blob) => {
          blobUrlCreated = !!(blob && blob.size > 0)
          return originalCreateObjectURL.call(window.URL, blob)
        }

        document.body.appendChild = (node) => {
          if (node && typeof node.click === 'function') {
            const originalClick = node.click.bind(node)
            node.click = () => {
              clickedDownload = node.download || ''
              return originalClick()
            }
          }
          return originalAppendChild(node)
        }

        document.body.removeChild = (node) => originalRemoveChild(node)

        const result = await window.AppAPI.backupDatabase()

        return {
          ok: true,
          filename: result && result.filename ? result.filename : '',
          clickedDownload,
          blobUrlCreated
        }
      } catch (err) {
        return { ok: false, message: err && err.message ? err.message : String(err) }
      } finally {
        if (originalCreateObjectURL) {
          window.URL.createObjectURL = originalCreateObjectURL
        }
        if (originalRevokeObjectURL) {
          window.URL.revokeObjectURL = originalRevokeObjectURL
        }
        if (originalAppendChild) {
          document.body.appendChild = originalAppendChild
        }
        if (originalRemoveChild) {
          document.body.removeChild = originalRemoveChild
        }
      }
    })

    if (!backupResult.ok) {
      throw new Error(`Smoke failed: backup download error: ${JSON.stringify(backupResult)}`)
    }

    if (!backupResult.blobUrlCreated) {
      throw new Error(`Smoke failed: backup download did not create blob URL: ${JSON.stringify(backupResult)}`)
    }

    if (!/\.db$/i.test(backupResult.filename || '') || !/\.db$/i.test(backupResult.clickedDownload || '')) {
      throw new Error(`Smoke failed: backup download filename missing db extension: ${JSON.stringify(backupResult)}`)
    }

    console.log('[e2e-smoke] PASS')
  } finally {
    await electronApp.close()
  }
}

runSmoke().catch((err) => {
  console.error('[e2e-smoke] FAIL:', err && err.message ? err.message : err)
  process.exit(1)
})
