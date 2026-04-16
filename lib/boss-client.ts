import PgBoss from 'pg-boss'

declare global {
  // eslint-disable-next-line no-var
  var _pgBoss: PgBoss | undefined
}

export async function getBossClient(): Promise<PgBoss> {
  if (!global._pgBoss) {
    global._pgBoss = new PgBoss(process.env.DATABASE_URL!)
    await global._pgBoss.start()
  }
  return global._pgBoss
}
