'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const WORKFLOW = path.join(__dirname, '../.github/workflows/issue-triage.yml');
const TRIAGE_OUTPUT_SRC = path.join(__dirname, '../src/triage-output.js');

function readWorkflow() {
  return fs.readFileSync(WORKFLOW, 'utf8');
}

function extractHeredoc(yaml, startMarker, endMarker) {
  const lines = yaml.split('\n');
  const result = [];
  let capturing = false;
  let indent = 0;

  for (const line of lines) {
    if (!capturing && line.includes(startMarker)) {
      capturing = true;
      indent = line.search(/\S/);
      continue;
    }
    if (capturing) {
      const trimmed = line.trimEnd();
      if (trimmed === ' '.repeat(indent) + endMarker) {
        capturing = false;
        continue;
      }
      result.push(line.startsWith(' '.repeat(indent)) ? line.slice(indent) : line);
    }
  }

  return result.join('\n');
}

function extractClaudeJsonSchema(yaml) {
  const schemaLine = yaml
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith('--json-schema '));

  assert.ok(schemaLine, 'Claude json schema argument must be present');

  const raw = schemaLine.slice('--json-schema '.length);
  assert.ok(raw.startsWith("'") && raw.endsWith("'"), 'schema should be shell single-quoted');
  return raw.slice(1, -1);
}

function collectOpenAIViolations(schema, schemaPath = '') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type === 'object' && schema.properties) {
    const propKeys = Object.keys(schema.properties);
    const required = Array.isArray(schema.required) ? schema.required : [];
    const missing = propKeys.filter(key => !required.includes(key));
    if (missing.length > 0) {
      errors.push(`${schemaPath || '(root)'}: properties [${missing.join(', ')}] not in required`);
    }
    for (const [key, value] of Object.entries(schema.properties)) {
      errors.push(...collectOpenAIViolations(value, `${schemaPath}.properties.${key}`));
    }
  }

  if (schema.items) errors.push(...collectOpenAIViolations(schema.items, `${schemaPath}.items`));
  if (schema.anyOf) {
    schema.anyOf.forEach((item, index) => {
      errors.push(...collectOpenAIViolations(item, `${schemaPath}.anyOf[${index}]`));
    });
  }
  if (schema.oneOf) {
    schema.oneOf.forEach((item, index) => {
      errors.push(...collectOpenAIViolations(item, `${schemaPath}.oneOf[${index}]`));
    });
  }
  if (schema.allOf) {
    schema.allOf.forEach((item, index) => {
      errors.push(...collectOpenAIViolations(item, `${schemaPath}.allOf[${index}]`));
    });
  }

  return errors;
}

function normalise(value) {
  return value.split('\n').map(line => line.trimEnd()).join('\n').trim();
}

test('Claude structured output schema is valid JSON', () => {
  const schema = extractClaudeJsonSchema(readWorkflow());
  JSON.parse(schema);
});

test('Claude structured output schema has all properties required', () => {
  const schema = JSON.parse(extractClaudeJsonSchema(readWorkflow()));
  assert.deepEqual(collectOpenAIViolations(schema), []);
});

test('Claude structured output schema stays closed and matches post parser fields', () => {
  const schema = JSON.parse(extractClaudeJsonSchema(readWorkflow()));

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties).sort(), [
    'confidence',
    'explanation',
    'slack',
    'team',
  ]);
});

test('src/triage-output.js matches inline workflow copy', () => {
  const yaml = readWorkflow();
  const inlined = extractHeredoc(yaml, "cat > _triage/scripts/triage-output.js << 'SCRIPT'", 'SCRIPT');
  const sourceFile = fs.readFileSync(TRIAGE_OUTPUT_SRC, 'utf8');

  const a = normalise(inlined);
  const b = normalise(sourceFile);

  if (a !== b) {
    const aLines = a.split('\n');
    const bLines = b.split('\n');
    const maxLen = Math.max(aLines.length, bLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (aLines[i] !== bLines[i]) {
        assert.fail(
          `src/triage-output.js and the inline YAML version diverged at line ${i + 1}:\n` +
          `  YAML: ${JSON.stringify(aLines[i])}\n` +
          `   src: ${JSON.stringify(bLines[i])}`,
        );
      }
    }
  }
});

test('workflow keeps the LLM step read-only without broad non-writer override', () => {
  const yaml = readWorkflow();

  assert.match(yaml, /uses: anthropics\/claude-code-base-action@[a-f0-9]{40} # .*Claude Code v[0-9]+\.[0-9]+\.[0-9]+/);
  assert.doesNotMatch(yaml, /allowed_non_write_users/);
  assert.doesNotMatch(yaml, /github_token:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  assert.match(yaml, /--allowedTools "Read,Glob,Grep"/);
  assert.match(yaml, /--permission-mode dontAsk/);
});
