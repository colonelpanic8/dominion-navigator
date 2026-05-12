# Dominion Card Data Audit Notes

`dominion-card-shaped-objects.json` is the single machine-readable card data artifact for this project.

It contains:

- Raw card-shaped objects extracted from the Dominion Online client.
- `trackerAudit`, a generated audit layer for card-location tracking work.
- `trackerAudit.behaviorReview`, a judgment pass over the tracker candidates.

The audit started from 952 extracted card-shaped objects. The tracker candidate pass flagged 806 objects with text or type patterns relevant to card ownership, card movement, location knowledge, or missing extracted text.

Those 806 candidates were then read in batches and classified into:

- `must-check`: likely needs explicit in-game verification for the tracker.
- `watch`: probably covered by generic card-move tracking, but worth regression awareness.
- `normal`: no special tracker behavior identified beyond ordinary draw, economy, gain, trash, or discard handling.

The current behavior-review shortlist is stored at:

```text
trackerAudit.behaviorReview.behaviorCheckKeys
```

Useful lookup fields:

- `trackerAudit.behaviorReview.reviewByCardKey`
- `trackerAudit.behaviorReview.behaviorReviewKeysByReason`
- `trackerAudit.auditByCardKey`
- `trackerAudit.candidateAuditByCardKey`

The audit generator is `scripts/audit-card-tracker-candidates.mjs`. By default it rewrites `data/dominion-card-shaped-objects.json` in place, keeping this as a single data artifact.
