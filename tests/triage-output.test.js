'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  appendGithubOutputs,
  buildTriageOutputs,
  extractTeamLabelsFromCodeowners,
  hasCanary,
  hasToken,
  parseClaudeText,
  sanitizeExplanation,
  sanitizeSlack,
  slackMapContainsChannel,
} = require('../src/triage-output.js');

const ISSUE = {
  number: 123,
  title: 'Agent flare fails',
  url: 'https://github.com/DataDog/datadog-agent/issues/123',
  body: 'flare command failed',
};

const CODEOWNERS = `
/pkg/flare @DataDog/agent-devx
/pkg/collector @DataDog/agent-platform
`;

const SLACK_MAP = `
agent-devx: "#agent-devx-ops"
agent-platform: "#agent-platform"
`;

function claudeText({
  team = 'agent-devx',
  slack = '#agent-devx-ops',
  confidence = 'HIGH',
  explanation = 'Flare ownership maps to agent-devx',
} = {}) {
  return [
    `TEAM:${team}`,
    `SLACK:${slack}`,
    `CONFIDENCE:${confidence}`,
    `EXPLANATION:${explanation}`,
  ].join('\n');
}

test('hasToken detects token-like secrets recursively', () => {
  assert.ok(hasToken('sk-ant-api03-' + 'a'.repeat(20)));
  assert.ok(hasToken({ body: 'ghp_' + 'a'.repeat(36) }));
  assert.ok(hasToken(['safe', { token: 'xoxb-' + 'a'.repeat(10) }]));
  assert.ok(hasToken('AKIA' + 'A'.repeat(16)));
  assert.ok(hasToken('DD_API_KEY=' + 'a'.repeat(32)));
  assert.ok(hasToken('-----BEGIN RSA PRIVATE KEY-----'));
  assert.equal(hasToken({ body: 'ordinary issue text' }), false);
});

test('hasCanary detects suspicious workflow and shell output recursively', () => {
  assert.ok(hasCanary('curl http://example.com'));
  assert.ok(hasCanary('sh -c "date"'));
  assert.ok(hasCanary('echo team=owned >> $GITHUB_OUTPUT'));
  assert.ok(hasCanary({ body: 'eval "$(payload)"' }));
  assert.equal(hasCanary('ordinary analysis text'), false);
});

test('parseClaudeText extracts fields and preserves colons in explanation', () => {
  assert.deepEqual(parseClaudeText(claudeText({
    explanation: 'Path owner: pkg/flare:agent-devx',
  })), {
    team: 'agent-devx',
    slack: '#agent-devx-ops',
    confidence: 'HIGH',
    explanation: 'Path owner: pkg/flare:agent-devx',
  });
});

test('extractTeamLabelsFromCodeowners builds labels from all CODEOWNERS files', () => {
  const labels = extractTeamLabelsFromCodeowners([
    '/a @DataDog/team-one',
    '/b @OtherOrg/team.two @DataDog/team_three',
  ], 'fallback-team');

  assert.deepEqual([...labels].sort(), [
    'team/team-one',
    'team/team.two',
    'team/team_three',
  ]);
});

test('extractTeamLabelsFromCodeowners uses fallback team when no CODEOWNERS teams exist', () => {
  assert.deepEqual([...extractTeamLabelsFromCodeowners('', 'agent-devx')], ['team/agent-devx']);
});

test('slackMapContainsChannel matches channels with or without leading hash', () => {
  assert.equal(slackMapContainsChannel(SLACK_MAP, '#agent-devx-ops'), true);
  assert.equal(slackMapContainsChannel(SLACK_MAP, 'agent-devx-ops'), true);
  assert.equal(slackMapContainsChannel(SLACK_MAP, '#missing'), false);
  assert.equal(slackMapContainsChannel(SLACK_MAP, 'agent'), false);
});

test('sanitizeSlack removes broadcast mentions', () => {
  assert.equal(
    sanitizeSlack('Notify <!channel> @here and <!everyone> about this'),
    'Notify   and  about this',
  );
});

test('sanitizeExplanation strips links, removes Slack broadcasts, and truncates', () => {
  const long = 'x'.repeat(200);
  const result = sanitizeExplanation(`[text](https://example.com) <https://x|slack> @channel ${long}`);
  assert.equal(result.startsWith('text slack'), true);
  assert.equal(result.includes('@channel'), false);
  assert.equal(result.length, 150);
});

test('buildTriageOutputs accepts valid Claude output', () => {
  assert.deepEqual(buildTriageOutputs({
    claudeText: claudeText(),
    issueDetails: ISSUE,
    codeownersTexts: [CODEOWNERS],
    slackMapText: SLACK_MAP,
    fallbackChannel: 'agent-devx-ops',
    fallbackTeam: 'agent-devx',
  }), {
    team: 'team/agent-devx',
    slack: '#agent-devx-ops',
    confidence: 'HIGH',
    explanation: 'Flare ownership maps to agent-devx',
    issue_number: '123',
    issue_title: 'Agent flare fails',
    issue_url: 'https://github.com/DataDog/datadog-agent/issues/123',
  });
});

test('buildTriageOutputs rejects teams not present in CODEOWNERS', () => {
  const outputs = buildTriageOutputs({
    claudeText: claudeText({ team: 'other-team' }),
    issueDetails: ISSUE,
    codeownersTexts: [CODEOWNERS],
    slackMapText: SLACK_MAP,
    fallbackChannel: 'agent-devx-ops',
    fallbackTeam: 'agent-devx',
  });

  assert.equal(outputs.team, 'unknown');
});

test('buildTriageOutputs falls back for invalid Slack and confidence values', () => {
  const outputs = buildTriageOutputs({
    claudeText: claudeText({ slack: '#not-in-map', confidence: 'maybe' }),
    issueDetails: ISSUE,
    codeownersTexts: [CODEOWNERS],
    slackMapText: SLACK_MAP,
    fallbackChannel: 'agent-devx-ops',
    fallbackTeam: 'agent-devx',
  });

  assert.equal(outputs.slack, 'agent-devx-ops');
  assert.equal(outputs.confidence, 'LOW');
});

test('buildTriageOutputs returns safe fallback when artifacts are missing', () => {
  assert.deepEqual(buildTriageOutputs({
    claudeText: '',
    issueDetails: ISSUE,
    fallbackChannel: 'agent-devx-ops',
  }), {
    team: 'unknown',
    slack: 'agent-devx-ops',
    confidence: 'LOW',
    explanation: 'No AI output generated',
    issue_number: 'unknown',
    issue_title: 'unknown',
    issue_url: 'unknown',
  });
});

test('buildTriageOutputs returns safe fallback on sensitive content', () => {
  const outputs = buildTriageOutputs({
    claudeText: claudeText({ explanation: 'echo team=owned >> $GITHUB_OUTPUT' }),
    issueDetails: ISSUE,
    codeownersTexts: [CODEOWNERS],
    slackMapText: SLACK_MAP,
    fallbackChannel: 'agent-devx-ops',
  });

  assert.equal(outputs.team, 'unknown');
  assert.equal(outputs.confidence, 'LOW');
  assert.equal(outputs.explanation, 'Sensitive information or anomalous output detected');
  assert.equal(outputs.issue_number, 'unknown');
});

test('buildTriageOutputs sanitizes issue title before writing outputs', () => {
  const outputs = buildTriageOutputs({
    claudeText: claudeText(),
    issueDetails: { ...ISSUE, title: 'Please notify <!channel> @everyone' },
    codeownersTexts: [CODEOWNERS],
    slackMapText: SLACK_MAP,
    fallbackChannel: 'agent-devx-ops',
  });

  assert.equal(outputs.issue_title, 'Please notify');
});

test('appendGithubOutputs writes single-line key/value outputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-output-'));
  const outputPath = path.join(dir, 'github-output');

  appendGithubOutputs({
    team: 'team/agent-devx',
    explanation: 'line one\nline two',
  }, outputPath);

  assert.equal(
    fs.readFileSync(outputPath, 'utf8'),
    'team=team/agent-devx\nexplanation=line one line two\n',
  );
});
