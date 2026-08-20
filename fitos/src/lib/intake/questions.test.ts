/**
 * Quick intake — the shape of the default retail flow.
 *
 * These assert the contract the pilot store asked for: three yes/no questions
 * for a new customer, two for a returning one, nothing typed, nothing chosen
 * from a list, before the scan. Holding that as a test rather than a convention
 * is the point — "we should keep it short" is exactly the kind of intention
 * that erodes one field at a time.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_CUSTOMER_QUESTIONS, RETURNING_CUSTOMER_QUESTIONS, questionsFor,
  QUICK_INTAKE_FIELDS, DETAIL_FIELDS,
} from './questions';

test('QI01 a new customer is asked exactly three questions', () => {
  assert.equal(NEW_CUSTOMER_QUESTIONS.length, 3);
  assert.equal(questionsFor(1).length, 3);
  assert.equal(questionsFor(0).length, 3, 'a first visit with no number is still new');
});

test('QI02 a returning customer is asked exactly two', () => {
  assert.equal(RETURNING_CUSTOMER_QUESTIONS.length, 2);
  assert.equal(questionsFor(2).length, 2);
  assert.equal(questionsFor(7).length, 2);
});

test('QI03 every required question is yes/no — no free text, no dropdowns', () => {
  for (const q of [...NEW_CUSTOMER_QUESTIONS, ...RETURNING_CUSTOMER_QUESTIONS]) {
    assert.equal(q.kind, 'yes_no', `${q.field} must be binary`);
    assert.ok(q.prompt.trim().endsWith('?'), `${q.field} must read as a question`);
  }
});

test('QI04 the prompts use retail language, not clinical language', () => {
  // A shoe shop is not a clinic. This list is the vocabulary the brief ruled
  // out, and a Yes must never read as a diagnosis.
  const BANNED = [/gait/i, /biomechanic/i, /plantar/i, /patholog/i, /pronation/i,
                  /diagnos/i, /screening/i, /assessment/i, /condition/i];
  for (const q of [...NEW_CUSTOMER_QUESTIONS, ...RETURNING_CUSTOMER_QUESTIONS]) {
    for (const pattern of BANNED) {
      assert.ok(!pattern.test(q.prompt), `${q.field} uses clinical language: ${q.prompt}`);
    }
  }
});

test('QI05 returning questions never re-ask what FitOS already knows', () => {
  // Both returning prompts are explicitly framed against the last visit. If one
  // ever asks a standalone question, the customer is being made to repeat
  // themselves, which is the thing this redesign exists to stop.
  for (const q of RETURNING_CUSTOMER_QUESTIONS) {
    assert.match(q.prompt, /since your last visit/i, `${q.field} should be framed against the last visit`);
  }
});

test('QI06 Add detail is optional wherever it is offered', () => {
  const withDetail = [...NEW_CUSTOMER_QUESTIONS, ...RETURNING_CUSTOMER_QUESTIONS]
    .filter((q) => q.offersDetail);
  assert.ok(withDetail.length > 0, 'at least one question should be able to expand');
  for (const q of withDetail) {
    assert.ok(q.detailFields.length > 0, `${q.field} offers detail but exposes no fields`);
  }
  // The third new-customer question deliberately offers nothing: there is no
  // useful detail behind "are you active", only a longer intake.
  assert.equal(NEW_CUSTOMER_QUESTIONS[2].offersDetail, false);
});

test('QI07 detail fields are pre-existing columns, not new ones', () => {
  // The whole preservation claim rests on this: Add detail writes the schema
  // that already existed, so nothing was removed and nothing was reinvented.
  for (const q of [...NEW_CUSTOMER_QUESTIONS, ...RETURNING_CUSTOMER_QUESTIONS]) {
    for (const f of q.detailFields) {
      assert.ok((DETAIL_FIELDS as readonly string[]).includes(f),
        `${f} is not a known pre-existing intake field`);
    }
  }
});

test('QI08 quick-intake fields and detail fields do not overlap', () => {
  for (const f of QUICK_INTAKE_FIELDS) {
    assert.ok(!(DETAIL_FIELDS as readonly string[]).includes(f),
      `${f} cannot be both a quick answer and a detail field`);
  }
});
