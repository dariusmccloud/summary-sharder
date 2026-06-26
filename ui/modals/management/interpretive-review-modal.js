import { Popup, POPUP_TYPE } from '../../../../../../popup.js';
import {
    getInterpretiveCandidate,
    listInterpretiveDelegationPolicies,
    listInterpretiveReviews,
    recordInterpretiveSubjectDisposition,
    submitInterpretiveReviewDisposition,
} from '../../../core/summarization/architectural-authority-server-api.js';
import { escapeHtml, formatDate } from '../../common/ui-utils.js';
import {
    REVIEW_DISPOSITION_OPTIONS,
    SUBJECT_DISPOSITION_OPTIONS,
    filterDelegationPoliciesForAction,
    getInterpretiveSubmissionModeOptions,
    parseInterpretiveTokenList,
    resolveDefaultInterpretiveSubmissionMode,
} from './interpretive-review-form-state.js';

const REVIEW_STATUS_OPTIONS = Object.freeze([
    { value: '', label: 'All statuses' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'APPROVE_WITH_EDIT', label: 'Approve With Edit' },
    { value: 'APPROVE_FOR_SCOPE_ONLY', label: 'Approve For Scope Only' },
    { value: 'CONTESTED', label: 'Contested' },
    { value: 'DEFERRED', label: 'Deferred' },
    { value: 'REJECTED', label: 'Rejected' },
]);

function formatTimestamp(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return 'n/a';
    }
    return formatDate(Number(value));
}

function formatSubmissionModeLabel(value) {
    return String(value || '')
        .trim()
        .split('_')
        .filter(Boolean)
        .map((entry) => entry.charAt(0) + entry.slice(1).toLowerCase())
        .join(' ') || 'n/a';
}

function getCurrentActorEntityId() {
    const context = globalThis.SillyTavern?.getContext?.() || {};
    const userName = String(context?.name1 || context?.user_name || '').trim();
    return userName ? `user:${userName}` : '';
}

function renderBadge(value, { prefix = '', fallback = 'n/a' } = {}) {
    const text = String(value || '').trim() || fallback;
    const stateClass = text.toLowerCase().replace(/[^a-z0-9]+/gu, '-');
    const label = prefix ? `${prefix}${text}` : text;
    return `<span class="ss-interpretive-review-badge state-${escapeHtml(stateClass)}">${escapeHtml(label)}</span>`;
}

function renderKeyValueGrid(rows) {
    return `
        <div class="ss-interpretive-review-grid">
            ${rows.map(({ label, value }) => `
                <div class="ss-interpretive-review-card">
                    <strong>${escapeHtml(label)}</strong>
                    <div>${value}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderStringList(items, emptyLabel = '(none)') {
    if (!Array.isArray(items) || items.length === 0) {
        return escapeHtml(emptyLabel);
    }
    return items.map((item) => `<code>${escapeHtml(String(item))}</code>`).join(', ');
}

function renderReasonCodes(reasonCodes) {
    if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
        return '<span class="ss-hint">No reason codes.</span>';
    }
    return `<div class="ss-interpretive-review-inline-meta">${reasonCodes.map((code) => renderBadge(code)).join('')}</div>`;
}

function renderActionStatus(status, kind) {
    if (!status || status.kind !== kind || !status.message) {
        return '';
    }
    return `
        <div class="ss-interpretive-action-status tone-${escapeHtml(status.tone || 'info')}">
            ${escapeHtml(status.message)}
        </div>
    `;
}

function renderProvenance(provenance, policiesById) {
    if (!provenance) {
        return '<div class="ss-hint">No recorded provenance.</div>';
    }
    const delegationPolicy = provenance.delegationPolicyId
        ? policiesById.get(provenance.delegationPolicyId)
        : null;
    return `
        ${renderKeyValueGrid([
            { label: 'Disposition Owner', value: `<code>${escapeHtml(provenance.dispositionOwnerId || 'n/a')}</code>` },
            { label: 'Recorded By', value: `<code>${escapeHtml(provenance.submittedByActorId || 'n/a')}</code>` },
            { label: 'Submission Mode', value: renderBadge(provenance.submissionMode) },
            { label: 'Recorded At', value: escapeHtml(formatTimestamp(provenance.createdAt)) },
        ])}
        <div class="ss-interpretive-review-card">
            <strong>Delegation Policy</strong>
            <div>${delegationPolicy
                ? `<code>${escapeHtml(delegationPolicy.delegationPolicyId)}</code> v${escapeHtml(String(delegationPolicy.policyVersion))} (${renderBadge(delegationPolicy.policyState)})`
                : provenance.delegationPolicyId
                    ? `<code>${escapeHtml(provenance.delegationPolicyId)}</code>`
                    : 'None'
            }</div>
        </div>
        <div class="ss-interpretive-review-card">
            <strong>Subject Evidence Refs</strong>
            <div>${renderStringList(provenance.subjectEvidenceRefs, 'None recorded')}</div>
        </div>
    `;
}

function renderGroundingLinks(groundingLinks) {
    if (!Array.isArray(groundingLinks) || groundingLinks.length === 0) {
        return '<div class="ss-hint">No grounding links recorded.</div>';
    }
    return `
        <div class="ss-interpretive-review-list">
            ${groundingLinks.map((link) => `
                <div class="ss-interpretive-review-card">
                    <strong>${escapeHtml(link.groundingRole || 'GROUNDING')}</strong>
                    <div class="ss-interpretive-review-inline-meta">
                        ${renderBadge(link.groundingAssessment)}
                        ${renderBadge(link.basisType)}
                    </div>
                    <div><code>${escapeHtml(link.basisRecordId || 'n/a')}</code></div>
                    <div class="ss-hint">
                        chat=<code>${escapeHtml(link.chatInstanceId || 'n/a')}</code>,
                        msg=<code>${escapeHtml(link.messageId || 'n/a')}</code>,
                        speaker=<code>${escapeHtml(link.speakerEntityId || 'n/a')}</code>
                    </div>
                    <pre class="ss-interpretive-review-pre">${escapeHtml(JSON.stringify(link.details || {}, null, 2))}</pre>
                </div>
            `).join('')}
        </div>
    `;
}

function collectReferencedPolicyIds(interpretation) {
    const policyIds = new Set();
    const maybeAdd = (value) => {
        const text = String(value || '').trim();
        if (text) policyIds.add(text);
    };
    maybeAdd(interpretation?.revisionCreationProvenance?.delegationPolicyId);
    maybeAdd(interpretation?.subjectDisposition?.provenance?.delegationPolicyId);
    for (const disposition of interpretation?.reviewDispositions || []) {
        maybeAdd(disposition?.provenance?.delegationPolicyId);
    }
    return [...policyIds];
}

function renderDelegationPolicies(policies) {
    if (!Array.isArray(policies) || policies.length === 0) {
        return '<div class="ss-hint">No related delegation policies referenced by this candidate.</div>';
    }
    return `
        <div class="ss-interpretive-review-list">
            ${policies.map((policy) => `
                <div class="ss-interpretive-review-card">
                    <strong><code>${escapeHtml(policy.delegationPolicyId)}</code> v${escapeHtml(String(policy.policyVersion))}</strong>
                    <div class="ss-interpretive-review-inline-meta">
                        ${renderBadge(policy.policyState)}
                        ${renderBadge(policy.evidenceRequirement)}
                    </div>
                    <div>Principal: <code>${escapeHtml(policy.principalEntityId || 'n/a')}</code></div>
                    <div>Delegate: <code>${escapeHtml(policy.delegateEntityId || 'n/a')}</code></div>
                    <div>Allowed Actions: ${renderStringList(policy.allowedActions, 'None')}</div>
                    <div class="ss-hint">Scope <code>${escapeHtml(policy.memoryScopeId || 'n/a')}</code>, continuity <code>${escapeHtml(policy.continuityTargetId || 'n/a')}</code></div>
                </div>
            `).join('')}
        </div>
    `;
}

function buildDelegationPolicyOptions(policies = []) {
    const items = Array.isArray(policies) ? policies : [];
    if (items.length === 0) {
        return '<option value="">No matching active policy</option>';
    }
    return [
        '<option value="">Select delegation policy</option>',
        ...items.map((policy) => `
            <option value="${escapeHtml(policy.delegationPolicyId)}">
                ${escapeHtml(`${policy.delegationPolicyId} v${policy.policyVersion} [${policy.evidenceRequirement}]`)}
            </option>
        `),
    ].join('');
}

function getDefaultActorForMode(mode, ownerId, currentActorId) {
    if (mode === 'DIRECT_REVIEWER_ACTION' || mode === 'DIRECT_SUBJECT_ACTION') {
        return ownerId;
    }
    return currentActorId || ownerId;
}

function renderSubmissionModeOptions(options, selectedValue) {
    return options.map((option) => `
        <option value="${escapeHtml(option.value)}"${option.value === selectedValue ? ' selected' : ''}>
            ${escapeHtml(option.label)}
        </option>
    `).join('');
}

function renderActionForm({
    formKind,
    ownerId,
    ownerRoleLabel,
    actionKind,
    interpretation,
    currentActorId,
    policies = [],
    reviewRequest = null,
    actionStatus = null,
}) {
    const modeOptions = getInterpretiveSubmissionModeOptions({
        ownerId,
        memorySubjectId: interpretation.memorySubjectId,
    });
    const defaultMode = resolveDefaultInterpretiveSubmissionMode({
        ownerId,
        memorySubjectId: interpretation.memorySubjectId,
        currentActorId,
        actionKind,
        memoryScopeId: interpretation.memoryScopeId,
        continuityTargetId: interpretation.memorySubjectId,
        policies,
    });
    const defaultActorId = getDefaultActorForMode(defaultMode, ownerId, currentActorId);
    const applicablePolicies = filterDelegationPoliciesForAction(policies, {
        principalEntityId: ownerId,
        delegateEntityId: defaultActorId,
        actionKind,
        memoryScopeId: interpretation.memoryScopeId,
        continuityTargetId: interpretation.memorySubjectId,
    });
    const selectOptions = formKind === 'review'
        ? REVIEW_DISPOSITION_OPTIONS
        : SUBJECT_DISPOSITION_OPTIONS;
    const submitLabel = formKind === 'review'
        ? 'Record Review'
        : 'Record Subject Disposition';
    const actionTitle = formKind === 'review'
        ? 'Governed Review Action'
        : 'Governed Subject Disposition';

    return `
        <div class="ss-interpretive-review-card ss-interpretive-action-card">
            <strong>${escapeHtml(actionTitle)}</strong>
            ${renderActionStatus(actionStatus, formKind)}
            <form class="ss-interpretive-action-form"
                data-form-kind="${escapeHtml(formKind)}"
                data-action-kind="${escapeHtml(actionKind)}"
                data-owner-id="${escapeHtml(ownerId)}"
                data-memory-scope-id="${escapeHtml(interpretation.memoryScopeId || '')}"
                data-memory-subject-id="${escapeHtml(interpretation.memorySubjectId || '')}"
                data-continuity-target-id="${escapeHtml(interpretation.memorySubjectId || '')}"
                data-interpretation-revision-id="${escapeHtml(interpretation.interpretationRevisionId)}"
                data-review-envelope-hash="${escapeHtml(reviewRequest?.reviewEnvelopeHash || interpretation.reviewEnvelopeHash || '')}"
                data-review-request-id="${escapeHtml(reviewRequest?.reviewRequestId || '')}"
                data-default-actor-id="${escapeHtml(currentActorId || '')}">
                ${renderKeyValueGrid([
                    { label: 'Disposition Owner', value: `<code>${escapeHtml(ownerId)}</code>` },
                    { label: 'Owner Role', value: escapeHtml(ownerRoleLabel) },
                    { label: 'Authority Boundary', value: 'Server validates reviewer binding, review envelope, delegation scope, action, version, and hash.' },
                ])}

                <div class="ss-interpretive-review-form-grid">
                    <label class="ss-interpretive-review-field">
                        <span>${escapeHtml(formKind === 'review' ? 'Disposition' : 'Subject Disposition')}</span>
                        <select class="text_pole" name="${formKind === 'review' ? 'disposition' : 'state'}">
                            ${selectOptions.map((entry) => `
                                <option value="${escapeHtml(entry.value)}">${escapeHtml(entry.label)}</option>
                            `).join('')}
                        </select>
                    </label>

                    <label class="ss-interpretive-review-field">
                        <span>Submission Mode</span>
                        <select class="text_pole" name="submissionMode">
                            ${renderSubmissionModeOptions(modeOptions, defaultMode)}
                        </select>
                    </label>

                    <label class="ss-interpretive-review-field">
                        <span>Recorded By</span>
                        <input class="text_pole" type="text" name="submittedByActorId" value="${escapeHtml(defaultActorId)}" />
                    </label>

                    <label class="ss-interpretive-review-field" data-field="delegationPolicyId"${defaultMode === 'TRUSTED_DELEGATE' ? '' : ' hidden'}>
                        <span>Delegation Policy</span>
                        <select class="text_pole" name="delegationPolicyId">
                            ${buildDelegationPolicyOptions(applicablePolicies)}
                        </select>
                        <span class="ss-hint">Trusted delegation binds the exact policy version and hash on submit.</span>
                    </label>
                </div>

                <label class="ss-interpretive-review-field" data-field="subjectEvidenceRefs"${defaultMode === 'DIRECT_REVIEWER_ACTION' || defaultMode === 'DIRECT_SUBJECT_ACTION' ? ' hidden' : ''}>
                    <span>Subject Evidence Refs</span>
                    <textarea class="text_pole" rows="2" name="subjectEvidenceRefs" placeholder="One ref per line or comma-separated"></textarea>
                    <span class="ss-hint" data-field-hint="subjectEvidenceRefs">
                        ${defaultMode === 'SUBJECT_EXPRESSED_AND_RECORDED'
                            ? 'Required for recorded subject expression.'
                            : 'Optional for trusted delegation.'}
                    </span>
                </label>

                <label class="ss-interpretive-review-field">
                    <span>Reason Codes</span>
                    <input class="text_pole" type="text" name="reasonCodes" placeholder="AUTHORITY, ROLE" />
                </label>

                <label class="ss-interpretive-review-field">
                    <span>Commentary</span>
                    <textarea class="text_pole" rows="3" name="commentary" placeholder="Explain the recorded disposition."></textarea>
                </label>

                ${formKind === 'review' ? `
                    <div class="ss-hint">Immutable <code>APPROVE_WITH_EDIT</code> revision flow remains reserved for the later editor slice.</div>
                ` : ''}

                <div class="ss-interpretive-review-form-actions">
                    <input class="menu_button" type="submit" value="${escapeHtml(submitLabel)}" />
                </div>
            </form>
        </div>
    `;
}

function renderReviewRecords(interpretation, policiesById, selectedReviewRequestId, currentActorId, actionStatus) {
    const requests = Array.isArray(interpretation.reviewRequests) ? interpretation.reviewRequests : [];
    const policies = [...policiesById.values()];
    const dispositionsByRequestId = new Map(
        (Array.isArray(interpretation.reviewDispositions) ? interpretation.reviewDispositions : [])
            .map((entry) => [entry.reviewRequestId, entry]),
    );
    if (requests.length === 0) {
        return '<div class="ss-hint">No review requests recorded.</div>';
    }
    return `
        <div class="ss-interpretive-review-list">
            ${requests.map((request) => {
                const disposition = dispositionsByRequestId.get(request.reviewRequestId) || null;
                const showForm = request.reviewRequestId === selectedReviewRequestId && request.status === 'PENDING';
                const ownerRoleLabel = request.reviewerEntityId === interpretation.memorySubjectId
                    ? 'Memory Subject'
                    : 'Reviewer';
                return `
                    <div class="ss-interpretive-review-card">
                        <strong>${escapeHtml(request.reviewerRole || 'Reviewer')}</strong>
                        <div class="ss-interpretive-review-inline-meta">
                            ${renderBadge(request.status)}
                            <code>${escapeHtml(request.reviewerEntityId || 'n/a')}</code>
                        </div>
                        <div class="ss-hint">Request created ${escapeHtml(formatTimestamp(request.createdAt))}</div>
                        <div class="ss-hint">Envelope <code>${escapeHtml(request.reviewEnvelopeHash || 'n/a')}</code></div>
                        ${disposition ? `
                            <div class="ss-interpretive-review-section">
                                <h4>Disposition</h4>
                                <div class="ss-interpretive-review-inline-meta">
                                    ${renderBadge(disposition.disposition)}
                                </div>
                                ${renderReasonCodes(disposition.reasonCodes)}
                                <div class="ss-interpretive-review-statement">${escapeHtml(disposition.commentary || '(no commentary)')}</div>
                                <div class="ss-hint">Submitted ${escapeHtml(formatTimestamp(disposition.submittedAt))}</div>
                                ${renderProvenance(disposition.provenance, policiesById)}
                            </div>
                        ` : '<div class="ss-hint">No disposition submitted.</div>'}
                        ${showForm ? renderActionForm({
                            formKind: 'review',
                            ownerId: request.reviewerEntityId,
                            ownerRoleLabel,
                            actionKind: 'REVIEW_DISPOSITION',
                            interpretation,
                            currentActorId,
                            policies,
                            reviewRequest: request,
                            actionStatus,
                        }) : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderSubjectDispositionSection(interpretation, policiesById, currentActorId, actionStatus) {
    const pendingRequests = Array.isArray(interpretation.reviewRequests)
        ? interpretation.reviewRequests.filter((entry) => entry.status === 'PENDING' || entry.status === 'DEFERRED')
        : [];
    const subjectDispositionHtml = interpretation.subjectDisposition ? `
        ${renderKeyValueGrid([
            { label: 'State', value: renderBadge(interpretation.subjectDisposition.state) },
            { label: 'Authority', value: renderBadge(interpretation.subjectDisposition.finalDispositionAuthority || 'n/a') },
            { label: 'Updated', value: escapeHtml(formatTimestamp(interpretation.subjectDisposition.updatedAt)) },
        ])}
        ${renderReasonCodes(interpretation.subjectDisposition.reasonCodes)}
        <div class="ss-interpretive-review-card ss-interpretive-review-statement">${escapeHtml(interpretation.subjectDisposition.commentary || '(no commentary)')}</div>
        ${renderProvenance(interpretation.subjectDisposition.provenance, policiesById)}
    ` : '<div class="ss-hint">No subject disposition recorded.</div>';

    const blocked = pendingRequests.length > 0
        || interpretation.reviewState === 'BLOCKED'
        || interpretation.reviewState === 'PENDING'
        || interpretation.reviewState === 'DEFERRED';

    const formHtml = blocked
        ? '<div class="ss-hint">Subject disposition remains blocked until all required reviews are complete.</div>'
        : renderActionForm({
            formKind: 'subject',
            ownerId: interpretation.memorySubjectId,
            ownerRoleLabel: 'Memory Subject',
            actionKind: 'SUBJECT_DISPOSITION',
            interpretation,
            currentActorId,
            policies: [...policiesById.values()],
            actionStatus,
        });

    return `
        ${subjectDispositionHtml}
        <div class="ss-interpretive-review-section">
            <h4>Record Subject Disposition</h4>
            ${formHtml}
        </div>
    `;
}

function renderReviewItem(review, selected) {
    const dispositionBadge = review.disposition
        ? renderBadge(review.disposition.disposition)
        : '';
    return `
        <button type="button"
            class="ss-interpretive-review-item${selected ? ' active' : ''}"
            data-review-request-id="${escapeHtml(review.reviewRequestId)}"
            data-interpretation-revision-id="${escapeHtml(review.interpretationRevisionId)}">
            <div class="ss-interpretive-review-item-title">${escapeHtml(review.reviewerRole || 'Reviewer')}</div>
            <div class="ss-interpretive-review-inline-meta">
                ${renderBadge(review.status)}
                ${dispositionBadge}
            </div>
            <div><code>${escapeHtml(review.reviewerEntityId || 'n/a')}</code></div>
            <div class="ss-hint">${escapeHtml(formatTimestamp(review.createdAt))}</div>
        </button>
    `;
}

function renderCandidateDetail(interpretation, policiesById, options = {}) {
    if (!interpretation) {
        return '<div class="ss-interpretive-review-detail-empty ss-hint">Select a review request to inspect the candidate.</div>';
    }

    const relatedPolicyIds = collectReferencedPolicyIds(interpretation);
    const relatedPolicies = relatedPolicyIds
        .map((policyId) => policiesById.get(policyId))
        .filter(Boolean);

    return `
        <div class="ss-interpretive-review-detail-header">
            <div>
                <div class="ss-interpretive-review-detail-title">${escapeHtml(interpretation.type || 'Interpretation')}</div>
                <div class="ss-hint"><code>${escapeHtml(interpretation.interpretationRevisionId)}</code></div>
            </div>
            <div class="ss-interpretive-review-inline-meta">
                ${renderBadge(interpretation.reviewState)}
                ${renderBadge(interpretation.subjectDispositionState)}
                ${renderBadge(interpretation.publicationState)}
                ${renderBadge(interpretation.authorityEffect)}
            </div>
        </div>
        <div class="ss-interpretive-review-detail-body">
            <div class="ss-interpretive-review-section">
                <h4>Statement</h4>
                <div class="ss-interpretive-review-card ss-interpretive-review-statement">${escapeHtml(interpretation.statement || '')}</div>
            </div>

            <div class="ss-interpretive-review-section">
                <h4>Identity and Lifecycle</h4>
                ${renderKeyValueGrid([
                    { label: 'Interpretation ID', value: `<code>${escapeHtml(interpretation.interpretationId || 'n/a')}</code>` },
                    { label: 'Memory Scope', value: `<code>${escapeHtml(interpretation.memoryScopeId || 'n/a')}</code>` },
                    { label: 'Memory Subject', value: `<code>${escapeHtml(interpretation.memorySubjectId || 'n/a')}</code>` },
                    { label: 'Revision Reason', value: escapeHtml(interpretation.revisionReason || 'n/a') },
                    { label: 'Candidate State', value: renderBadge(interpretation.candidateState) },
                    { label: 'Grounding State', value: renderBadge(interpretation.groundingState) },
                    { label: 'Created', value: escapeHtml(formatTimestamp(interpretation.createdAt)) },
                    { label: 'Updated', value: escapeHtml(formatTimestamp(interpretation.updatedAt)) },
                ])}
            </div>

            <div class="ss-interpretive-review-section">
                <h4>Assertion Surface</h4>
                ${renderKeyValueGrid([
                    { label: 'Assertion Domains', value: renderStringList(interpretation.assertionDomains, 'None') },
                    { label: 'Participants', value: renderStringList(interpretation.materialParticipantEntityIds, 'None') },
                    { label: 'Shared Relationship', value: renderBadge(interpretation.sharedRelationshipAsserted ? 'TRUE' : 'FALSE') },
                    { label: 'Personal Meaning', value: renderBadge(interpretation.personalMeaningAsserted ? 'TRUE' : 'FALSE') },
                ])}
            </div>

            <div class="ss-interpretive-review-section">
                <h4>Risk and Policy</h4>
                ${renderKeyValueGrid([
                    { label: 'Risk Class', value: renderBadge(interpretation.risk?.riskClass || 'n/a') },
                    { label: 'Risk Reasons', value: renderStringList(interpretation.risk?.riskReasons, 'None') },
                    { label: 'Validation Policy', value: interpretation.policyBinding ? `<code>${escapeHtml(interpretation.policyBinding.validationPolicyId)}</code> v${escapeHtml(String(interpretation.policyBinding.policyVersion))}` : 'n/a' },
                    { label: 'Matched Rules', value: renderStringList(interpretation.policyBinding?.matchedRuleIds, 'None') },
                ])}
            </div>

            <div class="ss-interpretive-review-section">
                <h4>Review Routing</h4>
                ${renderReviewRecords(
                    interpretation,
                    policiesById,
                    options.selectedReviewRequestId,
                    options.currentActorId,
                    options.actionStatus,
                )}
            </div>

            <div class="ss-interpretive-review-section">
                <h4>Subject Disposition</h4>
                ${renderSubjectDispositionSection(
                    interpretation,
                    policiesById,
                    options.currentActorId,
                    options.actionStatus,
                )}
            </div>

            <div class="ss-interpretive-review-section">
                <h4>Revision Creation Provenance</h4>
                ${renderProvenance(interpretation.revisionCreationProvenance, policiesById)}
            </div>

            <div class="ss-interpretive-review-section">
                <h4>Grounding</h4>
                ${renderKeyValueGrid([
                    { label: 'Grounding Outcome', value: renderBadge(interpretation.groundingAggregate?.groundingOutcome || 'n/a') },
                    { label: 'Evaluated At', value: escapeHtml(formatTimestamp(interpretation.groundingAggregate?.evaluatedAt)) },
                    { label: 'Proposal Content Hash', value: `<code>${escapeHtml(interpretation.proposalContentHash || 'n/a')}</code>` },
                    { label: 'Review Envelope Hash', value: `<code>${escapeHtml(interpretation.reviewEnvelopeHash || 'n/a')}</code>` },
                ])}
                ${renderGroundingLinks(interpretation.groundingLinks)}
            </div>

            <div class="ss-interpretive-review-section">
                <h4>Child Revisions</h4>
                <div class="ss-interpretive-review-card">${renderStringList(interpretation.childRevisionIds, 'None')}</div>
            </div>

            <div class="ss-interpretive-review-section">
                <h4>Related Delegation Policies</h4>
                ${renderDelegationPolicies(relatedPolicies)}
            </div>
        </div>
    `;
}

function renderModalHtml(state) {
    const statusOptions = REVIEW_STATUS_OPTIONS.map((option) => `
        <option value="${escapeHtml(option.value)}"${state.filters.status === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>
    `).join('');

    return `
        <div class="ss-interpretive-review-modal">
            <div class="ss-interpretive-review-toolbar">
                <div>
                    <h3>Interpretive Review Queue</h3>
                    <p class="ss-hint">Governed review surface. Review and subject-disposition actions are allowed here; continuity publication and activation remain unavailable.</p>
                </div>
                <div class="ss-interpretive-review-filter">
                    <label for="ss-interpretive-review-status-filter">Review Status</label>
                    <select id="ss-interpretive-review-status-filter" class="text_pole">${statusOptions}</select>
                </div>
            </div>

            <div class="ss-interpretive-review-layout">
                <div class="ss-interpretive-review-column">
                    <div class="ss-interpretive-review-queue">
                        <div class="ss-interpretive-review-queue-header">
                            <strong>Review Requests</strong>
                            <input id="ss-interpretive-review-refresh" class="menu_button" type="button" value="Refresh" />
                        </div>
                        <div id="ss-interpretive-review-queue-list" class="ss-interpretive-review-queue-list">
                            <div class="ss-interpretive-review-queue-empty ss-hint">Loading review requests...</div>
                        </div>
                    </div>
                </div>

                <div class="ss-interpretive-review-column">
                    <div id="ss-interpretive-review-detail" class="ss-interpretive-review-detail">
                        <div class="ss-interpretive-review-detail-empty ss-hint">Select a review request to inspect the candidate.</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export async function openInterpretiveReviewModal() {
    const state = {
        filters: { status: 'PENDING' },
        reviews: [],
        selectedReviewRequestId: null,
        selectedInterpretationRevisionId: null,
        candidateCache: new Map(),
        policiesByScopeId: new Map(),
        activeInterpretation: null,
        activePoliciesById: new Map(),
        actionStatus: null,
        currentActorId: getCurrentActorEntityId(),
    };

    const popup = new Popup(
        renderModalHtml(state),
        POPUP_TYPE.TEXT,
        null,
        { okButton: 'Close', cancelButton: false, wide: true, large: true },
    );
    const showPromise = popup.show();

    requestAnimationFrame(() => {
        const statusFilter = document.getElementById('ss-interpretive-review-status-filter');
        const refreshButton = document.getElementById('ss-interpretive-review-refresh');
        const queueList = document.getElementById('ss-interpretive-review-queue-list');
        const detailRoot = document.getElementById('ss-interpretive-review-detail');

        const renderDetailError = (message) => {
            if (!detailRoot) return;
            detailRoot.innerHTML = `<div class="ss-interpretive-review-detail-empty ss-hint">${escapeHtml(message)}</div>`;
        };

        const renderQueue = () => {
            if (!queueList) return;
            if (state.reviews.length === 0) {
                queueList.innerHTML = '<div class="ss-interpretive-review-queue-empty ss-hint">No review requests matched the current filter.</div>';
                return;
            }
            queueList.innerHTML = state.reviews.map((review) => renderReviewItem(review, review.reviewRequestId === state.selectedReviewRequestId)).join('');
        };

        const loadPoliciesForCandidate = async (interpretation) => {
            const scopeId = String(interpretation?.memoryScopeId || '').trim();
            if (!scopeId) {
                return new Map();
            }
            if (state.policiesByScopeId.has(scopeId)) {
                return state.policiesByScopeId.get(scopeId);
            }
            const response = await listInterpretiveDelegationPolicies({ memoryScopeId: scopeId });
            const policies = Array.isArray(response?.policies) ? response.policies : [];
            const policyMap = new Map(policies.map((policy) => [policy.delegationPolicyId, policy]));
            state.policiesByScopeId.set(scopeId, policyMap);
            return policyMap;
        };

        const renderCurrentDetail = () => {
            if (!detailRoot) return;
            if (!state.activeInterpretation) {
                renderDetailError('Select a review request to inspect the candidate.');
                return;
            }
            detailRoot.innerHTML = renderCandidateDetail(state.activeInterpretation, state.activePoliciesById, {
                selectedReviewRequestId: state.selectedReviewRequestId,
                currentActorId: state.currentActorId,
                actionStatus: state.actionStatus,
            });
            syncActionForms();
        };

        const loadInterpretationByRevision = async (interpretationRevisionId) => {
            const normalizedId = String(interpretationRevisionId || '').trim();
            if (!normalizedId) {
                state.activeInterpretation = null;
                state.activePoliciesById = new Map();
                state.selectedInterpretationRevisionId = null;
                renderCurrentDetail();
                return;
            }

            let interpretation = state.candidateCache.get(normalizedId) || null;
            if (!interpretation) {
                const response = await getInterpretiveCandidate(normalizedId);
                interpretation = response?.interpretation || null;
                if (interpretation) {
                    state.candidateCache.set(normalizedId, interpretation);
                }
            }
            if (!interpretation) {
                state.activeInterpretation = null;
                state.activePoliciesById = new Map();
                renderDetailError('Candidate detail was not returned by the server.');
                return;
            }
            state.selectedInterpretationRevisionId = normalizedId;
            state.activeInterpretation = interpretation;
            state.activePoliciesById = await loadPoliciesForCandidate(interpretation);
            renderCurrentDetail();
        };

        const selectReview = async (reviewRequestId) => {
            state.actionStatus = null;
            state.selectedReviewRequestId = reviewRequestId;
            renderQueue();
            const review = state.reviews.find((entry) => entry.reviewRequestId === reviewRequestId) || null;
            if (!review) {
                renderDetailError('Selected review request is no longer available.');
                return;
            }

            if (detailRoot) {
                detailRoot.innerHTML = '<div class="ss-interpretive-review-detail-empty ss-hint">Loading candidate details...</div>';
            }

            try {
                await loadInterpretationByRevision(review.interpretationRevisionId);
            } catch (error) {
                renderDetailError(`Could not load candidate details: ${error?.message || error}`);
            }
        };

        const refreshReviews = async ({ preserveDetail = false } = {}) => {
            if (queueList) {
                queueList.innerHTML = '<div class="ss-interpretive-review-queue-empty ss-hint">Loading review requests...</div>';
            }
            try {
                const response = await listInterpretiveReviews(
                    state.filters.status ? { status: state.filters.status } : {},
                );
                state.reviews = Array.isArray(response?.reviews) ? response.reviews : [];
                if (!state.reviews.some((review) => review.reviewRequestId === state.selectedReviewRequestId)) {
                    state.selectedReviewRequestId = state.reviews[0]?.reviewRequestId || null;
                }
                renderQueue();
                if (state.selectedReviewRequestId) {
                    await selectReview(state.selectedReviewRequestId);
                    return;
                }
                if (preserveDetail && state.selectedInterpretationRevisionId) {
                    state.candidateCache.delete(state.selectedInterpretationRevisionId);
                    await loadInterpretationByRevision(state.selectedInterpretationRevisionId);
                    return;
                }
                renderDetailError('No review requests matched the current filter.');
            } catch (error) {
                if (queueList) {
                    queueList.innerHTML = `<div class="ss-interpretive-review-queue-empty ss-hint">Could not load review requests: ${escapeHtml(error?.message || error)}</div>`;
                }
                renderDetailError('Review queue is unavailable.');
            }
        };

        function buildApplicablePolicies(form) {
            const ownerId = String(form.dataset.ownerId || '').trim();
            const actionKind = String(form.dataset.actionKind || '').trim();
            const memoryScopeId = String(form.dataset.memoryScopeId || '').trim();
            const continuityTargetId = String(form.dataset.continuityTargetId || '').trim();
            const actorId = String(form.querySelector('[name="submittedByActorId"]')?.value || '').trim();
            return filterDelegationPoliciesForAction([...state.activePoliciesById.values()], {
                principalEntityId: ownerId,
                delegateEntityId: actorId,
                actionKind,
                memoryScopeId,
                continuityTargetId,
            });
        }

        function syncActionForm(form) {
            const mode = String(form.querySelector('[name="submissionMode"]')?.value || '').trim();
            const policyField = form.querySelector('[data-field="delegationPolicyId"]');
            const policySelect = form.querySelector('[name="delegationPolicyId"]');
            const evidenceField = form.querySelector('[data-field="subjectEvidenceRefs"]');
            const evidenceHint = form.querySelector('[data-field-hint="subjectEvidenceRefs"]');
            const applicablePolicies = buildApplicablePolicies(form);

            if (policySelect) {
                const currentValue = String(policySelect.value || '').trim();
                policySelect.innerHTML = buildDelegationPolicyOptions(applicablePolicies);
                if (currentValue && applicablePolicies.some((policy) => policy.delegationPolicyId === currentValue)) {
                    policySelect.value = currentValue;
                }
            }

            if (policyField) {
                policyField.hidden = mode !== 'TRUSTED_DELEGATE';
            }
            if (evidenceField) {
                evidenceField.hidden = !(mode === 'SUBJECT_EXPRESSED_AND_RECORDED' || mode === 'TRUSTED_DELEGATE');
            }
            if (evidenceHint) {
                evidenceHint.textContent = mode === 'SUBJECT_EXPRESSED_AND_RECORDED'
                    ? 'Required for recorded subject expression.'
                    : 'Optional for trusted delegation.';
            }
        }

        function syncActionForms() {
            detailRoot?.querySelectorAll('.ss-interpretive-action-form').forEach((form) => syncActionForm(form));
        }

        function setInlineFormStatus(form, tone, message) {
            let status = form.parentElement.querySelector('.ss-interpretive-action-status');
            if (!status) {
                status = document.createElement('div');
                status.className = 'ss-interpretive-action-status';
                form.parentElement.insertBefore(status, form);
            }
            status.className = `ss-interpretive-action-status tone-${tone}`;
            status.textContent = message;
        }

        function setFormBusy(form, busy) {
            for (const element of form.querySelectorAll('input, select, textarea, button')) {
                element.disabled = busy;
            }
        }

        async function handleReviewSubmit(form) {
            const reviewRequestId = String(form.dataset.reviewRequestId || '').trim();
            const reviewEnvelopeHash = String(form.dataset.reviewEnvelopeHash || '').trim();
            const ownerId = String(form.dataset.ownerId || '').trim();
            const payload = {
                disposition: String(form.querySelector('[name="disposition"]')?.value || '').trim(),
                reviewEnvelopeHash,
                dispositionOwnerId: ownerId,
                submittedByActorId: String(form.querySelector('[name="submittedByActorId"]')?.value || '').trim(),
                submissionMode: String(form.querySelector('[name="submissionMode"]')?.value || '').trim(),
                delegationPolicyId: String(form.querySelector('[name="delegationPolicyId"]')?.value || '').trim() || null,
                subjectEvidenceRefs: parseInterpretiveTokenList(form.querySelector('[name="subjectEvidenceRefs"]')?.value || ''),
                reasonCodes: parseInterpretiveTokenList(form.querySelector('[name="reasonCodes"]')?.value || ''),
                commentary: String(form.querySelector('[name="commentary"]')?.value || '').trim(),
            };

            setFormBusy(form, true);
            setInlineFormStatus(form, 'info', 'Submitting governed review disposition...');
            try {
                const response = await submitInterpretiveReviewDisposition(reviewRequestId, payload);
                state.currentActorId = payload.submittedByActorId || state.currentActorId;
                state.actionStatus = {
                    kind: 'review',
                    tone: 'success',
                    message: `Recorded ${response?.disposition?.disposition || payload.disposition} for ${ownerId}.`,
                };
                if (state.selectedInterpretationRevisionId) {
                    state.candidateCache.delete(state.selectedInterpretationRevisionId);
                }
                await refreshReviews({ preserveDetail: true });
            } catch (error) {
                setInlineFormStatus(form, 'error', error?.message || String(error));
            } finally {
                setFormBusy(form, false);
            }
        }

        async function handleSubjectSubmit(form) {
            const interpretationRevisionId = String(form.dataset.interpretationRevisionId || '').trim();
            const reviewEnvelopeHash = String(form.dataset.reviewEnvelopeHash || '').trim();
            const ownerId = String(form.dataset.ownerId || '').trim();
            const payload = {
                state: String(form.querySelector('[name="state"]')?.value || '').trim(),
                reviewEnvelopeHash,
                dispositionOwnerId: ownerId,
                submittedByActorId: String(form.querySelector('[name="submittedByActorId"]')?.value || '').trim(),
                submissionMode: String(form.querySelector('[name="submissionMode"]')?.value || '').trim(),
                delegationPolicyId: String(form.querySelector('[name="delegationPolicyId"]')?.value || '').trim() || null,
                subjectEvidenceRefs: parseInterpretiveTokenList(form.querySelector('[name="subjectEvidenceRefs"]')?.value || ''),
                reasonCodes: parseInterpretiveTokenList(form.querySelector('[name="reasonCodes"]')?.value || ''),
                commentary: String(form.querySelector('[name="commentary"]')?.value || '').trim(),
            };

            setFormBusy(form, true);
            setInlineFormStatus(form, 'info', 'Recording governed subject disposition...');
            try {
                const response = await recordInterpretiveSubjectDisposition(interpretationRevisionId, payload);
                state.currentActorId = payload.submittedByActorId || state.currentActorId;
                state.actionStatus = {
                    kind: 'subject',
                    tone: 'success',
                    message: `Recorded ${response?.subjectDisposition?.state || payload.state} for ${ownerId}.`,
                };
                if (state.selectedInterpretationRevisionId) {
                    state.candidateCache.delete(state.selectedInterpretationRevisionId);
                }
                await refreshReviews({ preserveDetail: true });
            } catch (error) {
                setInlineFormStatus(form, 'error', error?.message || String(error));
            } finally {
                setFormBusy(form, false);
            }
        }

        statusFilter?.addEventListener('change', async () => {
            state.actionStatus = null;
            state.filters.status = String(statusFilter.value || '').trim();
            await refreshReviews({ preserveDetail: true });
        });

        refreshButton?.addEventListener('click', async () => {
            state.actionStatus = null;
            await refreshReviews({ preserveDetail: true });
        });

        queueList?.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-review-request-id]');
            if (!button) return;
            const reviewRequestId = String(button.getAttribute('data-review-request-id') || '').trim();
            if (!reviewRequestId || reviewRequestId === state.selectedReviewRequestId) return;
            await selectReview(reviewRequestId);
        });

        detailRoot?.addEventListener('change', (event) => {
            const form = event.target.closest('.ss-interpretive-action-form');
            if (!form) return;
            if (event.target.name === 'submissionMode') {
                const ownerId = String(form.dataset.ownerId || '').trim();
                const actorInput = form.querySelector('[name="submittedByActorId"]');
                if (actorInput) {
                    actorInput.value = getDefaultActorForMode(
                        String(event.target.value || '').trim(),
                        ownerId,
                        state.currentActorId,
                    );
                }
                syncActionForm(form);
                return;
            }
            if (event.target.name === 'submittedByActorId') {
                syncActionForm(form);
            }
        });

        detailRoot?.addEventListener('submit', async (event) => {
            const form = event.target.closest('.ss-interpretive-action-form');
            if (!form) return;
            event.preventDefault();
            if (form.dataset.formKind === 'review') {
                await handleReviewSubmit(form);
                return;
            }
            if (form.dataset.formKind === 'subject') {
                await handleSubjectSubmit(form);
            }
        });

        void refreshReviews();
    });

    await showPromise;
}
