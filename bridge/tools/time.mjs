export const spec = {
  type: 'function',
  function: {
    name: 'time',
    description: 'Get the current local date and time.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  }
};

export async function run() {
  const now = new Date();
  return {
    iso: now.toISOString(),
    local: now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
    timezone: 'America/Los_Angeles'
  };
}
