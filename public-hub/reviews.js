// UI only. Review authorisation, decision separation and version pinning are
// always checked in the API and PostgreSQL; these controls are not permissions.
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label={pending:'Awaiting review',approved:'Approved for publication',rejected:'Changes requested',superseded:'Superseded by a new version'};

export function approvalPanel(file,history,role,actorId){
  const canManage=role==='manager'&&file.editable;
  if(!file.requires_approval){
    if(!canManage||file.archived||!['section','team'].includes(file.privacy))return '';
    return `<section class="detail-section controlled-approval"><p class="eyebrow">REVIEW & PUBLICATION</p>
      <h3>Keep policies version-controlled</h3>
      <p>Require independent review before any version becomes available to readers. Once enabled, this protection cannot be switched off through the app.</p>
      <button type="button" id="approval-enable">Enable controlled publication</button></section>`;
  }
  const published=history?.publishedVersion??null;
  const current=file.versions[0];
  const review=history?.reviews?.find(x=>x.version_id===current?.id);
  const waiting=review?.status==='pending';
  const approved=review?.status==='approved';
  const independent=review?.submitted_by!==actorId&&current?.author_id!==actorId;
  const maySubmit=file.editable&&!file.archived&&!waiting&&!approved&&published!==current?.version;
  const mayDecide=canManage&&!file.archived&&waiting&&independent;
  const mayPublish=canManage&&!file.archived&&approved&&published!==current?.version;
  return `<section class="detail-section controlled-approval" aria-label="Document approval workflow">
    <p class="eyebrow">CONTROLLED DOCUMENT</p><h3>Review & publication</h3>
    <p class="hint">Staff readers see only published versions. Editors can prepare drafts; managers independently approve and publish.</p>
    <div class="approval-state"><span class="pill ${published?'section':'team'}">${published?`Published v${e(published)}`:'Not published'}</span>
      ${current?`<span class="pill ${waiting?'team':approved?'section':''}">${review?e(label[review.status]):'Draft not submitted'} · v${e(current.version)}</span>`:''}</div>
    ${review?.review_note?`<p class="hint">Reviewer note: ${e(review.review_note)}</p>`:''}
    <div class="approval-buttons">
      ${maySubmit?'<button type="button" id="approval-submit">Submit current version for review</button>':''}
      ${mayDecide?`<button type="button" data-approval-decision="approved" data-review-id="${e(review.id)}">Approve</button><button type="button" data-approval-decision="rejected" data-review-id="${e(review.id)}">Request changes</button>`:''}
      ${mayPublish?'<button type="button" id="approval-publish" class="primary">Publish approved version</button>':''}
    </div>
    ${!canManage&&waiting&&file.editable?'<p class="hint">Waiting for a different section manager to review this version.</p>':''}
    ${history?.reviews?.length?`<details><summary>Review history (${history.reviews.length})</summary>
      <ol class="approval-history">${history.reviews.map(r=>`<li><strong>v${e(r.version)} · ${e(label[r.status])}</strong><small>${e(new Date(r.submitted_at).toLocaleDateString('en-ZA'))}${r.review_note?` · ${e(r.review_note)}`:''}</small></li>`).join('')}</ol></details>`:''}
  </section>`;
}
