#!/usr/bin/env node
/**
 * MyDashRx Compliance Deployment Gate
 *
 * Scans all orgs for HIPAA + Michigan compliance violations.
 * Exits non-zero if any P0 violations are found, blocking deployment.
 *
 * Usage:
 *   npx tsx scripts/compliance-gate.ts
 *
 * In CI/CD:
 *   "predeploy": "npx tsx scripts/compliance-gate.ts"
 */
import 'dotenv/config';
import { runComplianceScan, isDeploymentBlocked, findingsSummary, type ComplianceFinding } from '../src/compliance/scanner.js';
import { client } from '../src/db/connection.js';

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   MYDASHRX COMPLIANCE DEPLOYMENT GATE   ║');
  console.log('╚══════════════════════════════════════════╝\n');

  let findings: ComplianceFinding[];
  try {
    console.log('Running compliance scan across all organizations...\n');
    findings = await runComplianceScan({ persistResults: false });
  } catch (err) {
    console.error('SCAN ERROR — could not complete compliance scan:');
    console.error(err instanceof Error ? err.message : err);
    console.error('\nDeployment blocked due to scan failure.\n');
    await client.end();
    process.exit(2);
  }

  const active = findings.filter(f => f.count > 0);
  const byCategory = (cat: string) => active.filter(f => f.category === cat);

  console.log('─── SCAN SUMMARY ───────────────────────────');
  if (!active.length) {
    console.log('No violations found across any organization.\n');
  } else {
    console.log(findingsSummary(findings));
    console.log();

    const hipaaFindings = byCategory('hipaa');
    if (hipaaFindings.length) {
      console.log('HIPAA Findings:');
      for (const f of hipaaFindings) {
        const marker = f.blocksDeployment ? '🔴' : f.severity === 'P1' ? '🟠' : '🟡';
        console.log(`  ${marker} [${f.severity}] ${f.checkName}`);
        console.log(`       ${f.description}`);
        console.log(`       Legal: ${f.legalRef}`);
      }
      console.log();
    }

    const miFindings = byCategory('michigan');
    if (miFindings.length) {
      console.log('Michigan Compliance Findings:');
      for (const f of miFindings) {
        const marker = f.blocksDeployment ? '🔴' : f.severity === 'P1' ? '🟠' : '🟡';
        console.log(`  ${marker} [${f.severity}] ${f.checkName}`);
        console.log(`       ${f.description}`);
        console.log(`       Legal: ${f.legalRef}`);
      }
      console.log();
    }
  }

  const blocked = isDeploymentBlocked(findings);
  const blocking = active.filter(f => f.blocksDeployment);

  if (blocked) {
    console.log('─── DEPLOYMENT BLOCKED ─────────────────────');
    console.log(`${blocking.length} critical violation(s) must be resolved before deployment:\n`);
    for (const f of blocking) {
      console.log(`  ❌ [${f.severity}] ${f.checkName}`);
      console.log(`     ${f.description}`);
      console.log(`     Fix: ${f.recommendation}`);
      console.log(`     Legal ref: ${f.legalRef}`);
      if (f.resourceIds.length) console.log(`     Affected IDs: ${f.resourceIds.slice(0, 5).join(', ')}${f.resourceIds.length > 5 ? ` (+${f.resourceIds.length - 5} more)` : ''}`);
      console.log();
    }
    await client.end();
    process.exit(1);
  }

  const p1Count = active.filter(f => f.severity === 'P1').length;
  if (p1Count > 0) {
    console.log(`⚠️  ${p1Count} P1 violation(s) detected — must be resolved within 3 cycles (not blocking this deploy).`);
    console.log();
  }

  console.log('✅ Compliance gate passed. Safe to deploy.\n');
  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Unhandled error in compliance gate:', err);
  await client.end().catch(() => {});
  process.exit(2);
});
