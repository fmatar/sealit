/**
 * Quality Gate Facade (Slim Barrel)
 * Re-exports cohesive Ring 2 modules while preserving full public API compatibility.
 */
export {
  validateConfigFile,
  runDoctor,
  installCIWorkflow,
  inspectCIWorkflows,
  detectStackInDir,
  discoverModules,
  matchFilesToModules,
  generateConfig,
  printPreview
} from './doctor-ci.mjs';

export {
  generateRegressionProof,
  monitorCanaryHealthAndWatchdog,
  auditSecurity
} from './security-audit.mjs';

export {
  scaffoldReproductionTest,
  assessRisk,
  VALID_LANES,
  LANE_RANK,
  triageChange,
  generatePRSummary,
  findAffectedTests,
  findAffectededTests,
  resolveAdHocTargets,
  generateReviewPlan,
  auditSkills
} from './triage-review.mjs';

export {
  buildSingleTestArgv,
  buildSingleTestCommand,
  parseCoverageReport,
  parseMutationReport,
  runFlakeCheck,
  suggestMutationStrengthening
} from './coverage-mutation.mjs';

export { exportAgentRules } from './installer.mjs';
