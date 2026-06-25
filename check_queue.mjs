import { readFileSync } from 'fs'
const env = readFileSync('worker/.env', 'utf-8')
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const url = 'https://exbxeyystxwzbmqmprym.supabase.co'
const h = { 'apikey': key, 'Authorization': 'Bearer ' + key }

// 查 5e0fbfd3 是否有对应 pgboss job
const r = await fetch(url + '/rest/v1/rpc/exec_sql', {
  method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "SELECT id, name, state, data::text, start_after FROM pgboss.job WHERE name = 'search-job' ORDER BY id DESC LIMIT 10" })
})
console.log('pg-boss search-job status:', r.status)
const text = await r.text()
console.log(text.substring(0, 1500))
