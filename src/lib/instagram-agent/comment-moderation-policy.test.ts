import { expect, it } from 'vitest';
import { shouldHideComment, keepObjectionPublic } from './comment-moderation-policy';

it('keeps Revitaly criticism public without blocking private order support or other merchants', () => {
  const ws='234604a9-909b-4e50-952b-acde4a85593a';
  expect(keepObjectionPublic(ws,true,false)).toBe(true);
  expect(keepObjectionPublic(ws,true,true)).toBe(false);
  expect(keepObjectionPublic(ws,false,false)).toBe(false);
  expect(keepObjectionPublic('other',true,false)).toBe(false);
});
it('answers Revitaly objections while keeping spam and other accounts unchanged', () => {
  const ws = '234604a9-909b-4e50-952b-acde4a85593a';
  expect(shouldHideComment(ws, false, true)).toBe(false);
  expect(shouldHideComment(ws, true, true)).toBe(false);
  expect(shouldHideComment(ws, true, false)).toBe(true);
  expect(shouldHideComment('another', false, true)).toBe(true);
  expect(shouldHideComment('another', true, false)).toBe(true);
});
