const path = require('path')
const { _electron: electron } = require('playwright')

const TOKEN_ERROR_PATTERN = /invalid application token|令牌不一致|token mismatch/i

async function runSmoke() {
  const appPath = path.resolve(__dirname, '..')
  const electronApp = await electron.launch({
    args: [appPath],
    timeout: 120000,
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

    console.log('[e2e-smoke] PASS')
  } finally {
    await electronApp.close()
  }
}

runSmoke().catch((err) => {
  console.error('[e2e-smoke] FAIL:', err && err.message ? err.message : err)
  process.exit(1)
})
