import assert from 'node:assert/strict';
import { leadProjectFacts } from '../app/lead-project-facts.ts';

const avalon = ['COMFORT+', 'TUZEL METRO', 'Q2 2028'];
assert.deepEqual(leadProjectFacts('en', 'avalon-residence', undefined, avalon), avalon);
assert.deepEqual(leadProjectFacts('ru', undefined, undefined, avalon), avalon);
for (const language of ['ru', 'uz', 'en']) {
  for (const project of ['pushkin', 'c1', 'sun', 'mirador']) {
    const facts = leadProjectFacts(language, project, undefined, avalon);
    assert.equal(facts.length, 3);
    assert.doesNotMatch(facts.join(' '), /COMFORT|TUZEL|2028/);
  }
}
const pushkin = ['Business', 'Q4 2027', '21 Olmachi Street'];
assert.deepEqual(leadProjectFacts('en', 'pushkin', pushkin, avalon), pushkin);
assert.deepEqual(leadProjectFacts('en', 'pushkin', [], avalon), []);
console.log('Lead facts: supplied facts preserved, Avalon defaults scoped to Avalon, and other projects receive neutral localized facts.');
