'use strict';

const fs = require('node:fs');

const TOKEN_PATTERNS = [
  /sk-ant-api[0-9]{2}-[A-Za-z0-9\-]{20,}/i,
  /(ghp_|gho_|ghs_|ghu_|ghr_|github_pat_)/,
  /xox[bpasr]-[A-Za-z0-9\-]{10,}/,
  /AKIA[A-Z0-9]{16}/,
  /\b(?:dd_api_key|datadog_api_key|DD_API_KEY)[=:]["' ]*[a-f0-9]{32}\b/i,
  /BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY/,
];

const CANARY_PATTERNS = [
  /(?:curl|wget|\bnc\b|bash|sh\s+-c|eval|exec)\s+/i,
  />>?\s*\$GITHUB_OUTPUT/,
  />>?\s*\$GITHUB_ENV/,
];

function scanValue(value, patterns) {
  if (typeof value === 'string') return patterns.some(pattern => pattern.test(value));
  if (Array.isArray(value)) return value.some(item => scanValue(item, patterns));
  if (value && typeof value === 'object') {
    return Object.values(value).some(item => scanValue(item, patterns));
  }
  return false;
}

function hasToken(value) {
  return scanValue(value, TOKEN_PATTERNS);
}

function hasCanary(value) {
  return scanValue(value, CANARY_PATTERNS);
}

function singleLine(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function sanitizeSlack(value) {
  return singleLine(value)
    .replace(/<!channel>/g, '')
    .replace(/<!here>/g, '')
    .replace(/<!everyone>/g, '')
    .replace(/@channel/g, '')
    .replace(/@here/g, '')
    .replace(/@everyone/g, '')
    .trim();
}

function stripLinks(value) {
  return singleLine(value)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^|>]+\|([^>]+)>/g, '$1');
}

function sanitizeExplanation(value) {
  return sanitizeSlack(stripLinks(value)).slice(0, 150);
}

function parseClaudeText(text) {
  const result = {
    team: '',
    slack: '',
    confidence: '',
    explanation: '',
  };

  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.match(/^(TEAM|SLACK|CONFIDENCE|EXPLANATION):(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    result[key.toLowerCase()] = value.trim();
  }

  return result;
}

function extractTeamLabelsFromCodeowners(codeownersTexts, fallbackTeam) {
  const labels = new Set();
  const texts = Array.isArray(codeownersTexts) ? codeownersTexts : [codeownersTexts];
  const teamPattern = /@[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+)/g;

  for (const text of texts) {
    if (!text) continue;
    for (const match of String(text).matchAll(teamPattern)) {
      labels.add(`team/${match[1]}`);
    }
  }

  if (labels.size === 0 && fallbackTeam) {
    labels.add(`team/${fallbackTeam}`);
  }

  return labels;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slackMapContainsChannel(slackMapText, channel) {
  if (!channel || !/^#?[A-Za-z0-9_-]+$/.test(channel) || !slackMapText) {
    return false;
  }

  const candidates = new Set([channel]);
  if (channel.startsWith('#')) {
    candidates.add(channel.slice(1));
  } else {
    candidates.add(`#${channel}`);
  }

  for (const candidate of candidates) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(candidate)}(?=$|[^A-Za-z0-9_-])`);
    if (pattern.test(slackMapText)) return true;
  }
  return false;
}

function makeFallbackOutputs(fallbackChannel, explanation) {
  return {
    team: 'unknown',
    slack: fallbackChannel,
    confidence: 'LOW',
    explanation,
    issue_number: 'unknown',
    issue_title: 'unknown',
    issue_url: 'unknown',
  };
}

function buildTriageOutputs({
  claudeText,
  issueDetails,
  codeownersTexts = [],
  slackMapText = '',
  fallbackChannel = '',
  fallbackTeam = '',
}) {
  const fallbackSlack = singleLine(fallbackChannel);

  if (!claudeText || !issueDetails) {
    return makeFallbackOutputs(fallbackSlack, 'No AI output generated');
  }

  if (hasToken(claudeText) || hasCanary(claudeText) || hasToken(issueDetails)) {
    return makeFallbackOutputs(fallbackSlack, 'Sensitive information or anomalous output detected');
  }

  const parsed = parseClaudeText(claudeText);
  const allowedTeamLabels = extractTeamLabelsFromCodeowners(codeownersTexts, fallbackTeam);

  const teamLabel = `team/${parsed.team}`;
  const team = /^[A-Za-z0-9_-]+$/.test(parsed.team) && allowedTeamLabels.has(teamLabel)
    ? teamLabel
    : 'unknown';

  const slack = slackMapContainsChannel(slackMapText, parsed.slack)
    ? parsed.slack
    : fallbackSlack;

  const confidence = /^(HIGH|MEDIUM|LOW)$/.test(parsed.confidence.toUpperCase())
    ? parsed.confidence.toUpperCase()
    : 'LOW';

  return {
    team,
    slack,
    confidence,
    explanation: sanitizeExplanation(parsed.explanation),
    issue_number: singleLine(issueDetails.number ?? 'unknown'),
    issue_title: sanitizeSlack(issueDetails.title ?? 'unknown'),
    issue_url: singleLine(issueDetails.url ?? 'unknown'),
  };
}

function appendGithubOutputs(outputs, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) throw new Error('GITHUB_OUTPUT is not set');

  const lines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${singleLine(value)}`)
    .join('\n');

  fs.appendFileSync(outputPath, `${lines}\n`);
}

module.exports = {
  appendGithubOutputs,
  buildTriageOutputs,
  extractTeamLabelsFromCodeowners,
  hasCanary,
  hasToken,
  parseClaudeText,
  sanitizeExplanation,
  sanitizeSlack,
  slackMapContainsChannel,
};
