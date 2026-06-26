import { Popup, POPUP_TYPE } from '../../../../../../popup.js';
import {
    getInterpretiveCandidate,
    listInterpretiveDelegationPolicies,
    listInterpretiveReviews,
} from '../../../core/summarization/architectural-authority-server-api.js';
import { escapeHtml, formatDate } from '../../common/ui-utils.js';

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

function renderReviewRecords(interpretation, policiesById) {
    const requests = Array.isArray(interpretation.reviewRequests) ? interpretation.reviewRequests : [];
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
                    </div>
                `;
            }).join('')}
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

function renderCandidateDetail(interpretation, policiesById) {
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
                ${renderReviewRecords(interpretation, policiesById)}
            </div>

            <div class="ss-interpretive-review-section">
                <h4>Subject Disposition</h4>
                ${interpretation.subjectDisposition ? `
                    ${renderKeyValueGrid([
                        { label: 'State', value: renderBadge(interpretation.subjectDisposition.state) },
                        { label: 'Authority', value: renderBadge(interpretation.subjectDisposition.finalDispositionAuthority || 'n/a') },
                        { label: 'Updated', value: escapeHtml(formatTimestamp(interpretation.subjectDisposition.updatedAt)) },
                    ])}
                    ${renderReasonCodes(interpretation.subjectDisposition.reasonCodes)}
                    <div class="ss-interpretive-review-card ss-interpretive-review-statement">${escapeHtml(interpretation.subjectDisposition.commentary || '(no commentary)')}</div>
                    ${renderProvenance(interpretation.subjectDisposition.provenance, policiesById)}
                ` : '<div class="ss-hint">No subject disposition recorded.</div>'}
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
                    <p class="ss-hint">Read-only inspection surface. This modal does not submit review, disposition, revision, or publication actions.</p>
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
        candidateCache: new Map(),
        policiesByScopeId: new Map(),
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

        const renderDetailError = (message) => {
            if (!detailRoot) return;
            detailRoot.innerHTML = `<div class="ss-interpretive-review-detail-empty ss-hint">${escapeHtml(message)}</div>`;
        };

        const selectReview = async (reviewRequestId) => {
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
                let interpretation = state.candidateCache.get(review.interpretationRevisionId) || null;
                if (!interpretation) {
                    const response = await getInterpretiveCandidate(review.interpretationRevisionId);
                    interpretation = response?.interpretation || null;
                    if (interpretation) {
                        state.candidateCache.set(review.interpretationRevisionId, interpretation);
                    }
                }
                if (!interpretation) {
                    renderDetailError('Candidate detail was not returned by the server.');
                    return;
                }
                const policiesById = await loadPoliciesForCandidate(interpretation);
                if (!detailRoot) return;
                detailRoot.innerHTML = renderCandidateDetail(interpretation, policiesById);
            } catch (error) {
                renderDetailError(`Could not load candidate details: ${error?.message || error}`);
            }
        };

        const refreshReviews = async () => {
            if (queueList) {
                queueList.innerHTML = '<div class="ss-interpretive-review-queue-empty ss-hint">Loading review requests...</div>';
            }
            if (detailRoot && !state.selectedReviewRequestId) {
                detailRoot.innerHTML = '<div class="ss-interpretive-review-detail-empty ss-hint">Select a review request to inspect the candidate.</div>';
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
                } else {
                    renderDetailError('No review requests matched the current filter.');
                }
            } catch (error) {
                if (queueList) {
                    queueList.innerHTML = `<div class="ss-interpretive-review-queue-empty ss-hint">Could not load review requests: ${escapeHtml(error?.message || error)}</div>`;
                }
                renderDetailError('Review queue is unavailable.');
            }
        };

        statusFilter?.addEventListener('change', async () => {
            state.filters.status = String(statusFilter.value || '').trim();
            await refreshReviews();
        });

        refreshButton?.addEventListener('click', async () => {
            await refreshReviews();
        });

        queueList?.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-review-request-id]');
            if (!button) return;
            const reviewRequestId = String(button.getAttribute('data-review-request-id') || '').trim();
            if (!reviewRequestId || reviewRequestId === state.selectedReviewRequestId) return;
            await selectReview(reviewRequestId);
        });

        void refreshReviews();
    });

    await showPromise;
}
