/**
 * The OpenAPI contract (success criterion 2) on a scratch database. The
 * suite itself is in `contract-suite.ts`, shared with the backup and
 * restore test.
 */
import { describe } from 'vitest';
import { describeContract } from './contract-suite.js';
import { createTestContext, databaseUrl } from './test/harness.js';

describe.skipIf(!databaseUrl)('contract', () => {
  describeContract('OpenAPI contract', () => createTestContext());
});
