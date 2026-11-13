// validate.test.js — username, password and id rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { usernameProblem, passwordProblem, intId } from '../src/validate.js';

test('a normal username passes', () => {
  for (const ok of ['abc', 'Ada_Lovelace', 'grace-h', 'a'.repeat(20), 'user123']) assert.equal(usernameProblem(ok), null, ok);
});

test('usernames outside 3–20 letters, digits, _ and - fail', () => {
  for (const bad of ['', 'ab', 'a'.repeat(21), 'has space', 'dot.name', 'émile', 'a/b', '<b>x</b>']) {
    assert.match(usernameProblem(bad), /3–20 characters/, JSON.stringify(bad));
  }
});

test('reserved usernames fail, in any letter case', () => {
  for (const bad of ['admin', 'Admin', 'ROOT', 'Support', 'moderator', 'anonymous']) {
    assert.equal(usernameProblem(bad), 'That username is reserved.', bad);
  }
});

test('a good password passes', () => {
  assert.equal(passwordProblem('Correct1Horse', 'Correct1Horse', 'ada'), null);
});

test('each password rule reports its own message', () => {
  assert.match(passwordProblem('Short1', 'Short1'), /at least 12/);
  assert.match(passwordProblem('A1' + 'x'.repeat(127), 'A1' + 'x'.repeat(127)), /at most 128/);
  assert.match(passwordProblem('nouppercase123', 'nouppercase123'), /uppercase/);
  assert.match(passwordProblem('NoDigitsHereAtAll', 'NoDigitsHereAtAll'), /number/);
  assert.match(passwordProblem('Correct1Horse', 'Correct1Horsx'), /don’t match/);
  assert.match(passwordProblem('Contains-Ada-1234', 'Contains-Ada-1234', 'ADA'), /username/);
});

test('exactly 12 and exactly 128 characters are allowed', () => {
  assert.equal(passwordProblem('Abcdefghij1k', 'Abcdefghij1k'), null);
  const long = 'A1' + 'x'.repeat(126);
  assert.equal(passwordProblem(long, long), null);
});

test('intId accepts 1 to 15 digits and nothing else', () => {
  assert.equal(intId('42'), 42);
  assert.equal(intId('007'), 7);
  assert.equal(intId('123456789012345'), 123456789012345);
  for (const bad of ['', '-1', '1.5', '1e3', ' 1', '1234567890123456', 'abc', 42, null, undefined]) {
    assert.equal(intId(bad), null, JSON.stringify(bad));
  }
});
