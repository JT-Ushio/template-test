"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const lifecycle = require("./architecture-proposal-lifecycle.cjs");

function issue(labels = [], state = "open") {
  return { number: 13, title: "[ARCH-PROP] Example", state, labels: labels.map((name) => ({ name })) };
}

test("proposal Issue events map to the documented lifecycle", () => {
  assert.equal(lifecycle.targetStatusForIssueEvent({ action: "opened", issue: issue() }), "under review");
  assert.equal(lifecycle.targetStatusForIssueEvent({
    action: "labeled",
    issue: issue(["architecture proposal", "under review", "in-progress"]),
    label: { name: "in-progress" },
  }), "in-progress");
  assert.equal(lifecycle.targetStatusForIssueEvent({
    action: "closed",
    issue: issue(["architecture proposal", "under review"], "closed"),
  }), "declined");
  assert.equal(lifecycle.targetStatusForIssueEvent({
    action: "closed",
    issue: issue(["architecture proposal", "done"], "closed"),
  }), null);
});

test("status transitions keep proposal identity and exactly one status", () => {
  assert.deepEqual(
    lifecycle.normalizedLabelChange(["architecture proposal", "under review"], "in-progress"),
    { add: ["in-progress"], remove: ["under review"] },
  );
  assert.deepEqual(
    lifecycle.normalizedLabelChange([], "under review"),
    { add: ["architecture proposal", "under review"], remove: [] },
  );
});

test("proposal authors cannot record their own review decision", () => {
  const payload = {
    action: "labeled",
    issue: { ...issue(["architecture proposal", "in-progress"]), user: { login: "author" } },
  };
  assert.equal(lifecycle.isSelfReview(payload, "in-progress", "author"), true);
  assert.equal(lifecycle.isSelfReview(payload, "in-progress", "reviewer"), false);
  assert.equal(lifecycle.isSelfReview(payload, "under review", "author"), false);
});

test("PR template Proposal Issue field accepts shorthand and URLs", () => {
  assert.equal(lifecycle.extractProposalIssueNumber("- **Proposal Issue:** #15"), 15);
  assert.equal(
    lifecycle.extractProposalIssueNumber("- **Proposal Issue:** https://github.com/JT-Ushio/template-test/issues/16"),
    16,
  );
  assert.equal(lifecycle.extractProposalIssueNumber("- **Proposal Issue:** #"), null);
});

test("implementation PR requires an approved architecture proposal", () => {
  assert.deepEqual(lifecycle.proposalValidation(issue(["architecture proposal", "in-progress"])), []);
  assert.deepEqual(lifecycle.proposalValidation(issue(["architecture proposal", "under review"])), [
    "linked Issue has not been approved with `in-progress`",
  ]);
  assert.deepEqual(lifecycle.proposalValidation(issue([])), [
    "linked Issue is missing `architecture proposal`",
    "linked Issue has not been approved with `in-progress`",
  ]);
});
