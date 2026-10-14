import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select';

function renderSelect(disabled: boolean) {
  return renderToString(h(Select, { disabled, value: '' },
    h(SelectTrigger, { className: 'picker', disabled }, h(SelectValue, { placeholder: 'Elegí una cuenta' })),
    h(SelectContent, {}, h(SelectItem, { value: 'account' }, 'Cuenta')),
  ));
}

test('select emits identical initial markup regardless of client disabled state', () => {
  const html = renderSelect(false);
  assert.equal(html, renderSelect(true));
  assert.match(html, /type="button"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Elegí una cuenta/);
  assert.doesNotMatch(html, /role="combobox"|role="listbox"/);
});

test('select keeps custom account labels in the server placeholder', () => {
  const html = renderToString(h(Select, { value: 'account' },
    h(SelectTrigger, {}, h(SelectValue, { placeholder: 'Elegí una cuenta' }, h('strong', {}, 'Cuenta seleccionada'))),
  ));
  assert.match(html, /<strong>Cuenta seleccionada<\/strong>/);
  assert.doesNotMatch(html, /Elegí una cuenta/);
});
