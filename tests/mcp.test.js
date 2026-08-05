// End-to-end test of the MCP boot: spawn mcp-server.js and speak real JSON-RPC
// over stdio — initialize, tools/list, then a tools/call of trace_origin with a
// non-Facebook URL (which returns supported:false BEFORE any network, store
// write, or AI call, so the test runs offline and leaves no data behind).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function mcpSession(messages, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'mcp-server.js')], { cwd: ROOT });
    const replies = [];
    const wantedIds = new Set(messages.filter((m) => m.id !== undefined).map((m) => m.id));
    let buf = '';

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP session timed out; got ${replies.length}/${wantedIds.size} replies`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line); // anything non-JSON on stdout is a protocol bug — fail loudly
        if (msg.id !== undefined) {
          replies.push(msg);
          wantedIds.delete(msg.id);
          if (wantedIds.size === 0) {
            clearTimeout(timer);
            child.kill();
            resolve(replies);
          }
        }
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });

    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
  });
}

test('MCP boot answers initialize, lists both tools, and runs trace_origin', async () => {
  const replies = await mcpSession([
    {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-test', version: '0.0.0' } },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'trace_origin', arguments: { url: 'https://example.com/some-post' } },
    },
  ]);

  const byId = Object.fromEntries(replies.map((r) => [r.id, r]));

  // initialize
  assert.equal(byId[1].result.serverInfo.name, 'grounded-verifier');

  // tools/list — exactly the curated pair, each with a schema and annotations
  const tools = byId[2].result.tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ['trace_origin', 'verify_claim']);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
  }

  // tools/call — the real handler ran and answered honestly about a non-FB URL
  assert.notEqual(byId[3].result.isError, true);
  const payload = JSON.parse(byId[3].result.content[0].text);
  assert.equal(payload.ok, true);
  assert.equal(payload.platform, 'other');
  assert.equal(payload.supported, false);
});
