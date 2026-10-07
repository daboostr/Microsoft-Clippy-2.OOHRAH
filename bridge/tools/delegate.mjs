import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HANDOFF = path.join(os.homedir(), '.copilot', 'handoff');
const QUEUE = path.join(HANDOFF, 'queue');

export const spec = {
  type: 'function',
  function: {
    name: 'delegate',
    description: 'Hand a request off to the main Scout agent, which has full tooling (email, calendar, files, code, MSX/Dataverse, skills, multi-step research, browser, anything destructive). Call this for ANYTHING you cannot fully do yourself with your own small tool set, including launching a skill, starting a new chat/task, drafting or sending mail, reading the user\'s data, or any heavy or multi-step or destructive action. Do NOT answer such requests yourself.',
    parameters: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'The full user request, verbatim or lightly cleaned, for the agent to execute.' },
        summary: { type: 'string', description: 'A 3-6 word label of the task.' }
      },
      required: ['request'],
      additionalProperties: false
    }
  }
};

export async function run({ request, summary }) {
  try {
    fs.mkdirSync(QUEUE, { recursive: true });
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const item = {
      id,
      request: String(request || '').trim(),
      summary: String(summary || '').trim(),
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(QUEUE, id + '.json'), JSON.stringify(item, null, 2));
    return { queued: true, id, note: 'Handed to the main agent. It will work the task and report back out loud.' };
  } catch (e) {
    return { queued: false, error: e.message };
  }
}
