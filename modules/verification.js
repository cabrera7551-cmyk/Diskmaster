/**
 * Verificación post-operación.
 */

const fs = require('fs');
const path = require('path');
const { verifyFolderRedirect } = require('../services/folderRedirectService');
const { pathExists } = require('../utils/safety');

async function verifyMoveResults(results) {
  const checks = [];

  for (const { item, result, destination } of results) {
    const destExists = pathExists(destination);
    const sourceGone = !pathExists(item.path);

    checks.push({
      name: item.name,
      source: item.path,
      destination,
      destExists,
      sourceGone,
      success: result.success && destExists,
      error: result.error || null
    });
  }

  const passed = checks.filter((c) => c.success).length;
  return {
    checks,
    passed,
    failed: checks.length - passed,
    allPassed: passed === checks.length
  };
}

async function verifyRedirects(redirectResults) {
  const checks = [];

  for (const redirect of redirectResults || []) {
    const key = redirect.folderKey || redirect.key;
    const newPath = redirect.newPath;
    const verification = await verifyFolderRedirect(key, newPath);
    const folderExists = pathExists(newPath);

    checks.push({
      folder: redirect.label || key,
      expected: newPath,
      current: verification.current,
      verified: verification.verified,
      folderExists,
      success: verification.verified && folderExists
    });
  }

  return {
    checks,
    allPassed: checks.every((c) => c.success)
  };
}

async function runFullVerification(moveResults, redirectResults) {
  const moveVerification = moveResults?.results
    ? await verifyMoveResults(moveResults.results)
    : { checks: [], passed: 0, failed: 0, allPassed: true };

  const redirectVerification = redirectResults?.length
    ? await verifyRedirects(redirectResults)
    : { checks: [], allPassed: true };

  return {
    move: moveVerification,
    redirects: redirectVerification,
    allPassed: moveVerification.allPassed && redirectVerification.allPassed
  };
}

module.exports = { verifyMoveResults, verifyRedirects, runFullVerification };
