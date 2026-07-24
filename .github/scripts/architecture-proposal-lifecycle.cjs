"use strict";

const LABEL_DEFINITIONS = Object.freeze({
  "architecture proposal": {
    color: "983573",
    description: "A proposed model architecture or architecture modification.",
  },
  "under review": {
    color: "5DBBAE",
    description: "The architecture proposal is waiting for maintainer review.",
  },
  "in-progress": {
    color: "4D9D59",
    description: "The proposal is approved and implementation is in progress.",
  },
  declined: {
    color: "A9CA8D",
    description: "The architecture proposal was declined or deferred.",
  },
  done: {
    color: "667A43",
    description: "The implementation PR was merged and the proposal is complete.",
  },
  "architecture implementation": {
    color: "BFDADC",
    description: "A pull request implementing an approved architecture proposal.",
  },
});

const PROPOSAL_LABEL = "architecture proposal";
const PR_LABEL = "architecture implementation";
const STATUS_LABELS = Object.freeze(["under review", "in-progress", "declined", "done"]);

function labelNames(labels) {
  return (Array.isArray(labels) ? labels : []).map((label) => {
    return String(typeof label === "string" ? label : label?.name ?? "").trim().toLowerCase();
  }).filter(Boolean);
}

function hasProposalIdentity(issue) {
  const labels = new Set(labelNames(issue?.labels));
  return labels.has(PROPOSAL_LABEL) || /^\s*\[ARCH-PROP\]/i.test(String(issue?.title ?? ""));
}

function proposalStatus(labels) {
  const names = new Set(labelNames(labels));
  return STATUS_LABELS.find((label) => names.has(label)) ?? null;
}

function normalizedLabelChange(labels, targetStatus) {
  const names = new Set(labelNames(labels));
  const add = [PROPOSAL_LABEL, targetStatus].filter((label) => label && !names.has(label));
  const remove = STATUS_LABELS.filter((label) => label !== targetStatus && names.has(label));
  return { add, remove };
}

function targetStatusForIssueEvent(payload) {
  const issue = payload?.issue;
  if (!hasProposalIdentity(issue)) return null;
  const action = payload?.action;
  const current = proposalStatus(issue?.labels);
  if (action === "opened" || action === "reopened") return "under review";
  if (action === "labeled") {
    const added = String(payload?.label?.name ?? "").trim().toLowerCase();
    if (STATUS_LABELS.includes(added)) return added;
    if (added === PROPOSAL_LABEL && !current) return "under review";
  }
  if (action === "closed" && !["declined", "done"].includes(current)) return "declined";
  return null;
}

function isSelfReview(payload, targetStatus, actor) {
  if (payload?.action !== "labeled" || !["in-progress", "declined", "done"].includes(targetStatus)) return false;
  return String(payload?.issue?.user?.login ?? "").toLowerCase() === String(actor ?? "").toLowerCase();
}

function extractProposalIssueNumber(body) {
  const text = String(body ?? "");
  const field = text.match(/^\s*[-*]?\s*\*\*Proposal Issue:\*\*\s*(?:https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/)?#?(\d+)\s*$/im);
  if (field) return Number(field[1]);
  const urlField = text.match(/^\s*[-*]?\s*\*\*Proposal Issue:\*\*\s*https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)\s*$/im);
  return urlField ? Number(urlField[1]) : null;
}

function proposalValidation(issue) {
  const labels = new Set(labelNames(issue?.labels));
  const problems = [];
  if (!labels.has(PROPOSAL_LABEL)) problems.push(`linked Issue is missing \`${PROPOSAL_LABEL}\``);
  if (!labels.has("in-progress")) problems.push("linked Issue has not been approved with `in-progress`");
  return problems;
}

async function ensureLabels(github, owner, repo) {
  for (const [name, definition] of Object.entries(LABEL_DEFINITIONS)) {
    try {
      await github.rest.issues.getLabel({ owner, repo, name });
    } catch (error) {
      if (error.status !== 404) throw error;
      try {
        await github.rest.issues.createLabel({ owner, repo, name, ...definition });
      } catch (creationError) {
        if (creationError.status !== 422) throw creationError;
      }
    }
  }
}

async function removeLabel(github, owner, repo, issueNumber, name) {
  try {
    await github.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name });
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}

async function transitionIssue(github, owner, repo, issue, targetStatus) {
  const issueNumber = issue.number;
  const change = normalizedLabelChange(issue.labels, targetStatus);
  for (const name of change.remove) await removeLabel(github, owner, repo, issueNumber, name);
  if (change.add.length) {
    await github.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: change.add });
  }
  const state = ["declined", "done"].includes(targetStatus) ? "closed" : "open";
  if (issue.state !== state) {
    await github.rest.issues.update({ owner, repo, issue_number: issueNumber, state });
  }
}

async function commentOnce(github, owner, repo, issueNumber, marker, body) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  if (comments.some((comment) => String(comment.body ?? "").includes(marker))) return;
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `${marker}\n${body}`,
  });
}

function statusMessage(status) {
  const messages = {
    "under review": "This architecture proposal is awaiting maintainer review. Please do not start a large implementation until it is approved.",
    "in-progress": "This proposal is approved for implementation. Fork the repository, create a focused branch, and link this Issue from the PR template.",
    declined: "This proposal was declined or deferred and has been closed. The discussion remains available as project history.",
    done: "A linked implementation PR was merged. This proposal is complete and has been closed.",
  };
  return messages[status];
}

async function handleIssueEvent({ github, context, core }) {
  const payload = context.payload;
  const targetStatus = targetStatusForIssueEvent(payload);
  if (!targetStatus) return;
  const { owner, repo } = context.repo;
  if (isSelfReview(payload, targetStatus, context.actor)) {
    await transitionIssue(github, owner, repo, payload.issue, "under review");
    await commentOnce(
      github,
      owner,
      repo,
      payload.issue.number,
      `<!-- architecture-proposal-lifecycle:self-review:${context.actor} -->`,
      "Proposal authors cannot approve, decline, or complete their own proposal. A different maintainer must record the review decision.",
    );
    core.setFailed("proposal authors cannot review their own proposal");
    return;
  }
  await transitionIssue(github, owner, repo, payload.issue, targetStatus);
  const marker = `<!-- architecture-proposal-lifecycle:status:${targetStatus} -->`;
  await commentOnce(github, owner, repo, payload.issue.number, marker, statusMessage(targetStatus));
}

async function failPullRequest({ github, context, core }, message) {
  const { owner, repo } = context.repo;
  const marker = "<!-- architecture-proposal-lifecycle:invalid-link -->";
  await commentOnce(
    github,
    owner,
    repo,
    context.payload.pull_request.number,
    marker,
    `Architecture proposal lifecycle check failed: ${message}.`,
  );
  core.setFailed(message);
}

async function handlePullRequestEvent({ github, context, core }) {
  const pullRequest = context.payload.pull_request;
  const body = String(pullRequest?.body ?? "");
  const mentionsProposalField = /Proposal Issue:/i.test(body);
  const issueNumber = extractProposalIssueNumber(body);
  if (!mentionsProposalField && !issueNumber) return;
  if (!issueNumber) {
    await failPullRequest({ github, context, core }, "fill `Proposal Issue: #<number>` in the PR body");
    return;
  }

  const { owner, repo } = context.repo;
  let issue;
  try {
    issue = (await github.rest.issues.get({ owner, repo, issue_number: issueNumber })).data;
  } catch (error) {
    if (error.status === 404) {
      await failPullRequest({ github, context, core }, `Proposal Issue #${issueNumber} does not exist`);
      return;
    }
    throw error;
  }

  const merged = context.payload.action === "closed" && Boolean(pullRequest.merged);
  const problems = proposalValidation(issue);
  if (merged) {
    if (!labelNames(issue.labels).includes(PROPOSAL_LABEL)) {
      await failPullRequest({ github, context, core }, `Issue #${issueNumber} is not an architecture proposal`);
      return;
    }
    await transitionIssue(github, owner, repo, issue, "done");
    await commentOnce(
      github,
      owner,
      repo,
      issueNumber,
      `<!-- architecture-proposal-lifecycle:merged-pr:${pullRequest.number} -->`,
      `Implementation PR #${pullRequest.number} was merged. The proposal is now \`done\`.`,
    );
    return;
  }

  if (problems.length) {
    await failPullRequest({ github, context, core }, problems.join("; "));
    return;
  }

  if (context.payload.action !== "closed") {
    await github.rest.issues.addLabels({ owner, repo, issue_number: pullRequest.number, labels: [PR_LABEL] });
    await commentOnce(
      github,
      owner,
      repo,
      issueNumber,
      `<!-- architecture-proposal-lifecycle:implementation-pr:${pullRequest.number} -->`,
      `Implementation PR #${pullRequest.number} is linked to this approved proposal.`,
    );
  } else {
    await commentOnce(
      github,
      owner,
      repo,
      issueNumber,
      `<!-- architecture-proposal-lifecycle:closed-pr:${pullRequest.number} -->`,
      `Implementation PR #${pullRequest.number} was closed without merging. The proposal remains \`in-progress\`.`,
    );
  }
}

async function bootstrapExistingProposals(github, owner, repo) {
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    labels: PROPOSAL_LABEL,
    per_page: 100,
  });
  for (const issue of issues) {
    if (issue.pull_request || proposalStatus(issue.labels)) continue;
    await transitionIssue(github, owner, repo, issue, issue.state === "closed" ? "declined" : "under review");
  }
}

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  await ensureLabels(github, owner, repo);
  if (context.eventName === "workflow_dispatch") return bootstrapExistingProposals(github, owner, repo);
  if (context.eventName === "issues") return handleIssueEvent({ github, context, core });
  if (context.eventName === "pull_request_target") return handlePullRequestEvent({ github, context, core });
}

module.exports = {
  LABEL_DEFINITIONS,
  PROPOSAL_LABEL,
  STATUS_LABELS,
  extractProposalIssueNumber,
  hasProposalIdentity,
  isSelfReview,
  labelNames,
  normalizedLabelChange,
  proposalStatus,
  proposalValidation,
  run,
  targetStatusForIssueEvent,
};
