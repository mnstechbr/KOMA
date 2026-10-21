export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.KOMA_DESKTOP === '1' && process.env.KOMA_AUTOMATION_DISABLED !== '1') {
    const { startWorkAutomation } = await import('./lib/backend/works/worker')
    startWorkAutomation()
    const [{ startCloudSync }, { db }] = await Promise.all([import('./lib/backend/storage/cloud'), import('./lib/backend/shared/database.module')])
    startCloudSync(db)
  }
}
