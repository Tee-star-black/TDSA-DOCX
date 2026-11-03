// Pure predicates for filtering rows already authorized and returned by the hub API.
// Never use these predicates as an authorization or data-isolation mechanism.
export function matchesAdvanced(row, filters = {}, principal = '') {
  const d = row.dataset || {};
  const type = (row.querySelector?.('.file-icon')?.textContent || '').trim().toUpperCase();
  if (filters.type && type !== filters.type) return false;
  if (filters.category && (d.category || 'General') !== filters.category) return false;
  if (filters.privacy && d.privacy !== filters.privacy) return false;
  if (filters.owner === 'mine' && d.owner !== principal) return false;
  if (filters.owner === 'unassigned' && d.owner) return false;
  if (filters.status && (row.querySelector?.('[data-document-status]')?.textContent || '').trim().toLowerCase() !== filters.status.toLowerCase()) return false;
  const updated = (d.updated || '').slice(0,10);
  if (filters.from && (!updated || updated < filters.from)) return false;
  if (filters.to && (!updated || updated > filters.to)) return false;
  return true;
}
export function validDateRange(from, to) {
  return !from || !to || from <= to;
}
