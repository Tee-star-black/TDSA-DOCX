import {exportWorkspace, verifyExport} from '../src/migration-export.js';

const [command, source, destination, ...extra] = process.argv.slice(2);
try {
  let report;
  if (command === 'export' && source && destination && !extra.length) report = exportWorkspace(source, destination);
  else if (command === 'verify' && source && !destination) report = verifyExport(source);
  else throw new Error('Use npm run migration:export -- source.sqlite new-export-directory, or npm run migration:verify -- export-directory');
  // Full ownership inventories remain in the private package, not terminal logs.
  console.log(JSON.stringify({verified: true, counts: report.counts, objects: report.objectCount, missingSourceContents: report.sourcesWithoutBytes.length, readyForProductionImport: false, blockers: report.blockers}, null, 2));
} catch (error) {
  console.error(error.code ? 'Export failed. Check workspace access, available disk space and the original encryption key.' : error.message);
  process.exitCode = 1;
}
