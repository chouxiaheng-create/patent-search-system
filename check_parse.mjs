const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4YnhleXlzdHh3emJtcW1wcnltIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA1NDQxMCwiZXhwIjoyMDkxNjMwNDEwfQ.wbPW39XSQQLE0jQtCBhUj-_ZzXrmshuQLIu1mJ8qCgA'
const url = 'https://exbxeyystxwzbmqmprym.supabase.co'
const h = { 'apikey': key, 'Authorization': 'Bearer ' + key }

// 1. patent_documents (去掉 updated_at)
console.log('=== patent_documents (最近 5 条) ===')
const r1 = await fetch(url + '/rest/v1/patent_documents?select=id,title,parse_status,created_at&order=created_at.desc&limit=5', { headers: h })
const d1 = await r1.json()
console.log(JSON.stringify(d1, null, 2))

// 2. pg-boss queue 表 - 检查队列是否注册
console.log('\n=== pgboss.queue 表 ===')
const r2 = await fetch(url + '/rest/v1/queue?select=name,state,createdon&limit=20', { headers: { ...h, 'Accept-Profile': 'pgboss' } })
console.log('HTTP', r2.status)
const t2 = await r2.text()
console.log(t2.substring(0, 1500))

// 3. pg-boss job 表
console.log('\n=== pgboss.job 表 ===')
const r3 = await fetch(url + '/rest/v1/job?select=id,name,state,createdon,startedon,completedon&order=createdon.desc&limit=10', { headers: { ...h, 'Accept-Profile': 'pgboss' } })
console.log('HTTP', r3.status)
const t3 = await r3.text()
console.log(t3.substring(0, 2000))
