import fs from 'node:fs';
const path = 'supabase/config.toml';
let text = fs.readFileSync(path, 'utf8');
console.log('Current search_path line:');
const spLine = text.split('\n').find(l => l.includes('search_path') || l.includes('db-schema'));
console.log('  ' + spLine);

// Add to extra_search_path
if (!text.includes('mp_preset_registry')) {
  text = text.replace(
    /extra_search_path = \[([^\]]+)\]/,
    (m, p) => 'extra_search_path = [' + p.trimEnd() + ', "mp_preset_registry"]',
    1
  );
  console.log('\nNew search_path:');
  console.log('  ' + text.split('\n').find(l => l.includes('search_path')));
}
fs.writeFileSync(path, text, 'utf8');
console.log('\nWritten');
