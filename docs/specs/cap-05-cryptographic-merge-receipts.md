# CAP-05: Cryptographic SSHSIG / HMAC-SHA256 Merge Receipts & Append-Only Audit Chain

- **Capability ID**: `CAP-05`
- **Governing Modules**: `.agent/scripts/lib/session.mjs` (Ring 1), `.agent/scripts/lib/receipt.mjs` (Ring 1)
- **Enforced Invariants**: `INV-01`, `INV-02`, `INV-03`

## 1. Inputs
- Passing `session.lastGate` measurement bound to clean `HEAD` (`headSha` and `treeSha`), recorded `session.peerReview` approval, signing credential (asymmetric OpenSSH key via `SEALIT_SIGNING_KEY` / `git config user.signingkey` when `.agent/allowed_signers` is configured, or shared `HMAC-SHA256` key via `SEALIT_RECEIPT_KEY` / `SDLC_RECEIPT_KEY` / gitignored `0600` `.agent/.receipt-key`), and `docs/AUDIT_CHAIN.jsonl`.

## 2. Domain Rules
1. **Tamper-Evident Linear Hash Chain**: Every record in `docs/AUDIT_CHAIN.jsonl` links `previousHash` to `GENESIS` (`"0".repeat(64)`) through deterministic canonical JSON SHA-256 (`currentHash`), written under `Atomics.wait`-backed lockfile protection (`withFileLock`).
2. **Stage 7 Receipt Invariants & Atomic `--commit` Seal (`ADR-028`)**: `issueGateReceipt` refuses dirty working trees, non-matching `lastGate.headSha` or `lastGate.treeSha`, stale `specHash` or `adrHashes`, missing/rejected reviews, below-threshold coverage/mutation measurements, or git-tracked `.agent/.receipt-key` / `.env` files. Passing `--commit` to `review record --verdict approve` or `receipt` atomically stages and commits `docs/AUDIT_CHAIN.jsonl` through the normal `pre-commit` hook, verifies the new `HEAD` receipt, and returns `prBody`.
3. **Dual-Mode Asymmetric `SSHSIG` & Multi-Topology Verification (`ADR-028`)**: `verifyGateReceipt` validates the entire hash chain from `GENESIS`, resolves `baseCommit`, and reads `baseCommit:.agent/allowed_signers` via `git cat-file`. When `baseCommit` defines `.agent/allowed_signers`, `verifyGateReceipt` enforces OpenSSH `SSHSIG` (`ssh-keygen -Y find-principals`/`verify`, shell-free) strictly against `baseCommit`'s allowed signers (blocking HMAC downgrade and PR-injected keys) and binds `payload.reviewer` to the verified principal; otherwise it verifies timing-safe `HMAC-SHA256` signatures for full backward compatibility. Both modes enforce branch match (`--branch`) and support exact `HEAD`, post-receipt `AUDIT_CHAIN.jsonl`-only commits, Squash `treeSha` equivalence (`computeContentTreeSha`), and 2-parent clean `--no-ff` merges (`verifyTwoParentCleanMerge`).

## 3. Outputs & Acceptance Criteria
- `sealit review record --verdict approve --commit` issues, commits, and verifies a signed `STAGE_7_GATE_RECEIPT_SIGNED` record in `docs/AUDIT_CHAIN.jsonl`.
- `sealit verify` exits `0` on valid chain + valid `HEAD` receipt and exits `1` on any tampering, key mismatch, HMAC downgrade, or unverified commit.
