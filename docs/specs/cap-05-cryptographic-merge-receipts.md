# CAP-05: Cryptographic HMAC-SHA256 Merge Receipts & Append-Only Audit Chain

- **Capability ID**: `CAP-05`
- **Governing Module**: `.agent/scripts/lib/receipt.mjs` (Ring 1)
- **Enforced Invariants**: `INV-01`, `INV-02`, `INV-03`

## 1. Inputs
- Passing `session.lastGate` measurement bound to clean `HEAD`, recorded `session.peerReview` approval, signing key (`SEALIT_RECEIPT_KEY` env var, fallback `SDLC_RECEIPT_KEY`, or gitignored `0600` `.agent/.receipt-key`), and `docs/AUDIT_CHAIN.jsonl`.

## 2. Domain Rules
1. **Tamper-Evident Linear Hash Chain**: Every record in `docs/AUDIT_CHAIN.jsonl` links `previousHash` to `GENESIS` (`"0".repeat(64)`) through deterministic canonical JSON SHA-256 (`currentHash`), written under lockfile protection (`withFileLock`).
2. **Stage 7 Receipt Invariants**: `issueGateReceipt` refuses dirty working trees, non-matching `lastGate.headSha`, stale `specHash` or `adrHashes`, missing/rejected reviews, below-threshold coverage/mutation measurements, or git-tracked `.agent/.receipt-key` / `.env` files.
3. **Multi-Topology Merge Verification**: `verifyGateReceipt` validates the entire hash chain from `GENESIS`, verifies timing-safe `crypto.timingSafeEqual` HMAC-SHA256 signatures, enforces branch match (`--branch`), and supports exact `HEAD`, post-receipt `AUDIT_CHAIN.jsonl`-only commits, Squash `treeSha` equivalence (`computeContentTreeSha`), and 2-parent clean `--no-ff` merges (`verifyTwoParentCleanMerge`).

## 3. Outputs & Acceptance Criteria
- `sealit review record --verdict approve` issues a signed `STAGE_7_GATE_RECEIPT_SIGNED` record in `docs/AUDIT_CHAIN.jsonl`.
- `sealit verify` exits `0` on valid chain + valid `HEAD` receipt and exits `1` on any tampering, key mismatch, or unverified commit.
