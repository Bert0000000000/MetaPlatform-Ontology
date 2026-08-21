const pg = require('pg');
const fs = require('fs');
const c = new pg.Client({host:'localhost',port:54322,user:'postgres',password:'postgres',database:'postgres'});
c.connect().then(async () => {
  const sql = fs.readFileSync('supabase/migrations/20260820620000_create_ontology_kernel.sql','utf8');
  try {
    await c.query(sql);
    console.log('OK');
  } catch (e) {
    console.error('ERR:', e.message);
    console.error('POS:', e.position);
    console.error('CTX:', JSON.stringify(sql.slice(Math.max(0,e.position-100), e.position+100)));
  }
  c.end();
});