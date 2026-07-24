# Architecture proposal workflow

Architecture work starts with an Issue and moves through one mutually exclusive status label:

| Stage | Labels | Automated behavior |
|---|---|---|
| Proposal submitted | `architecture proposal` + `under review` | The Issue remains open for maintainer review. |
| Proposal declined | `architecture proposal` + `declined` | The Issue is closed. |
| Proposal approved | `architecture proposal` + `in-progress` | The Issue remains open and implementation may begin. |
| Implementation merged | `architecture proposal` + `done` | The linked Issue is closed automatically. |

Maintainers make the review decision by adding either `in-progress` or `declined`. Proposal authors
cannot approve, decline, or complete their own proposal. The lifecycle workflow removes conflicting
status labels and updates the Issue state.

Implementation pull requests must retain this exact field in the PR body:

```text
- **Proposal Issue:** #123
```

The linked Issue must already have `architecture proposal` + `in-progress`. The metadata-only
`pull_request_target` workflow never checks out or executes code from a contributor fork. When the
PR is merged, the workflow labels the proposal `done`, removes `in-progress`, comments with the
merged PR number, and closes the Issue.

Closing an architecture proposal before completion automatically marks it `declined`. Closing an
implementation PR without merging leaves the proposal `in-progress` so another implementation can
continue the work.

Maintainers can manually run the workflow once after installation. This bootstraps existing open
architecture proposals to `under review` and existing closed proposals to `declined` when they do
not already carry a lifecycle status.
