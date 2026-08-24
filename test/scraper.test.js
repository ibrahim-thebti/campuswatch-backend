const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { parseAnnouncements, inferDate } = require('../src/scraper');

const fixtureHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures/isims_home.html'),
  'utf-8'
);

// Pin "now" to a date after all fixture items so year-inference resolves
// deterministically for this test (fixture's newest item is 13 Aoû = Aug 13).
const FIXED_NOW = new Date('2026-08-22T12:00:00Z');

const results = parseAnnouncements(fixtureHtml, { now: FIXED_NOW });

console.log(`Parsed ${results.length} announcements from fixture.\n`);
results.forEach((r, i) => {
  console.log(`${i + 1}. [${r.publication_date}] ${r.title}`);
  console.log(`   id: ${r.external_id}`);
  console.log(`   url: ${r.url}`);
  console.log(`   desc: ${r.description ? r.description.slice(0, 70) + '...' : '(none)'}`);
  console.log('');
});

// --- Assertions -------------------------------------------------------

assert.strictEqual(results.length, 5, 'expected 5 announcements in fixture page 1 (page 2 items are intentionally excluded)');

const first = results[0];
assert.strictEqual(first.publication_date, '2026-08-13');
assert.ok(first.title.includes("Candidature au concours sur dossiers"));
assert.strictEqual(
  first.external_id,
  'fra/articles/2024/candidature-au-concours-sur-dossiers-pour-lacces-au-cycle-de-formation-dingenieurs-au-titre-de-lannee-universitaire-2026-2027'
);
assert.strictEqual(
  first.url,
  'https://isimsf.rnu.tn/fra/articles/2024/candidature-au-concours-sur-dossiers-pour-lacces-au-cycle-de-formation-dingenieurs-au-titre-de-lannee-universitaire-2026-2027'
);
assert.ok(!first.title.includes('new.png'), 'title should not include the leftover new-badge markup');

const second = results[1];
assert.strictEqual(second.publication_date, '2026-07-30');

const third = results[2];
assert.strictEqual(third.publication_date, '2026-06-29');

// Arabic-titled entry should parse fine too (unicode handling)
const arabicEntry = results.find(r => r.external_id.includes('بلاغ'));
assert.ok(arabicEntry, 'expected to find the Arabic-titled announcement');
assert.strictEqual(arabicEntry.publication_date, '2026-06-25');

// Only page 1 should be parsed (the Dec item lives on page 2 in the fixture)
const decItem = results.find(r => r.title.includes('Call for Applications'));
assert.strictEqual(decItem, undefined, 'page 2 items should NOT be included (only page 1 is monitored)');

// inferDate direct unit tests
assert.strictEqual(inferDate('13', 'Aoû.', FIXED_NOW), '2026-08-13');
assert.strictEqual(inferDate('05', 'Déc.', FIXED_NOW), '2025-12-05', 'Dec date should roll back to previous year when checked in August');
assert.strictEqual(inferDate('01', 'Jan.', new Date('2026-01-05T00:00:00Z')), '2026-01-01');

console.log('✅ All assertions passed.');
