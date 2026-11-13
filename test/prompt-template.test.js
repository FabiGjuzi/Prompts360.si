// Prompt template helpers: extract, variables, fill, open-in links (no server needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPrompt, extractVariables, fill, openLinks, OPEN_LINK_MAX, MAX_VARIABLES } from '../src/prompt-template.js';

test('a post with a code block copies the first code block; a post without one copies everything', () => {
  assert.equal(extractPrompt('Use this:\n\n```\nAct as [role].\nBe brief.\n```\n\nSecond:\n```\nignored\n```'), 'Act as [role].\nBe brief.');
  assert.equal(extractPrompt('```text\nOnly this\n```'), 'Only this');
  assert.equal(extractPrompt('  Write about [topic].\r\n\r\nKeep it short.  '), 'Write about [topic].\n\nKeep it short.');
  assert.equal(extractPrompt('Act as a \\[job title\\] with snake\\_case \\*stars\\*'), 'Act as a [job title] with snake_case *stars*', 'editor escapes are removed outside code blocks');
  assert.equal(extractPrompt('```\nkeep \\[this\\] as typed\n```'), 'keep \\[this\\] as typed', 'code blocks are verbatim');
  assert.equal(extractPrompt(''), '');
  assert.equal(extractPrompt(null), '');
});

test('variables: [placeholder] and {{NAME}}, in order, without repeats; links, checkboxes, numbers and ellipses are not variables', () => {
  const p = 'Act as a [role] for {{AUDIENCE}}. Topic: [topic]. Again [topic] and [role]. See [docs](https://x.test). [1] [x] [ ] [...] [paste]';
  assert.deepEqual(extractVariables(p).map(v => v.token), ['[role]', '{{AUDIENCE}}', '[topic]', '[paste]']);
  assert.deepEqual(extractVariables('{{ my topic }}').map(v => [v.token, v.label]), [['{{ my topic }}', 'my topic']]);
  assert.deepEqual(extractVariables('no variables here'), []);
  assert.deepEqual(extractVariables(''), []);
  assert.equal(extractVariables(Array.from({ length: 30 }, (_, i) => `[item ${String.fromCharCode(97 + (i % 26))}${i}]`).join(' ')).length, MAX_VARIABLES, 'capped');
});

test('fill replaces every occurrence, skips empty values and cannot be used to inject new variables twice', () => {
  const p = 'Hi [name], [name]! Topic: {{TOPIC}}.';
  assert.equal(fill(p, { '[name]': 'Sam', '{{TOPIC}}': '' }), 'Hi Sam, Sam! Topic: {{TOPIC}}.');
  assert.equal(fill(p, {}), p);
  assert.equal(fill(p, { '[name]': 'x'.repeat(1000) }).length, p.length - '[name]'.length * 2 + 800, 'value capped at 400 characters each');
});

test('open links carry the prompt URL-encoded, and disappear when it is too long', () => {
  const l = openLinks('Summarise & compare "A" vs B?');
  assert.equal(l.chatgpt, 'https://chatgpt.com/?q=Summarise%20%26%20compare%20%22A%22%20vs%20B%3F');
  assert.equal(l.claude, 'https://claude.ai/new?q=Summarise%20%26%20compare%20%22A%22%20vs%20B%3F');
  assert.deepEqual(openLinks(''), {});
  assert.deepEqual(openLinks('x'.repeat(OPEN_LINK_MAX + 1)), {});
  assert.ok(openLinks('x'.repeat(OPEN_LINK_MAX)).chatgpt);
});
