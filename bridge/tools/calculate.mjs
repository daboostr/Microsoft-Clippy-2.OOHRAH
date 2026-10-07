export const spec = {
  type: 'function',
  function: {
    name: 'calculate',
    description: 'Evaluate a basic arithmetic expression (+ - * / parentheses, decimals).',
    parameters: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'e.g. (3 + 4) * 2 / 5' } },
      required: ['expression'],
      additionalProperties: false
    }
  }
};

export async function run({ expression }) {
  const expr = String(expression || '');
  if (!/^[-+*/().\d\s]+$/.test(expr)) {
    return { error: 'Expression contains unsupported characters.' };
  }
  try {
    // Safe: input is restricted to digits and arithmetic operators above.
    const result = Function('"use strict"; return (' + expr + ');')();
    if (typeof result !== 'number' || !isFinite(result)) return { error: 'Invalid result.' };
    return { expression: expr, result };
  } catch (e) {
    return { error: 'Could not evaluate: ' + e.message };
  }
}
