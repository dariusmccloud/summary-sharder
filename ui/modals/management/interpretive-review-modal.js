import { Popup, POPUP_TYPE } from '../../../../../../popup.js';
import {
    createInterpretivePublicationAuthorization,
    executeInterpretivePublicationAuthorization,
    getInterpretiveCandidate,
    getInterpretivePublicationOperatorState,
    listInterpretiveDelegationPolicies,
    listInterpretiveReviews,
    qualifyInterpretivePublication,
    recordDnmDeltaReview,
    recordInterpretiveSubjectDisposition,
    supersedeDnmPublicationRecord,
    submitInterpretiveReviewDisposition,
    withdrawDnmPublicationRecord,
} from '../../../core/summarization/architectural-authority-server-api.js';
import { escapeHtml, formatDate } from '../../common/ui-utils.js';
import {
    buildInterpretiveRevisedCandidatePayload,
    getGovernedFieldState,
    getInterpretiveDispositionFieldState,
    INTERPRETIVE_REASON_CODE_GROUPS,
    REVIEW_DISPOSITION_OPTIONS,
    SUBJECT_DISPOSITION_OPTIONS,
    filterDelegationPoliciesForAction,
    getInterpretiveSubmissionModeOptions,
    parseInterpretiveTokenList,
    resolveDefaultInterpretiveSubmissionMode,
    shouldShowInterpretiveRevisionEditor,
    validateInterpretiveActionPayload,
    validateGovernedSubmissionPayload as validateGovernedSubmissionState,
} from './interpretive-review-form-state.js';

const REVIEW_STATUS_OPTIONS = Object.freeze([
    { value: '', label: 'All statuses' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'APPROVE_WITH_EDIT', label: 'Approved with changes' },
    { value: 'APPROVE_FOR_SCOPE_ONLY', label: 'Approved for scope only' },
    { value: 'CONTESTED', label: 'Contested' },
    { value: 'DEFERRED', label: 'Deferred' },
    { value: 'REJECTED', label: 'Rejected' },
]);

const INTERPRETIVE_REASON_CODE_LABELS = new Map(
    INTERPRETIVE_REASON_CODE_GROUPS.flatMap((group) =>
        group.codes.map((entry) => [entry.value, entry.label])),
);

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

function formatDateTimeLocalValue(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '';
    }
    const date = new Date(Number(value));
    const pad = (entry) => String(entry).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocalValue(value) {
    const text = String(value || '').trim();
    if (!text) {
        return null;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
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

function normalizeActionLabel(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_');
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

function renderCollapsibleSection(title, description, content, options = {}) {
    const open = options.open === true;
    const extraClass = String(options.extraClass || '').trim();
    return `
        <details class="ss-interpretive-review-section ss-review-section ss-review-section--disclosure ss-interpretive-review-disclosure${extraClass ? ` ${escapeHtml(extraClass)}` : ''}"${open ? ' open' : ''}>
            <summary class="ss-review-section__header ss-interpretive-review-disclosure-summary">
                <span class="ss-review-section__title ss-interpretive-review-disclosure-title">${escapeHtml(title)}</span>
                ${description ? `<span class="ss-review-section__description ss-interpretive-review-disclosure-description">${escapeHtml(description)}</span>` : ''}
            </summary>
            <div class="ss-review-section__body ss-interpretive-review-disclosure-body">
                ${content}
            </div>
        </details>
    `;
}

function renderStringList(items, emptyLabel = '(none)') {
    if (!Array.isArray(items) || items.length === 0) {
        return escapeHtml(emptyLabel);
    }
    return items.map((item) => `<code>${escapeHtml(String(item))}</code>`).join(', ');
}

function hasDisplayableValues(items) {
    return Array.isArray(items) && items.some((item) => String(item || '').trim());
}

function hasMeaningfulGroundingDetails(details) {
    return !!details
        && typeof details === 'object'
        && !Array.isArray(details)
        && Object.keys(details).length > 0;
}

function renderReasonCodes(reasonCodes) {
    if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
        return '<span class="ss-hint">No reason codes.</span>';
    }
    return `<div class="ss-interpretive-review-inline-meta">${reasonCodes.map((code) => {
        const normalizedCode = String(code || '').trim();
        const label = INTERPRETIVE_REASON_CODE_LABELS.get(normalizedCode) || normalizedCode;
        return renderBadge(label, { fallback: normalizedCode || 'n/a' });
    }).join('')}</div>`;
}

function renderServerReasonList(items, emptyLabel = 'None') {
    if (!Array.isArray(items) || items.length === 0) {
        return `<span class="ss-hint">${escapeHtml(emptyLabel)}</span>`;
    }
    return `<div class="ss-interpretive-review-inline-meta">${items.map((item) => {
        const normalized = String(item || '').trim();
        const label = INTERPRETIVE_REASON_CODE_LABELS.get(normalized) || normalized;
        return renderBadge(label, { fallback: normalized || 'n/a' });
    }).join('')}</div>`;
}

function renderBlockedActionList(entries, emptyLabel = 'None') {
    if (!Array.isArray(entries) || entries.length === 0) {
        return `<span class="ss-hint">${escapeHtml(emptyLabel)}</span>`;
    }
    return `
        <div class="ss-interpretive-review-list">
            ${entries.map((entry) => `
                <div class="ss-interpretive-review-card">
                    <strong>${escapeHtml(formatSubmissionModeLabel(entry.action || ''))}</strong>
                    <div>${renderServerReasonList(entry.blockingReasons, 'None')}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderReasonCodeSelector({ conditional = false } = {}) {
    return `
        <div class="ss-interpretive-review-reason-groups"${conditional ? ' data-field="reasonCodeGroups" hidden' : ''}>
            <input type="hidden" name="reasonCodes" value="" />
            ${INTERPRETIVE_REASON_CODE_GROUPS.map((group) => `
                <section class="ss-interpretive-review-reason-group">
                    <div class="ss-interpretive-review-reason-group-header">
                        <strong>${escapeHtml(group.title)}</strong>
                        <details class="ss-interpretive-review-inline-help">
                            <summary aria-label="Explain ${escapeHtml(group.title)}">?</summary>
                            <div class="ss-interpretive-review-inline-help-body">
                                ${group.codes.map((entry) => `
                                    <div class="ss-interpretive-review-inline-help-row">
                                        <strong>${escapeHtml(entry.label)}</strong>
                                        <span>${escapeHtml(entry.description)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </details>
                    </div>
                    <div class="ss-interpretive-token-palette">
                        ${group.codes.map((entry) => `
                            <button
                                type="button"
                                class="ss-interpretive-token-button"
                                data-reason-code="${escapeHtml(entry.value)}"
                                aria-pressed="false"
                                title="${escapeHtml(entry.description)}">
                                ${escapeHtml(entry.label)}
                            </button>
                        `).join('')}
                    </div>
                </section>
            `).join('')}
            <div class="ss-hint" data-field-hint="reasonCodeGroups"></div>
        </div>
    `;
}

function renderTechnicalDetailsSection(rows, options = {}) {
    const filteredRows = Array.isArray(rows)
        ? rows.filter((row) => row && String(row.value || '').trim())
        : [];
    if (filteredRows.length === 0) {
        return '';
    }
    return renderCollapsibleSection(
        options.title || 'Technical details',
        options.description || 'Shows the exact identifiers and audit fields without crowding the main view.',
        renderKeyValueGrid(filteredRows),
        { extraClass: 'ss-interpretive-review-subsection' },
    );
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

function buildNonPublishingTooltip(formKind) {
    return formKind === 'subject'
        ? 'Saves the subject decision only. This does not publish the memory.'
        : 'Saves the review only. Approval does not publish the memory.';
}

function renderProvenance(provenance, policiesById) {
    if (!provenance) {
        return '<div class="ss-hint">No recorded provenance.</div>';
    }
    const delegationPolicy = provenance.delegationPolicyId
        ? policiesById.get(provenance.delegationPolicyId)
        : null;
    const supportingRows = [];
    if (provenance.delegationPolicyId) {
        supportingRows.push({
            label: 'Delegation policy',
            value: delegationPolicy
                ? `<code>${escapeHtml(delegationPolicy.delegationPolicyId)}</code> v${escapeHtml(String(delegationPolicy.policyVersion))} ${renderBadge(delegationPolicy.policyState)}`
                : `<code>${escapeHtml(provenance.delegationPolicyId)}</code>`,
        });
    }
    if (hasDisplayableValues(provenance.subjectEvidenceRefs)) {
        supportingRows.push({
            label: 'Evidence refs',
            value: renderStringList(provenance.subjectEvidenceRefs, 'None recorded'),
        });
    }
    return `
        ${renderKeyValueGrid([
            { label: 'Decision owner', value: `<code>${escapeHtml(provenance.dispositionOwnerId || 'n/a')}</code>` },
            { label: 'Recorded by', value: `<code>${escapeHtml(provenance.submittedByActorId || 'n/a')}</code>` },
            { label: 'How it was recorded', value: renderBadge(formatSubmissionModeLabel(provenance.submissionMode), { fallback: 'n/a' }) },
            { label: 'Recorded on', value: escapeHtml(formatTimestamp(provenance.createdAt)) },
        ])}
        ${supportingRows.length > 0 ? renderKeyValueGrid(supportingRows) : ''}
    `;
}

function buildCompactProvenanceText(provenance) {
    if (!provenance) {
        return '';
    }
    const recordedBy = formatHumanEntityLabel(provenance.submittedByActorId);
    const owner = formatHumanEntityLabel(provenance.dispositionOwnerId);
    if (provenance.submissionMode === 'TRUSTED_DELEGATE') {
        return `${recordedBy} recorded this under delegated authority for ${owner}.`;
    }
    if (provenance.submissionMode === 'SUBJECT_EXPRESSED_AND_RECORDED') {
        return `${recordedBy} recorded ${owner}'s stated response.`;
    }
    return `Submitted directly by ${recordedBy}.`;
}

function normalizeHistoryCommentary(commentary, dispositionLabel) {
    const text = String(commentary || '').trim();
    if (!text) {
        return '';
    }
    const normalizedText = text.replace(/[.!?]+$/u, '').trim().toLowerCase();
    const normalizedDisposition = String(dispositionLabel || '').trim().toLowerCase();
    if (normalizedDisposition && normalizedText === normalizedDisposition) {
        return '';
    }
    return text;
}

function renderHistoryActionCard({
    title,
    dispositionLabel,
    roleLabel = '',
    reasonCodes = [],
    commentary = '',
    provenance = null,
    timestamp = null,
    extraLines = [],
    compact = false,
    bodyHtml = '',
}) {
    const compactProvenance = buildCompactProvenanceText(provenance);
    const normalizedCommentary = normalizeHistoryCommentary(commentary, dispositionLabel);
    const filteredExtraLines = Array.isArray(extraLines)
        ? extraLines.filter((line) => String(line || '').trim())
        : [];
    return `
        <div class="ss-interpretive-review-card ss-interpretive-review-history-card">
            <div class="ss-interpretive-review-history-heading">
                <strong>${escapeHtml(title)}</strong>
                ${timestamp ? `<div class="ss-hint">${escapeHtml(formatTimestamp(timestamp))}</div>` : ''}
            </div>
            <div class="ss-interpretive-review-inline-meta${compact ? ' ss-interpretive-review-inline-meta--compact' : ''}">
                ${renderBadge(dispositionLabel || 'Submitted')}
                ${roleLabel ? renderBadge(roleLabel) : ''}
            </div>
            ${compactProvenance ? `<div class="ss-interpretive-review-summary-note">${escapeHtml(compactProvenance)}</div>` : ''}
            ${Array.isArray(reasonCodes) && reasonCodes.length > 0 ? renderReasonCodes(reasonCodes) : ''}
            ${normalizedCommentary
                ? `<div class="ss-interpretive-review-statement">${escapeHtml(normalizedCommentary)}</div>`
                : ''
            }
            ${filteredExtraLines.length > 0 ? `
                <div class="ss-interpretive-review-history-meta">
                    ${filteredExtraLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
                </div>
            ` : ''}
            ${String(bodyHtml || '').trim() ? bodyHtml : ''}
        </div>
    `;
}

function renderGroundingLinks(groundingLinks) {
    if (!Array.isArray(groundingLinks) || groundingLinks.length === 0) {
        return '<div class="ss-hint">No evidence linked yet.</div>';
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
                    ${hasMeaningfulGroundingDetails(link.details)
                        ? `<pre class="ss-interpretive-review-pre">${escapeHtml(JSON.stringify(link.details, null, 2))}</pre>`
                        : ''
                    }
                </div>
            `).join('')}
        </div>
    `;
}

function renderHistorySubmissionDetails(provenance, policiesById) {
    if (!provenance) {
        return '';
    }
    return renderTechnicalDetailsSection([
        { label: 'Disposition Owner', value: `<code>${escapeHtml(provenance.dispositionOwnerId || 'n/a')}</code>` },
        { label: 'Recorded By', value: `<code>${escapeHtml(provenance.submittedByActorId || 'n/a')}</code>` },
        { label: 'Submission Mode', value: renderBadge(formatSubmissionModeLabel(provenance.submissionMode), { fallback: 'n/a' }) },
        { label: 'Recorded At', value: escapeHtml(formatTimestamp(provenance.createdAt)) },
        ...(provenance.delegationPolicyId
            ? [{
                label: 'Delegation Policy',
                value: policiesById.has(provenance.delegationPolicyId)
                    ? `<code>${escapeHtml(provenance.delegationPolicyId)}</code> v${escapeHtml(String(policiesById.get(provenance.delegationPolicyId)?.policyVersion || ''))}`
                    : `<code>${escapeHtml(provenance.delegationPolicyId)}</code>`,
            }]
            : []),
        ...(hasDisplayableValues(provenance.subjectEvidenceRefs)
            ? [{
                label: 'Subject Evidence References',
                value: renderStringList(provenance.subjectEvidenceRefs, 'None recorded'),
            }]
            : []),
    ], {
        title: 'Submission details',
        description: 'Shows the exact recorded provenance for this action.',
    });
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
        return '<div class="ss-hint">No delegation policies referenced here.</div>';
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
        return '<option value="">No active policy matches</option>';
    }
    if (items.length === 1) {
        const [policy] = items;
        return `
            <option value="${escapeHtml(policy.delegationPolicyId)}" selected>
                ${escapeHtml(`${policy.delegationPolicyId} v${policy.policyVersion} [Evidence ${policy.evidenceRequirement}]`)}
            </option>
        `;
    }
    return [
        '<option value="">Choose a delegation policy</option>',
        ...items.map((policy) => `
            <option value="${escapeHtml(policy.delegationPolicyId)}">
                ${escapeHtml(`${policy.delegationPolicyId} v${policy.policyVersion} [Evidence ${policy.evidenceRequirement}]`)}
            </option>
        `),
    ].join('');
}

function buildPublicationPolicyOptions(policies = [], selectedPolicyId = '') {
    const items = Array.isArray(policies) ? policies : [];
    if (items.length === 0) {
        return '<option value="">No active policy matches</option>';
    }
    return items.map((policy, index) => {
        const isSelected = selectedPolicyId
            ? policy.publicationPolicyId === selectedPolicyId
            : index === 0;
        return `
            <option value="${escapeHtml(policy.publicationPolicyId)}"${isSelected ? ' selected' : ''}>
                ${escapeHtml(`${policy.publicationPolicyId} v${policy.policyVersion} [${policy.policyState}]`)}
            </option>
        `;
    }).join('');
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

function collectAutoSubjectEvidenceRefs(interpretation) {
    const groundingLinks = Array.isArray(interpretation?.groundingLinks) ? interpretation.groundingLinks : [];
    return [...new Set(
        groundingLinks
            .map((link) => String(link?.messageId || '').trim())
            .filter(Boolean),
    )];
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
    const autoSubjectEvidenceRefs = collectAutoSubjectEvidenceRefs(interpretation);
    const hasAutoSubjectEvidenceRefs = autoSubjectEvidenceRefs.length > 0;
    const modeOptions = getInterpretiveSubmissionModeOptions({
        ownerId,
        memorySubjectId: interpretation.memorySubjectId,
        hasAutoSubjectEvidenceRefs,
    });
    const defaultMode = resolveDefaultInterpretiveSubmissionMode({
        ownerId,
        memorySubjectId: interpretation.memorySubjectId,
        currentActorId,
        actionKind,
        memoryScopeId: interpretation.memoryScopeId,
        continuityTargetId: interpretation.memorySubjectId,
        policies,
        hasAutoSubjectEvidenceRefs,
    });
    const defaultActorId = getDefaultActorForMode(defaultMode, ownerId, currentActorId);
    const applicablePolicies = filterDelegationPoliciesForAction(policies, {
        principalEntityId: ownerId,
        delegateEntityId: defaultActorId,
        actionKind,
        memoryScopeId: interpretation.memoryScopeId,
        continuityTargetId: interpretation.memorySubjectId,
    });
    const hasApplicablePolicies = applicablePolicies.length > 0;
    const governedFieldState = getGovernedFieldState({
        submissionMode: defaultMode,
        hasApplicablePolicies,
        hasAutoSubjectEvidenceRefs,
    });
    const safeReviewOptions = REVIEW_DISPOSITION_OPTIONS
        .filter((entry) => !['APPROVE_FOR_SCOPE_ONLY', 'CONTEST', 'DEFER'].includes(entry.value));
    const safeSubjectOptions = SUBJECT_DISPOSITION_OPTIONS
        .filter((entry) => !['CONTESTED', 'DEFERRED'].includes(entry.value));
    const selectOptions = formKind === 'review'
        ? (reviewRequest?.reviewerRole === 'MEMORY_SUBJECT'
            ? safeReviewOptions
            : safeReviewOptions.filter((entry) => entry.value !== 'APPROVE_WITH_EDIT'))
        : safeSubjectOptions;
    const defaultDispositionValue = selectOptions[0]?.value || '';
    const submitLabel = formKind === 'review'
        ? 'Submit Review'
        : 'Submit Decision';
    const submitTooltip = buildNonPublishingTooltip(formKind);

    return `
        <div class="ss-interpretive-review-card ss-interpretive-action-card">
            ${renderActionStatus(actionStatus, formKind)}
            <form class="ss-interpretive-action-form"
                data-form-kind="${escapeHtml(formKind)}"
                data-action-kind="${escapeHtml(actionKind)}"
                data-owner-id="${escapeHtml(ownerId)}"
                data-owner-role-label="${escapeHtml(ownerRoleLabel)}"
                data-memory-scope-id="${escapeHtml(interpretation.memoryScopeId || '')}"
                data-memory-subject-id="${escapeHtml(interpretation.memorySubjectId || '')}"
                data-continuity-target-id="${escapeHtml(interpretation.memorySubjectId || '')}"
                data-has-auto-subject-evidence-refs="${hasAutoSubjectEvidenceRefs ? 'true' : 'false'}"
                data-auto-subject-evidence-refs="${escapeHtml(autoSubjectEvidenceRefs.join('\n'))}"
                data-interpretation-revision-id="${escapeHtml(interpretation.interpretationRevisionId)}"
                data-review-envelope-hash="${escapeHtml(reviewRequest?.reviewEnvelopeHash || interpretation.reviewEnvelopeHash || '')}"
                data-review-request-id="${escapeHtml(reviewRequest?.reviewRequestId || '')}"
                data-parent-statement="${escapeHtml(interpretation.statement || '')}"
                data-default-actor-id="${escapeHtml(currentActorId || '')}">
                <input type="hidden" name="submittedByActorId" value="${escapeHtml(defaultActorId)}" />

                <div class="ss-interpretive-review-form-grid">
                    <label class="ss-interpretive-review-field">
                        <span>Decision</span>
                        <select class="text_pole" name="${formKind === 'review' ? 'disposition' : 'state'}">
                            ${selectOptions.map((entry) => `
                                <option value="${escapeHtml(entry.value)}"${entry.value === defaultDispositionValue ? ' selected' : ''}>${escapeHtml(entry.label)}</option>
                            `).join('')}
                        </select>
                    </label>

                    <label class="ss-interpretive-review-field">
                        <span>Recording mode</span>
                        <select class="text_pole" name="submissionMode">
                            ${renderSubmissionModeOptions(modeOptions, defaultMode)}
                        </select>
                    </label>

                    <label class="ss-interpretive-review-field" data-field="delegationPolicyId"${defaultMode === 'TRUSTED_DELEGATE' && hasApplicablePolicies ? '' : ' hidden'}>
                        <span>Delegation policy</span>
                        <select class="text_pole" name="delegationPolicyId">
                            ${buildDelegationPolicyOptions(applicablePolicies)}
                        </select>
                        <span class="ss-hint">Trusted delegation needs a matching active policy.</span>
                    </label>

                    <div class="ss-interpretive-review-field ss-interpretive-review-static-note" data-field="delegationPolicyUnavailable"${defaultMode === 'TRUSTED_DELEGATE' && !hasApplicablePolicies ? '' : ' hidden'}>
                        <span>Delegation policy</span>
                        <span class="ss-hint">No matching active delegation policy is available for this action. Use a direct mode or add a policy first.</span>
                    </div>
                </div>

                <label class="ss-interpretive-review-field" data-field="subjectEvidenceRefs"${governedFieldState.showEvidenceField ? '' : ' hidden'}>
                    <span>Subject Evidence References</span>
                    <textarea class="text_pole" rows="2" name="subjectEvidenceRefs" placeholder="One reference per line or comma-separated">${escapeHtml(autoSubjectEvidenceRefs.join('\n'))}</textarea>
                    <span class="ss-hint" data-field-hint="subjectEvidenceRefs">
                        ${escapeHtml(governedFieldState.evidenceHint)}
                    </span>
                </label>

                ${renderReasonCodeSelector({ conditional: true })}

                <label class="ss-interpretive-review-field ss-interpretive-review-comment-field">
                    <span data-field-label="commentary">Comment</span>
                    <textarea class="text_pole" rows="3" name="commentary" placeholder="Optional notes or context."></textarea>
                    <span class="ss-hint" data-field-hint="commentary"></span>
                </label>

                ${formKind === 'review' ? `
                    <div class="ss-interpretive-review-section" data-field="revisedCandidate"${shouldShowInterpretiveRevisionEditor(formKind, defaultDispositionValue) ? '' : ' hidden'}>
                        <h4>Child revision</h4>
                        <div class="ss-hint">This records the review on the parent revision and creates a new child revision for the next step.</div>
                        <div class="ss-interpretive-review-card">
                            <strong>Parent statement</strong>
                            <div class="ss-interpretive-review-statement">${escapeHtml(interpretation.statement || '')}</div>
                        </div>
                        <label class="ss-interpretive-review-field">
                            <span>Child statement</span>
                            <textarea class="text_pole" rows="5" name="revisedStatement" placeholder="Enter the narrower approved statement.">${escapeHtml(interpretation.statement || '')}</textarea>
                        </label>
                    </div>
                ` : ''}

                <div class="ss-interpretive-review-form-actions">
                    <input class="menu_button" type="submit" value="${escapeHtml(submitLabel)}" title="${escapeHtml(submitTooltip)}" />
                </div>
            </form>
        </div>
    `;
}

function renderPublicationActionForm({
    formKind,
    title,
    description = '',
    actionStatus = null,
    fieldsHtml = '',
    submitLabel,
    dataset = {},
    disabled = false,
}) {
    const attributes = Object.entries(dataset)
        .map(([key, value]) => `data-${escapeHtml(key)}="${escapeHtml(String(value ?? ''))}"`)
        .join(' ');
    return `
        <div class="ss-interpretive-review-card ss-interpretive-action-card">
            <strong>${escapeHtml(title)}</strong>
            ${description ? `<div class="ss-hint">${escapeHtml(description)}</div>` : ''}
            ${renderActionStatus(actionStatus, formKind)}
            <form class="ss-interpretive-action-form" data-form-kind="${escapeHtml(formKind)}" ${attributes}>
                ${fieldsHtml}
                <div class="ss-interpretive-review-form-actions">
                    <input class="menu_button" type="submit" value="${escapeHtml(submitLabel)}"${disabled ? ' disabled' : ''} />
                </div>
            </form>
        </div>
    `;
}

function renderLifecycleGovernanceForm({
    formKind,
    title,
    description = '',
    actionKind,
    ownerId,
    interpretation,
    currentActorId,
    policies = [],
    actionStatus = null,
    extraFieldsHtml = '',
    submitLabel,
    dataset = {},
}) {
    const autoSubjectEvidenceRefs = collectAutoSubjectEvidenceRefs(interpretation);
    const hasAutoSubjectEvidenceRefs = autoSubjectEvidenceRefs.length > 0;
    const modeOptions = getInterpretiveSubmissionModeOptions({
        ownerId,
        memorySubjectId: interpretation.memorySubjectId,
        hasAutoSubjectEvidenceRefs,
    });
    const defaultMode = resolveDefaultInterpretiveSubmissionMode({
        ownerId,
        memorySubjectId: interpretation.memorySubjectId,
        currentActorId,
        actionKind,
        memoryScopeId: interpretation.memoryScopeId,
        continuityTargetId: interpretation.memorySubjectId,
        policies,
        hasAutoSubjectEvidenceRefs,
    });
    const defaultActorId = getDefaultActorForMode(defaultMode, ownerId, currentActorId);
    const applicablePolicies = filterDelegationPoliciesForAction(policies, {
        principalEntityId: ownerId,
        delegateEntityId: defaultActorId,
        actionKind,
        memoryScopeId: interpretation.memoryScopeId,
        continuityTargetId: interpretation.memorySubjectId,
    });
    const hasApplicablePolicies = applicablePolicies.length > 0;
    const governedFieldState = getGovernedFieldState({
        submissionMode: defaultMode,
        hasApplicablePolicies,
        hasAutoSubjectEvidenceRefs,
    });
    const attributes = Object.entries(dataset)
        .map(([key, value]) => `data-${escapeHtml(key)}="${escapeHtml(String(value ?? ''))}"`)
        .join(' ');

    return `
        <div class="ss-interpretive-review-card ss-interpretive-action-card">
            <strong>${escapeHtml(title)}</strong>
            ${description ? `<div class="ss-hint">${escapeHtml(description)}</div>` : ''}
            ${renderActionStatus(actionStatus, formKind)}
            <form class="ss-interpretive-action-form"
                data-form-kind="${escapeHtml(formKind)}"
                data-action-kind="${escapeHtml(actionKind)}"
                data-owner-id="${escapeHtml(ownerId)}"
                data-memory-scope-id="${escapeHtml(interpretation.memoryScopeId || '')}"
                data-memory-subject-id="${escapeHtml(interpretation.memorySubjectId || '')}"
                data-continuity-target-id="${escapeHtml(interpretation.memorySubjectId || '')}"
                data-has-auto-subject-evidence-refs="${hasAutoSubjectEvidenceRefs ? 'true' : 'false'}"
                data-auto-subject-evidence-refs="${escapeHtml(autoSubjectEvidenceRefs.join('\n'))}"
                ${attributes}>
                ${renderKeyValueGrid([
                    { label: 'Decision owner', value: `<code>${escapeHtml(ownerId)}</code>` },
                    { label: 'Recording mode', value: `<select class="text_pole" name="submissionMode">${renderSubmissionModeOptions(modeOptions, defaultMode)}</select>` },
                    { label: 'Recorded by', value: `<input type="hidden" name="submittedByActorId" value="${escapeHtml(defaultActorId)}" /><code>${escapeHtml(defaultActorId)}</code>` },
                ])}

                <div class="ss-interpretive-review-form-grid">
                    <label class="ss-interpretive-review-field" data-field="delegationPolicyId"${defaultMode === 'TRUSTED_DELEGATE' && hasApplicablePolicies ? '' : ' hidden'}>
                        <span>Delegation policy</span>
                        <select class="text_pole" name="delegationPolicyId">
                            ${buildDelegationPolicyOptions(applicablePolicies)}
                        </select>
                        <span class="ss-hint">Trusted delegation locks to the exact policy version and hash on submit.</span>
                    </label>

                    <div class="ss-interpretive-review-field ss-interpretive-review-static-note" data-field="delegationPolicyUnavailable"${defaultMode === 'TRUSTED_DELEGATE' && !hasApplicablePolicies ? '' : ' hidden'}>
                        <span>Delegation policy</span>
                        <span class="ss-hint">No matching active delegation policy is available for this action. Use a direct mode or add a policy first.</span>
                    </div>
                </div>

                <label class="ss-interpretive-review-field" data-field="subjectEvidenceRefs"${governedFieldState.showEvidenceField ? '' : ' hidden'}>
                    <span>Subject Evidence References</span>
                    <textarea class="text_pole" rows="2" name="subjectEvidenceRefs" placeholder="One reference per line or comma-separated">${escapeHtml(autoSubjectEvidenceRefs.join('\n'))}</textarea>
                    <span class="ss-hint" data-field-hint="subjectEvidenceRefs">
                        ${escapeHtml(governedFieldState.evidenceHint)}
                    </span>
                </label>

                ${extraFieldsHtml}

                ${renderReasonCodeSelector()}

                <label class="ss-interpretive-review-field ss-interpretive-review-comment-field">
                    <span>Comment</span>
                    <textarea class="text_pole" rows="3" name="commentary" placeholder="Add any notes or context."></textarea>
                </label>

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
        return '<div class="ss-hint">No review requests yet.</div>';
    }
    return `
        <div class="ss-interpretive-review-list">
            ${requests.map((request) => {
                const disposition = dispositionsByRequestId.get(request.reviewRequestId) || null;
                const showForm = request.reviewRequestId === selectedReviewRequestId && request.status === 'PENDING';
                const ownerRoleLabel = request.reviewerEntityId === interpretation.memorySubjectId
                    ? 'Context owner'
                    : 'Relational participant';
                return `
                    <div class="ss-interpretive-review-card">
                        <strong>${escapeHtml(request.reviewerRole || 'Reviewer')}</strong>
                        <div class="ss-interpretive-review-inline-meta">
                            ${renderBadge(request.status)}
                            <code>${escapeHtml(request.reviewerEntityId || 'n/a')}</code>
                        </div>
                        <div class="ss-hint">Requested ${escapeHtml(formatTimestamp(request.createdAt))}</div>
                        <div class="ss-hint">Envelope <code>${escapeHtml(request.reviewEnvelopeHash || 'n/a')}</code></div>
                        ${disposition ? `
                            <div class="ss-interpretive-review-section">
                                <h4>Decision</h4>
                                <div class="ss-interpretive-review-inline-meta">
                                    ${renderBadge(disposition.disposition)}
                                </div>
                                ${renderReasonCodes(disposition.reasonCodes)}
                                <div class="ss-interpretive-review-statement">${escapeHtml(disposition.commentary || '(no commentary)')}</div>
                                <div class="ss-hint">Submitted ${escapeHtml(formatTimestamp(disposition.submittedAt))}</div>
                                ${renderProvenance(disposition.provenance, policiesById)}
                            </div>
                        ` : '<div class="ss-hint">No decision has been submitted.</div>'}
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
    ` : '<div class="ss-hint">No subject decision has been recorded.</div>';

    const blocked = pendingRequests.length > 0
        || interpretation.reviewState === 'BLOCKED'
        || interpretation.reviewState === 'PENDING'
        || interpretation.reviewState === 'DEFERRED';

    const supersededByChild = !blocked
        && !interpretation.subjectDisposition
        && Array.isArray(interpretation.childRevisionIds)
        && interpretation.childRevisionIds.length > 0;

    const formHtml = interpretation.subjectDisposition
        ? '<div class="ss-hint">The subject decision is already recorded for this revision. Any further subject action needs a new governed revision or lifecycle step, not an overwrite.</div>'
        : blocked
        ? '<div class="ss-hint">The subject decision is still blocked until every required review is complete.</div>'
        : supersededByChild
            ? '<div class="ss-hint">The decision moved to the child revision created by Approve with edit. Review that revision instead of changing the parent.</div>'
            : renderActionForm({
            formKind: 'subject',
            ownerId: interpretation.memorySubjectId,
            ownerRoleLabel: 'Context owner',
            actionKind: 'SUBJECT_DISPOSITION',
            interpretation,
            currentActorId,
            policies: [...policiesById.values()],
            actionStatus,
        });

    return `
        ${subjectDispositionHtml}
        <div class="ss-interpretive-review-section">
            <h4>Record subject decision</h4>
            ${formHtml}
        </div>
    `;
}

function renderPublicationPolicyCards(policies) {
    if (!Array.isArray(policies) || policies.length === 0) {
        return '<div class="ss-hint">No active publication policy matches this interpretation type.</div>';
    }
    return `
        <div class="ss-interpretive-review-list">
            ${policies.map((policy) => `
                <div class="ss-interpretive-review-card">
                    <strong><code>${escapeHtml(policy.publicationPolicyId)}</code> v${escapeHtml(String(policy.policyVersion))}</strong>
                    <div class="ss-interpretive-review-inline-meta">
                        ${renderBadge(policy.policyState)}
                        ${renderBadge(policy.continuityTargetType)}
                    </div>
                    <div>Required Final Subject State: ${renderBadge(policy.requiredFinalSubjectState)}</div>
                    <div>Required Grounding Outcome: ${renderBadge(policy.requiredGroundingOutcome)}</div>
                    <div>Permitted Types: ${renderStringList(policy.permittedInterpretationTypes, 'None')}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderQualificationCard(qualification) {
    if (!qualification) {
        return '<div class="ss-hint">No qualification has been recorded yet.</div>';
    }
    const refusalCodes = Array.isArray(qualification.refusalCodes) ? qualification.refusalCodes : [];
    return `
        <div class="ss-interpretive-review-card">
            <strong>Latest qualification</strong>
            ${renderKeyValueGrid([
                { label: 'Verdict', value: renderBadge(qualification.eligibilityVerdict) },
                { label: 'Policy', value: `<code>${escapeHtml(qualification.publicationPolicyId)}</code> v${escapeHtml(String(qualification.policyVersion))}` },
                { label: 'Continuity Target', value: `<code>${escapeHtml(qualification.continuityTargetId || 'n/a')}</code>` },
                { label: 'Evaluated At', value: escapeHtml(formatTimestamp(qualification.evaluatedAt)) },
            ])}
            ${refusalCodes.length > 0 ? `
                <div><strong>Refusal reasons</strong></div>
                <div>${renderServerReasonList(refusalCodes, 'No refusal codes.')}</div>
            ` : ''}
            ${renderTechnicalDetailsSection([
                { label: 'Qualification ID', value: `<code>${escapeHtml(qualification.qualificationId)}</code>` },
                { label: 'Grounding Binding', value: renderBadge(qualification.binding?.groundingBindingMode || 'n/a') },
                { label: 'Grounding Protocol', value: escapeHtml(String(qualification.binding?.groundingProtocolVersion ?? 'n/a')) },
            ])}
        </div>
    `;
}

function renderAuthorizationCard(authorization) {
    if (!authorization) {
        return '<div class="ss-hint">No publication authorization has been recorded yet.</div>';
    }
    return `
        <div class="ss-interpretive-review-card">
            <strong>Latest authorization</strong>
            ${renderKeyValueGrid([
                { label: 'Status', value: renderBadge(authorization.status) },
                { label: 'Authorized By', value: `<code>${escapeHtml(authorization.authorizedBy || 'n/a')}</code>` },
                { label: 'Authorized At', value: escapeHtml(formatTimestamp(authorization.authorizedAt)) },
                { label: 'Expires At', value: escapeHtml(formatTimestamp(authorization.expiresAt)) },
            ])}
            ${renderTechnicalDetailsSection([
                { label: 'Authorization ID', value: `<code>${escapeHtml(authorization.publicationAuthorizationId)}</code>` },
                { label: 'Nonce', value: `<code>${escapeHtml(authorization.authorizationNonce || 'n/a')}</code>` },
                { label: 'Published Record', value: authorization.dnmRecordId ? `<code>${escapeHtml(authorization.dnmRecordId)}</code>` : '' },
            ])}
        </div>
    `;
}

function renderDnmRecordCard(record, options = {}) {
    const statusBadges = [
        renderBadge(record.publicationState),
        renderBadge(record.lifecycleState),
    ];
    if (record.deltaReviewState && record.deltaReviewState !== 'NONE') {
        statusBadges.push(renderBadge(record.deltaReviewState));
    }
    const rows = [
        { label: 'Published At', value: escapeHtml(formatTimestamp(record.publishedAt)) },
    ];
    const availableActions = Array.isArray(record.operatorState?.availableActions) ? record.operatorState.availableActions : [];
    const blockedActions = Array.isArray(record.operatorState?.blockedActions) ? record.operatorState.blockedActions : [];
    const blockingReasons = Array.isArray(record.operatorState?.blockingReasons) ? record.operatorState.blockingReasons : [];
    return `
        <div class="ss-interpretive-review-card">
            <strong>${escapeHtml(options.compact ? 'Previous continuity record' : 'Current continuity record')}</strong>
            <div class="ss-interpretive-review-inline-meta">${statusBadges.join('')}</div>
            ${renderKeyValueGrid(rows)}
            <div class="ss-interpretive-review-statement">${escapeHtml(record.publishedStatement || '(no statement)')}</div>
            ${renderTechnicalDetailsSection([
                { label: 'DNM Record ID', value: `<code>${escapeHtml(record.dnmRecordId)}</code>` },
                { label: 'Source Revision', value: `<code>${escapeHtml(record.sourceInterpretationRevisionId || 'n/a')}</code>` },
                { label: 'Continuity Target', value: options.showContinuityTarget ? `<code>${escapeHtml(record.continuityTargetId || 'n/a')}</code>` : '' },
                { label: 'Supersedes', value: record.supersedesDnmRecordId ? `<code>${escapeHtml(record.supersedesDnmRecordId)}</code>` : '' },
                { label: 'Superseded By', value: record.supersededByDnmRecordId ? `<code>${escapeHtml(record.supersededByDnmRecordId)}</code>` : '' },
                { label: 'Authorization', value: options.showAuthorization ? `<code>${escapeHtml(record.publicationAuthorizationId || 'n/a')}</code>` : '' },
            ])}
            ${options.showOperatorState && availableActions.length > 0 ? `
                <div><strong>Available actions</strong></div>
                <div>${renderServerReasonList(availableActions, 'None')}</div>
            ` : ''}
            ${options.showOperatorState && blockedActions.length > 0 ? `
                <div><strong>Blocked actions</strong></div>
                <div>${renderBlockedActionList(blockedActions, 'None')}</div>
            ` : ''}
            ${options.showOperatorState && blockingReasons.length > 0 ? `
                <div><strong>Blocking reasons</strong></div>
                <div>${renderServerReasonList(blockingReasons, 'None')}</div>
            ` : ''}
            ${Array.isArray(record.deltaReviews) && record.deltaReviews.length > 0 ? `
                <div class="ss-interpretive-review-section">
                    <h4>Delta Reviews</h4>
                    <div class="ss-interpretive-review-list">
                        ${record.deltaReviews.map((review) => `
                            <div class="ss-interpretive-review-card">
                                <strong><code>${escapeHtml(review.deltaReviewId)}</code></strong>
                                <div class="ss-interpretive-review-inline-meta">
                                    ${renderBadge(review.deltaState)}
                                    ${renderBadge(review.provenance?.submissionMode || 'n/a')}
                                </div>
                                ${renderReasonCodes(review.reasonCodes)}
                                <div class="ss-interpretive-review-statement">${escapeHtml(review.commentary || '(no commentary)')}</div>
                                ${renderProvenance(review.provenance, new Map())}
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

function renderPublicationOperatorSection(interpretation, operatorState, policiesById, options = {}) {
    if (!operatorState) {
        return '<div class="ss-hint">Publication and continuity details are unavailable for this candidate.</div>';
    }

    const matchingPolicies = Array.isArray(operatorState.matchingPolicies) ? operatorState.matchingPolicies : [];
    const recordsForTarget = Array.isArray(operatorState.recordsForTarget) ? operatorState.recordsForTarget : [];
    const activeRecord = operatorState.currentActiveRecord || null;
    const lineageRecords = activeRecord
        ? recordsForTarget.filter((record) => record.dnmRecordId !== activeRecord.dnmRecordId)
        : recordsForTarget;
    const continuityTargetId = operatorState.continuityTargetId || interpretation.memorySubjectId;
    const latestEligibleQualification = operatorState.latestQualification?.eligibilityVerdict === 'ELIGIBLE'
        ? operatorState.latestQualification
        : null;
    const latestAuthorized = operatorState.latestAuthorization?.status === 'AUTHORIZED'
        ? operatorState.latestAuthorization
        : null;
    const canQualify = operatorState.availableActions?.includes('QUALIFY_PUBLICATION') === true;
    const canAuthorize = operatorState.availableActions?.includes('AUTHORIZE_PUBLICATION') === true;
    const canExecute = operatorState.availableActions?.includes('EXECUTE_PUBLICATION') === true;
    const canWithdrawActive = activeRecord?.operatorState?.availableActions?.includes('WITHDRAW_DNM') === true;
    const governancePolicies = [...policiesById.values()];
    const operatorAvailableActions = getVisibleOperatorActions(interpretation, operatorState);
    const operatorBlockedActions = Array.isArray(operatorState.blockedActions) ? operatorState.blockedActions : [];
    const operatorBlockingReasons = Array.isArray(operatorState.blockingReasons) ? operatorState.blockingReasons : [];

    return `
        ${renderCollapsibleSection(
            'Active Memory Record',
            '',
            activeRecord ? `
                ${renderDnmRecordCard(activeRecord, {
                    showContinuityTarget: true,
                    showAuthorization: true,
                })}
                ${canWithdrawActive ? renderLifecycleGovernanceForm({
                    formKind: 'dnm-withdraw',
                    title: 'Withdraw Current Memory',
                    description: '',
                    actionKind: 'DNM_WITHDRAWAL',
                    ownerId: interpretation.memorySubjectId,
                    interpretation,
                    currentActorId: options.currentActorId,
                    policies: governancePolicies,
                    actionStatus: options.actionStatus,
                    submitLabel: 'Withdraw Current Memory',
                    dataset: {
                        dnmRecordId: activeRecord.dnmRecordId,
                    },
                }) : ''}
            ` : '<div class="ss-hint">No active DNM record exists for this continuity target.</div>',
            { open: !!activeRecord || canWithdrawActive },
        )}

        ${renderCollapsibleSection(
            'Publication status',
            'Shows where this revision sits between grant, qualification, authorization, publication, and active continuity.',
            `
                ${renderKeyValueGrid([
                    { label: 'Granted', value: renderBadge(interpretation.subjectDispositionState || 'NONE') },
                    { label: 'Qualified', value: renderBadge(operatorState.latestQualification?.eligibilityVerdict || 'UNQUALIFIED') },
                    { label: 'Authorized', value: renderBadge(operatorState.latestAuthorization?.status || 'UNAUTHORIZED') },
                    { label: 'Published', value: renderBadge(interpretation.publicationState || 'NOT_PUBLISHED') },
                    { label: 'Current Active DNM', value: renderBadge(activeRecord?.lifecycleState || 'NONE') },
                    { label: 'Continuity Target', value: `<code>${escapeHtml(continuityTargetId || 'n/a')}</code>` },
                ])}
                ${operatorAvailableActions.length > 0 ? `
                    <div><strong>Available actions</strong></div>
                    <div>${renderServerReasonList(operatorAvailableActions, 'None')}</div>
                ` : ''}
                ${operatorBlockedActions.length > 0 ? `
                    <div><strong>Blocked actions</strong></div>
                    <div>${renderBlockedActionList(operatorBlockedActions, 'None')}</div>
                ` : ''}
                ${operatorBlockingReasons.length > 0 ? `
                    <div><strong>Blocking reasons</strong></div>
                    <div>${renderServerReasonList(operatorBlockingReasons, 'None')}</div>
                ` : ''}
            `,
            { open: !activeRecord && !canQualify && !canAuthorize && !canExecute },
        )}

        ${renderCollapsibleSection(
            'Eligibility',
            'Shows the eligibility snapshot for this revision against one policy and one continuity target.',
            `
                ${renderQualificationCard(operatorState.latestQualification)}
                ${renderPublicationActionForm({
                    formKind: 'publication-qualify',
                    title: 'Check Eligibility',
                    description: 'Check whether this revision can be published.',
                    actionStatus: options.actionStatus,
                    submitLabel: 'Check Eligibility',
                    disabled: !canQualify,
                    dataset: {
                        interpretationRevisionId: interpretation.interpretationRevisionId,
                        proposalContentHash: interpretation.proposalContentHash || '',
                        reviewEnvelopeHash: interpretation.reviewEnvelopeHash || '',
                        subjectDispositionRecordId: interpretation.subjectDisposition?.subjectDispositionId || '',
                    },
                    fieldsHtml: `
                        <label class="ss-interpretive-review-field">
                            <span>Publication policy</span>
                            <select class="text_pole" name="publicationPolicyId">
                                ${buildPublicationPolicyOptions(matchingPolicies, operatorState.latestQualification?.publicationPolicyId || '')}
                            </select>
                        </label>
                        <label class="ss-interpretive-review-field">
                            <span>Continuity Target</span>
                            <input class="text_pole" type="text" name="continuityTargetId" value="${escapeHtml(continuityTargetId || '')}" readonly />
                        </label>
                    `,
                })}
            `,
            { open: canQualify },
        )}

        ${renderCollapsibleSection(
            'Authorization',
            'Shows whether a one-time publication authorization exists, has been used, or is still missing.',
            `
                ${renderAuthorizationCard(operatorState.latestAuthorization)}
                ${renderPublicationActionForm({
                    formKind: 'publication-authorize',
                    title: 'Authorize Publication',
                    description: 'Issue a one-time authorization for the latest eligible revision.',
                    actionStatus: options.actionStatus,
                    submitLabel: 'Authorize Publication',
                    disabled: !(latestEligibleQualification && canAuthorize),
                    dataset: {
                        qualificationId: latestEligibleQualification?.qualificationId || '',
                    },
                    fieldsHtml: `
                        <label class="ss-interpretive-review-field">
                            <span>Qualification</span>
                            <input class="text_pole" type="text" value="${escapeHtml(latestEligibleQualification?.qualificationId || 'No eligible qualification')}" readonly />
                        </label>
                        <label class="ss-interpretive-review-field">
                            <span>Authorized By</span>
                            <input class="text_pole" type="text" name="authorizedBy" value="${escapeHtml(options.currentActorId || '')}" readonly />
                        </label>
                        <label class="ss-interpretive-review-field">
                            <span>Expires At</span>
                            <input class="text_pole" type="datetime-local" name="expiresAt" value="${escapeHtml(formatDateTimeLocalValue(Date.now() + 60 * 60 * 1000))}" />
                        </label>
                    `,
                })}
                ${renderPublicationActionForm({
                    formKind: 'publication-execute',
                    title: 'Publish',
                    description: 'Publish this revision to active memory.',
                    actionStatus: options.actionStatus,
                    submitLabel: 'Publish',
                    disabled: !(latestAuthorized && canExecute),
                    dataset: {
                        publicationAuthorizationId: latestAuthorized?.publicationAuthorizationId || '',
                    },
                    fieldsHtml: `
                        <label class="ss-interpretive-review-field">
                            <span>Authorization</span>
                            <input class="text_pole" type="text" value="${escapeHtml(latestAuthorized?.publicationAuthorizationId || 'No active authorization')}" readonly />
                        </label>
                    `,
                })}
            `,
            { open: canAuthorize || canExecute },
        )}

        ${renderCollapsibleSection(
            'Continuity history',
            'Keeps publication, supersession, withdrawal, and delta-review history visible instead of flattening everything into one state.',
            lineageRecords.length > 0 ? `
                <div class="ss-interpretive-review-list">
                    ${lineageRecords.map((record) => `
                        ${renderDnmRecordCard(record, { compact: true })}
                        ${record.operatorState?.availableActions?.includes('SUPERSEDE_ACTIVE_WITH_RECORD') ? renderLifecycleGovernanceForm({
                            formKind: 'dnm-supersede',
                            title: 'Replace active record with this one',
                            description: 'Promote this delta-pending record into active continuity while keeping the prior history intact.',
                            actionKind: 'DNM_SUPERSESSION',
                            ownerId: interpretation.memorySubjectId,
                            interpretation,
                            currentActorId: options.currentActorId,
                            policies: governancePolicies,
                            actionStatus: options.actionStatus,
                            submitLabel: 'Replace active record',
                            dataset: {
                                priorDnmRecordId: activeRecord?.dnmRecordId || '',
                                replacementDnmRecordId: record.dnmRecordId,
                            },
                        }) : ''}
                    `).join('')}
                </div>
            ` : '<div class="ss-hint">No DNM publication records exist for this continuity target.</div>',
        )}

        ${renderCollapsibleSection(
            'Publication policy',
            'Explains the policy layer that decides whether a granted interpretation may enter continuity.',
            renderPublicationPolicyCards(matchingPolicies),
        )}
    `;
}

function buildQueueGroups(reviews) {
    const groups = [];
    const groupsByRevisionId = new Map();

    for (const review of Array.isArray(reviews) ? reviews : []) {
        const revisionId = String(review?.interpretationRevisionId || '').trim();
        if (!revisionId) {
            continue;
        }
        let group = groupsByRevisionId.get(revisionId) || null;
        if (!group) {
            group = {
                interpretationRevisionId: revisionId,
                reviews: [],
            };
            groupsByRevisionId.set(revisionId, group);
            groups.push(group);
        }
        group.reviews.push(review);
    }

    return groups;
}

function summarizeQueueGroupStatus(reviews) {
    const normalized = (Array.isArray(reviews) ? reviews : []).map((review) => String(review?.status || '').trim().toUpperCase());
    if (normalized.some((value) => value === 'PENDING')) return 'Decision required';
    if (normalized.some((value) => value === 'CONTESTED')) return 'Contested';
    if (normalized.some((value) => value === 'DEFERRED')) return 'Deferred';
    if (normalized.some((value) => value === 'REJECTED')) return 'Rejected';
    if (normalized.length > 0 && normalized.every((value) => value === 'APPROVED')) return 'Review complete';
    return normalized.length > 0 ? formatHumanStateLabel(normalized[0]) : 'Pending';
}

function getQueueGroupRepresentativeReview(reviews) {
    const items = Array.isArray(reviews) ? reviews : [];
    return items.find((review) => String(review?.status || '').trim().toUpperCase() === 'PENDING')
        || items[0]
        || null;
}

function renderQueueGroupItem(group, selectedReviewRequestId, selectedInterpretationRevisionId) {
    const reviews = Array.isArray(group?.reviews) ? group.reviews : [];
    const representativeReview = getQueueGroupRepresentativeReview(reviews);
    if (!representativeReview) {
        return '';
    }
    const summaryStatus = summarizeQueueGroupStatus(reviews);
    const createdAt = reviews.reduce((earliest, review) => {
        const created = Number(review?.createdAt || 0);
        if (!Number.isFinite(created) || created <= 0) {
            return earliest;
        }
        return earliest === null ? created : Math.min(earliest, created);
    }, null);

    const groupSelected = String(group.interpretationRevisionId || '') === String(selectedInterpretationRevisionId || '')
        || reviews.some((review) => review.reviewRequestId === selectedReviewRequestId);

    return `
        <div
            class="ss-interpretive-review-item ss-interpretive-review-group-item${groupSelected ? ' active' : ''}"
            data-interpretation-revision-id="${escapeHtml(group.interpretationRevisionId)}">
            <div class="ss-interpretive-review-item-title">${escapeHtml(formatRevisionLabel(group.interpretationRevisionId))}</div>
            <div class="ss-interpretive-review-inline-meta">
                ${renderBadge(summaryStatus)}
            </div>
            ${createdAt ? `<div class="ss-hint">${escapeHtml(formatTimestamp(createdAt))}</div>` : ''}
            <div class="ss-interpretive-review-group-rows">
                ${reviews.map((review) => `
                    <button
                        type="button"
                        class="ss-interpretive-review-group-row-button${review.reviewRequestId === selectedReviewRequestId ? ' active' : ''}"
                        data-review-request-id="${escapeHtml(review.reviewRequestId)}"
                        data-interpretation-revision-id="${escapeHtml(group.interpretationRevisionId)}">
                        <div class="ss-interpretive-review-group-row-main">
                            <span class="ss-interpretive-review-group-name">${escapeHtml(formatHumanEntityLabel(review.reviewerEntityId || ''))}</span>
                            <span class="ss-hint">${escapeHtml(formatHumanRoleLabel(review.reviewerRole || 'REVIEWER'))}</span>
                        </div>
                        <div class="ss-interpretive-review-inline-meta">
                            ${renderBadge(formatHumanStateLabel(review.status))}
                        </div>
                    </button>
                `).join('')}
            </div>
        </div>
    `;
}

function renderDetailTabs(selectedView) {
    const views = [
        { id: 'review', label: 'Review' },
        { id: 'history', label: 'History' },
        { id: 'technical', label: 'Technical Details' },
    ];
    return `
        <div class="ss-interpretive-review-detail-tabs" role="tablist" aria-label="Memory review views">
            ${views.map((view) => `
                <button
                    type="button"
                    class="ss-interpretive-review-detail-tab${selectedView === view.id ? ' active' : ''}"
                    data-detail-view="${escapeHtml(view.id)}"
                    role="tab"
                    aria-selected="${selectedView === view.id ? 'true' : 'false'}">
                    ${escapeHtml(view.label)}
                </button>
            `).join('')}
        </div>
    `;
}

function renderSummaryFacts(rows) {
    return `
        <div class="ss-interpretive-review-facts">
            ${rows.map(({ label, value }) => `
                <div class="ss-interpretive-review-fact">
                    <span><strong>${escapeHtml(label)}:</strong> ${value}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function formatHumanEntityLabel(value) {
    const text = String(value || '').trim();
    if (!text) {
        return 'n/a';
    }
    const [, rawName = text] = text.split(':');
    const withoutExtension = rawName.replace(/\.[a-z0-9]+$/i, '');
    return withoutExtension
        .split(/[_-]+/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function formatHumanRoleLabel(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'RELATIONAL_PARTICIPANT') return 'Relational participant';
    if (normalized === 'MEMORY_SUBJECT') return 'Context owner';
    return formatSubmissionModeLabel(normalized);
}

function formatInterpretationTypeLabel(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'ROLE_EVOLUTION') return 'Role evolution';
    return formatSubmissionModeLabel(normalized || 'INTERPRETATION');
}

function formatRevisionLabel(value) {
    const text = String(value || '').trim();
    const match = text.match(/_v(\d+)$/i);
    if (match) {
        return `Revision ${Number(match[1])}`;
    }
    return 'Revision';
}

function formatMonthYear(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '';
    }
    return new Date(Number(value)).toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
    });
}

function formatHumanStateLabel(value) {
    const normalized = String(value || '').trim().toUpperCase();
    const map = {
        SEALED_FOR_REVIEW: 'Ready for review',
        PENDING: 'Decision required',
        APPROVED: 'Approved',
        REJECTED: 'Rejected',
        DEFERRED: 'Deferred',
        CONTESTED: 'Contested',
        GRANTED: 'Granted',
        DENIED: 'Denied',
        ELIGIBLE: 'Eligible',
        INELIGIBLE: 'Ineligible',
        AUTHORIZED: 'Authorized',
        CONSUMED: 'Used',
        PUBLISHED: 'Published',
        SUPERSEDED: 'Superseded',
        WITHDRAWN: 'Withdrawn',
        ACTIVE: 'Active',
        NOT_PUBLISHED: 'Not published',
        COMPLETE: 'Complete',
        BLOCKED: 'Blocked',
    };
    return map[normalized] || formatSubmissionModeLabel(normalized);
}

function formatPossessiveLabel(value) {
    const text = String(value || '').trim();
    if (!text) {
        return 'its';
    }
    return text.endsWith('s') ? `${text}'` : `${text}'s`;
}

function buildWhyReviewSummary(interpretation) {
    const subject = formatHumanEntityLabel(interpretation.memorySubjectId);
    const participantIds = Array.isArray(interpretation.materialParticipantEntityIds)
        ? interpretation.materialParticipantEntityIds.filter((id) => id && id !== interpretation.memorySubjectId)
        : [];
    const participants = participantIds.map((id) => formatHumanEntityLabel(id));
    const domains = Array.isArray(interpretation.assertionDomains)
        ? interpretation.assertionDomains.map((domain) => String(domain || '').trim().toLowerCase()).filter(Boolean)
        : [];
    const domainText = domains.length > 0
        ? domains.length === 1
            ? domains[0]
            : `${domains.slice(0, -1).join(', ')}, and ${domains[domains.length - 1]}`
        : 'meaning';
    const participantText = participants.length > 0
        ? ` with ${participants.join(' and ')}`
        : '';
    return `Concerns ${subject}'s ${domainText}${participantText}.`;
}

function buildReviewContextDescription(interpretation, operatorState) {
    const lifecycleStatus = getRevisionLifecycleStatus(interpretation, operatorState);
    const reviewState = String(interpretation.reviewState || '').trim().toUpperCase();
    const subjectState = String(interpretation.subjectDispositionState || '').trim().toUpperCase();
    const publicationState = String(interpretation.publicationState || '').trim().toUpperCase();
    const isActive = operatorState?.currentActiveRecord?.sourceInterpretationRevisionId === interpretation.interpretationRevisionId;

    if (lifecycleStatus === 'SUPERSEDED') {
        return 'A memory that was published earlier and later replaced.';
    }
    if (lifecycleStatus === 'WITHDRAWN') {
        return 'A memory that was published earlier and later withdrawn.';
    }
    if (publicationState === 'PUBLISHED') {
        return isActive
            ? 'The published memory as it stands right now.'
            : 'The published memory in its recorded form.';
    }
    if (subjectState === 'GRANTED' || reviewState === 'COMPLETE' || reviewState === 'APPROVED') {
        return 'The reviewed memory in its current approved form.';
    }
    return 'The proposed memory is still under review.';
}

function buildWhyReviewLabel(interpretation) {
    void interpretation;
    return 'Reason for Review';
}

function getRevisionPublicationRecord(interpretation, operatorState) {
    const revisionId = String(interpretation?.interpretationRevisionId || '').trim();
    const recordsForTarget = Array.isArray(operatorState?.recordsForTarget) ? operatorState.recordsForTarget : [];
    if (!revisionId || recordsForTarget.length === 0) {
        return null;
    }
    const matches = recordsForTarget
        .filter((record) => String(record?.sourceInterpretationRevisionId || '').trim() === revisionId)
        .sort((left, right) => Number(right?.publishedAt || 0) - Number(left?.publishedAt || 0));
    return matches[0] || null;
}

function getRevisionLifecycleStatus(interpretation, operatorState) {
    const publicationState = String(interpretation?.publicationState || '').trim().toUpperCase();
    const record = getRevisionPublicationRecord(interpretation, operatorState);
    const activeRecord = operatorState?.currentActiveRecord || null;
    const activeRevisionId = String(activeRecord?.sourceInterpretationRevisionId || '').trim();
    const revisionId = String(interpretation?.interpretationRevisionId || '').trim();

    if (record?.lifecycleState === 'WITHDRAWN') {
        return 'WITHDRAWN';
    }
    if (record?.supersededByDnmRecordId) {
        return 'SUPERSEDED';
    }
    if (publicationState === 'PUBLISHED' && activeRevisionId === revisionId) {
        return 'ACTIVE';
    }
    if (publicationState === 'PUBLISHED') {
        return 'PUBLISHED';
    }
    if (String(interpretation?.subjectDispositionState || '').trim().toUpperCase() === 'GRANTED') {
        return 'GRANTED';
    }
    if (String(interpretation?.reviewState || '').trim().toUpperCase() === 'COMPLETE') {
        return 'COMPLETE';
    }
    return String(interpretation?.reviewState || '').trim().toUpperCase() || 'PENDING';
}

function buildReviewHeadingLabel(interpretation, operatorState) {
    const lifecycleStatus = getRevisionLifecycleStatus(interpretation, operatorState);
    if (lifecycleStatus === 'SUPERSEDED' || lifecycleStatus === 'WITHDRAWN') {
        return 'Previous published context';
    }
    if (lifecycleStatus === 'ACTIVE' || lifecycleStatus === 'PUBLISHED') {
        return 'Published context';
    }
    if (lifecycleStatus === 'GRANTED' || lifecycleStatus === 'COMPLETE') {
        return 'Approved context';
    }
    return 'Context to review';
}

function buildNoActionSummary(interpretation, operatorState) {
    const lifecycleStatus = getRevisionLifecycleStatus(interpretation, operatorState);
    const reviewState = String(interpretation.reviewState || '').trim().toUpperCase();
    const subjectState = String(interpretation.subjectDispositionState || '').trim().toUpperCase();
    const publicationState = String(interpretation.publicationState || '').trim().toUpperCase();
    const isActive = operatorState?.currentActiveRecord?.sourceInterpretationRevisionId === interpretation.interpretationRevisionId;

    if (lifecycleStatus === 'SUPERSEDED') {
        return 'This revision was published and later replaced by a newer approved memory.';
    }
    if (lifecycleStatus === 'WITHDRAWN') {
        return 'This revision was published and later withdrawn from active continuity.';
    }
    if (publicationState === 'PUBLISHED') {
        return isActive
            ? 'This memory is already published and active. Use History or Technical Details to inspect later lifecycle events.'
            : 'This memory has already been published. Use History or Technical Details to inspect its publication lifecycle.';
    }
    if (subjectState === 'GRANTED' && reviewState === 'COMPLETE') {
        return 'No actions available.';
    }
    return 'No actions available.';
}

function renderHumanEvidenceSection(interpretation) {
    const groundingLinks = Array.isArray(interpretation?.groundingLinks) ? interpretation.groundingLinks : [];
    return `
        <div class="ss-interpretive-review-section ss-review-section ss-review-section--static">
            <div class="ss-review-section__header">
                <div class="ss-review-section__title">Evidence</div>
            </div>
            <div class="ss-review-section__body ss-interpretive-review-evidence-body">
                <div class="ss-interpretive-review-card ss-interpretive-review-status-card">
                    <div class="ss-interpretive-review-summary-note">
                        ${groundingLinks.length > 0
                            ? 'Readable evidence findings are not available yet. See Technical Details for the bound source records.'
                            : 'No bound evidence is available yet. See Technical Details for source information.'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function buildLifecycleTrailLabel(interpretation, operatorState) {
    const stages = [];
    const reviewState = String(interpretation.reviewState || '').trim().toUpperCase();
    const subjectState = String(interpretation.subjectDispositionState || '').trim().toUpperCase();
    const publicationState = String(interpretation.publicationState || '').trim().toUpperCase();
    const isActive = operatorState?.currentActiveRecord?.sourceInterpretationRevisionId === interpretation.interpretationRevisionId;
    const lifecycleStatus = getRevisionLifecycleStatus(interpretation, operatorState);

    if (reviewState === 'COMPLETE' || reviewState === 'APPROVED') {
        stages.push('Review complete');
    } else if (reviewState) {
        stages.push(formatHumanStateLabel(reviewState));
    }

    if (subjectState === 'GRANTED') {
        stages.push('Continuity granted');
    } else if (subjectState === 'DENIED') {
        stages.push('Continuity denied');
    }

    if (publicationState === 'PUBLISHED') {
        stages.push(isActive ? 'Published and active' : 'Published');
    }

    if (lifecycleStatus === 'SUPERSEDED') {
        stages.push('Superseded');
    } else if (lifecycleStatus === 'WITHDRAWN') {
        stages.push('Withdrawn');
    }

    return stages.join(' -> ');
}

function getVisibleOperatorActions(interpretation, operatorState) {
    const rawActions = Array.isArray(operatorState?.availableActions) ? operatorState.availableActions : [];
    const isPublishedRevision = String(interpretation?.publicationState || '').trim().toUpperCase() === 'PUBLISHED';
    const latestEligibleQualification = operatorState?.latestQualification?.eligibilityVerdict === 'ELIGIBLE';
    const latestAuthorized = operatorState?.latestAuthorization?.status === 'AUTHORIZED';

    return rawActions.filter((action) => {
        const normalized = String(action || '').trim().toUpperCase();
        if (normalized === 'QUALIFY_PUBLICATION') {
            return !isPublishedRevision;
        }
        if (normalized === 'AUTHORIZE_PUBLICATION') {
            return !isPublishedRevision && latestEligibleQualification;
        }
        if (normalized === 'EXECUTE_PUBLICATION') {
            return !isPublishedRevision && latestAuthorized;
        }
        if (normalized === 'RECORD_DELTA_REVIEW') {
            return false;
        }
        return true;
    });
}

function renderReviewResponseSummary(interpretation) {
    const requests = Array.isArray(interpretation.reviewRequests) ? interpretation.reviewRequests : [];
    const dispositionsByRequestId = new Map(
        (Array.isArray(interpretation.reviewDispositions) ? interpretation.reviewDispositions : [])
            .map((entry) => [entry.reviewRequestId, entry]),
    );
    if (requests.length === 0) {
        return '<div class="ss-hint">No reviews yet.</div>';
    }
    return `
        <div class="ss-interpretive-review-list">
            ${requests.map((request) => {
                const disposition = dispositionsByRequestId.get(request.reviewRequestId) || null;
                const reviewerLabel = formatHumanEntityLabel(request.reviewerEntityId);
                const roleLabel = formatHumanRoleLabel(request.reviewerRole || 'REVIEWER');
                const statusLabel = disposition
                    ? formatHumanStateLabel(disposition.disposition)
                    : formatHumanStateLabel(request.status);
                const isPending = !disposition && String(request.status || '').trim().toUpperCase() === 'PENDING';
                return renderHistoryActionCard({
                    title: reviewerLabel,
                    dispositionLabel: statusLabel,
                    roleLabel,
                    timestamp: disposition?.submittedAt || request.createdAt,
                    extraLines: isPending ? ['Decision still required.'] : [],
                    compact: true,
                });
            }).join('')}
        </div>
    `;
}

function renderSubmittedActionsHistory(interpretation, policiesById = new Map()) {
    const reviewDispositions = Array.isArray(interpretation.reviewDispositions) ? interpretation.reviewDispositions : [];
    const subjectDisposition = interpretation.subjectDisposition || null;
    if (reviewDispositions.length === 0 && !subjectDisposition) {
        return '<div class="ss-hint">No actions recorded yet.</div>';
    }

    const requestMap = new Map(
        (Array.isArray(interpretation.reviewRequests) ? interpretation.reviewRequests : [])
            .map((request) => [request.reviewRequestId, request]),
    );

    return `
        <div class="ss-interpretive-review-list">
            ${reviewDispositions.map((disposition) => {
                const request = requestMap.get(disposition.reviewRequestId) || null;
                const reviewerName = formatHumanEntityLabel(request?.reviewerEntityId || disposition?.provenance?.dispositionOwnerId || '');
                const extraLines = [];
                if (Array.isArray(disposition?.provenance?.subjectEvidenceRefs) && disposition.provenance.subjectEvidenceRefs.length > 0) {
                    extraLines.push(`Evidence refs: ${disposition.provenance.subjectEvidenceRefs.join(', ')}`);
                }
                return renderHistoryActionCard({
                    title: `${reviewerName} review`,
                    dispositionLabel: formatHumanStateLabel(disposition.disposition),
                    reasonCodes: disposition.reasonCodes,
                    commentary: disposition.commentary,
                    provenance: disposition.provenance,
                    timestamp: disposition.submittedAt,
                    extraLines,
                    bodyHtml: renderHistorySubmissionDetails(disposition.provenance, policiesById),
                });
            }).join('')}
            ${subjectDisposition ? renderHistoryActionCard({
                title: `${formatHumanEntityLabel(interpretation.memorySubjectId)} decision`,
                dispositionLabel: formatHumanStateLabel(subjectDisposition.state),
                reasonCodes: subjectDisposition.reasonCodes,
                commentary: subjectDisposition.commentary,
                provenance: subjectDisposition.provenance,
                timestamp: subjectDisposition.recordedAt,
                extraLines: Array.isArray(subjectDisposition?.provenance?.subjectEvidenceRefs) && subjectDisposition.provenance.subjectEvidenceRefs.length > 0
                    ? [`Evidence refs: ${subjectDisposition.provenance.subjectEvidenceRefs.join(', ')}`]
                    : [],
                bodyHtml: renderHistorySubmissionDetails(subjectDisposition.provenance, policiesById),
            }) : ''}
        </div>
    `;
}

function renderPublicationCurrentActions(interpretation, operatorState, policiesById, options = {}) {
    if (!operatorState) {
        return '';
    }
    const matchingPolicies = Array.isArray(operatorState.matchingPolicies) ? operatorState.matchingPolicies : [];
    const activeRecord = operatorState.currentActiveRecord || null;
    const continuityTargetId = operatorState.continuityTargetId || interpretation.memorySubjectId;
    const isPublishedRevision = String(interpretation.publicationState || '').trim().toUpperCase() === 'PUBLISHED';
    const latestEligibleQualification = operatorState.latestQualification?.eligibilityVerdict === 'ELIGIBLE'
        ? operatorState.latestQualification
        : null;
    const latestAuthorized = operatorState.latestAuthorization?.status === 'AUTHORIZED'
        ? operatorState.latestAuthorization
        : null;
    const canQualify = operatorState.availableActions?.includes('QUALIFY_PUBLICATION') === true;
    const canAuthorize = operatorState.availableActions?.includes('AUTHORIZE_PUBLICATION') === true;
    const canExecute = operatorState.availableActions?.includes('EXECUTE_PUBLICATION') === true;
    const canWithdrawActive = activeRecord?.operatorState?.availableActions?.includes('WITHDRAW_DNM') === true;
    const governancePolicies = [...policiesById.values()];
    const forms = [];

    if (!isPublishedRevision && canQualify) {
        const selectedPolicyLabel = matchingPolicies[0]
            ? `${matchingPolicies[0].publicationPolicyId} v${matchingPolicies[0].policyVersion}`
            : '';
        forms.push(renderPublicationActionForm({
            formKind: 'publication-qualify',
            title: 'Check Eligibility',
            description: 'Check whether this revision can be published.',
            actionStatus: options.actionStatus,
            submitLabel: 'Check Eligibility',
            disabled: false,
            dataset: {
                interpretationRevisionId: interpretation.interpretationRevisionId,
                proposalContentHash: interpretation.proposalContentHash || '',
                reviewEnvelopeHash: interpretation.reviewEnvelopeHash || '',
                subjectDispositionRecordId: interpretation.subjectDisposition?.subjectDispositionId || '',
            },
            fieldsHtml: `
                ${matchingPolicies.length > 1 ? `
                    <label class="ss-interpretive-review-field">
                        <span>Publication policy</span>
                        <select class="text_pole" name="publicationPolicyId">
                            ${buildPublicationPolicyOptions(matchingPolicies, operatorState.latestQualification?.publicationPolicyId || '')}
                        </select>
                    </label>
                ` : `
                    <label class="ss-interpretive-review-field">
                        <span>Active publication policy</span>
                        <input class="text_pole" type="text" name="publicationPolicyId" value="${escapeHtml(matchingPolicies[0]?.publicationPolicyId || '')}" readonly />
                        ${selectedPolicyLabel ? `<span class="ss-hint">${escapeHtml(selectedPolicyLabel)}</span>` : ''}
                    </label>
                `}
                <label class="ss-interpretive-review-field">
                    <span>Continuity Target</span>
                    <input class="text_pole" type="text" name="continuityTargetId" value="${escapeHtml(continuityTargetId || '')}" readonly />
                    <span class="ss-hint">${escapeHtml(formatHumanEntityLabel(continuityTargetId || ''))}</span>
                </label>
            `,
        }));
    }

    if (!isPublishedRevision && latestEligibleQualification && canAuthorize) {
        forms.push(renderPublicationActionForm({
            formKind: 'publication-authorize',
            title: 'Authorize Publication',
            description: 'Issue a one-time authorization for the latest eligible revision.',
            actionStatus: options.actionStatus,
            submitLabel: 'Authorize Publication',
            disabled: false,
            dataset: {
                qualificationId: latestEligibleQualification.qualificationId,
            },
            fieldsHtml: `
                <label class="ss-interpretive-review-field">
                    <span>Authorized By</span>
                    <input class="text_pole" type="text" name="authorizedBy" value="${escapeHtml(options.currentActorId || '')}" readonly />
                    <span class="ss-hint">${escapeHtml(formatHumanEntityLabel(options.currentActorId || ''))}</span>
                </label>
                <label class="ss-interpretive-review-field">
                    <span>Expires At</span>
                    <input class="text_pole" type="datetime-local" name="expiresAt" value="${escapeHtml(formatDateTimeLocalValue(Date.now() + 60 * 60 * 1000))}" />
                </label>
            `,
        }));
    }

    if (!isPublishedRevision && latestAuthorized && canExecute) {
        forms.push(renderPublicationActionForm({
            formKind: 'publication-execute',
            title: 'Publish',
            description: 'Publish this revision to active memory.',
            actionStatus: options.actionStatus,
            submitLabel: 'Publish',
            disabled: false,
            dataset: {
                publicationAuthorizationId: latestAuthorized.publicationAuthorizationId,
            },
            fieldsHtml: '',
        }));
    }

    if (canWithdrawActive) {
        forms.push(renderLifecycleGovernanceForm({
            formKind: 'dnm-withdraw',
            title: 'Withdraw Current Memory',
            description: '',
            actionKind: 'DNM_WITHDRAWAL',
            ownerId: interpretation.memorySubjectId,
            interpretation,
            currentActorId: options.currentActorId,
            policies: governancePolicies,
            actionStatus: options.actionStatus,
            submitLabel: 'Withdraw Current Memory',
            dataset: {
                dnmRecordId: activeRecord?.dnmRecordId || '',
            },
        }));
    }

    if (forms.length === 0) {
        return '';
    }

    if (forms.length === 1) {
        return forms[0];
    }

    return forms.join('');
}

function renderCurrentActionSurface(interpretation, policiesById, options = {}) {
    const requests = Array.isArray(interpretation.reviewRequests) ? interpretation.reviewRequests : [];
    const selectedRequest = requests.find((entry) => entry.reviewRequestId === options.selectedReviewRequestId) || null;
    const pendingRequest = selectedRequest?.status === 'PENDING'
        ? selectedRequest
        : requests.find((entry) => entry.status === 'PENDING') || null;

    if (pendingRequest) {
        return {
            title: 'Review details',
            description: '',
            content: renderActionForm({
                formKind: 'review',
                ownerId: pendingRequest.reviewerEntityId,
                ownerRoleLabel: pendingRequest.reviewerEntityId === interpretation.memorySubjectId ? 'Context owner' : 'Relational participant',
                actionKind: 'REVIEW_DISPOSITION',
                interpretation,
                currentActorId: options.currentActorId,
                policies: [...policiesById.values()],
                reviewRequest: pendingRequest,
                actionStatus: options.actionStatus,
            }),
        };
    }

    if (!interpretation.subjectDisposition) {
        return {
            title: 'Decision details',
            description: '',
            content: renderActionForm({
                formKind: 'subject',
                ownerId: interpretation.memorySubjectId,
                ownerRoleLabel: 'Context owner',
                actionKind: 'SUBJECT_DISPOSITION',
                interpretation,
                currentActorId: options.currentActorId,
                policies: [...policiesById.values()],
                actionStatus: options.actionStatus,
            }),
        };
    }

    if (options.publicationOperatorState?.availableActions?.length) {
        return {
            title: 'Publication details',
            description: '',
            content: renderPublicationCurrentActions(
                interpretation,
                options.publicationOperatorState,
                policiesById,
                options,
            ),
        };
    }

    return null;
}

function renderCandidateDetail(interpretation, policiesById, options = {}) {
    if (!interpretation) {
        return '<div class="ss-interpretive-review-detail-empty ss-hint">Select a request to inspect it.</div>';
    }

    const relatedPolicyIds = collectReferencedPolicyIds(interpretation);
    const relatedPolicies = relatedPolicyIds
        .map((policyId) => policiesById.get(policyId))
        .filter(Boolean);
    const allowedViews = new Set(['review', 'history', 'technical']);
    const selectedView = allowedViews.has(String(options.detailView || '').trim())
        ? String(options.detailView || '').trim()
        : 'review';
    const participantLabels = Array.isArray(interpretation.materialParticipantEntityIds)
        ? interpretation.materialParticipantEntityIds
            .filter((id) => id && id !== interpretation.memorySubjectId)
            .map((id) => formatHumanEntityLabel(id))
        : [];
    const currentActionSurface = renderCurrentActionSurface(
        interpretation,
        policiesById,
        options,
    );
    const reviewContextDescription = buildReviewContextDescription(
        interpretation,
        options.publicationOperatorState,
    );
    const whyReviewLabel = buildWhyReviewLabel(interpretation);
    const noActionSummary = buildNoActionSummary(
        interpretation,
        options.publicationOperatorState,
    );
    const lifecycleTrailLabel = buildLifecycleTrailLabel(
        interpretation,
        options.publicationOperatorState,
    );
    const reviewHeadingLabel = buildReviewHeadingLabel(
        interpretation,
        options.publicationOperatorState,
    );
    const currentStateBadge = renderBadge(formatHumanStateLabel(
        getRevisionLifecycleStatus(interpretation, options.publicationOperatorState),
    ));
    const evidenceSection = renderHumanEvidenceSection(interpretation);
    const hasReviewHistory = Array.isArray(interpretation.reviewDispositions) && interpretation.reviewDispositions.length > 0;
    const hasSubjectHistory = !!interpretation.subjectDisposition;
    const hasLineageHistory = !!interpretation.parentRevisionId
        || !!interpretation.createdFromDispositionId
        || (Array.isArray(interpretation.childRevisionIds) && interpretation.childRevisionIds.length > 0);

    const reviewView = `
        <div class="ss-interpretive-review-review-grid">
            <div class="ss-interpretive-review-card ss-interpretive-review-review-sidebar">
                ${renderSummaryFacts([
                    { label: 'Type', value: escapeHtml(formatInterpretationTypeLabel(interpretation.type || 'Interpretive')) },
                    { label: 'Context Owner', value: escapeHtml(formatHumanEntityLabel(interpretation.memorySubjectId)) },
                    { label: 'Involves', value: escapeHtml(participantLabels.join(', ') || 'None') },
                ])}
            </div>

            <div class="ss-interpretive-review-section ss-review-section ss-review-section--static ss-interpretive-review-static-section ss-interpretive-review-review-main">
                <div class="ss-review-section__header ss-interpretive-review-static-header">
                    <div class="ss-review-section__title ss-interpretive-review-disclosure-title">${escapeHtml(reviewHeadingLabel)}</div>
                    <div class="ss-review-section__description ss-interpretive-review-disclosure-description">${escapeHtml(reviewContextDescription)}</div>
                </div>
                <div class="ss-interpretive-review-context">${escapeHtml(interpretation.statement || '')}</div>
                <div class="ss-interpretive-review-context-support">
                    <div class="ss-interpretive-review-context-why"><strong>${escapeHtml(whyReviewLabel)}:</strong> ${escapeHtml(buildWhyReviewSummary(interpretation))}</div>
                </div>
            </div>

            <div class="ss-interpretive-review-review-main">
                ${evidenceSection}
            </div>
        </div>

        ${currentActionSurface?.content ? `
            <div class="ss-interpretive-review-section ss-review-section ss-review-section--static ss-interpretive-review-action-surface">
                <div class="ss-review-section__header">
                    <div class="ss-review-section__title">${escapeHtml(currentActionSurface.title || 'Review details')}</div>
                    ${currentActionSurface.description
                        ? `<div class="ss-review-section__description">${escapeHtml(currentActionSurface.description)}</div>`
                        : ''}
                </div>
                <div class="ss-review-section__body">
                    ${currentActionSurface.content}
                </div>
            </div>
        ` : `
            <div class="ss-interpretive-review-card ss-interpretive-review-status-card">
                <strong>Current status</strong>
                <div class="ss-interpretive-review-summary-note">${escapeHtml(noActionSummary)}</div>
            </div>
        `}
    `;

    const historyView = (!hasReviewHistory && !hasSubjectHistory && !hasLineageHistory) ? `
        <div class="ss-interpretive-review-card ss-interpretive-review-status-card">
            <strong>No actions taken</strong>
            <div class="ss-interpretive-review-summary-note">Pending: Initial review required.</div>
        </div>
    ` : `
        ${hasReviewHistory ? renderCollapsibleSection(
            'Review history',
            'Shows who responded and when.',
            renderReviewResponseSummary(interpretation),
            { open: true },
        ) : ''}

        ${(hasReviewHistory || hasSubjectHistory) ? renderCollapsibleSection(
            'Decision history',
            'Shows the recorded actions in compact human-readable form.',
            renderSubmittedActionsHistory(interpretation, policiesById),
            { open: true },
        ) : ''}

        ${(interpretation.revisionCreationProvenance && hasLineageHistory) ? renderCollapsibleSection(
            'How this revision was created',
            'Explains whether this revision was created directly, through delegation, or as a child after correction.',
            renderProvenance(interpretation.revisionCreationProvenance, policiesById),
            { open: true },
        ) : ''}

        ${(Array.isArray(interpretation.childRevisionIds) && interpretation.childRevisionIds.length > 0) ? renderCollapsibleSection(
            'Child revisions',
            'Keeps the correction lineage visible so edited descendants do not erase the parent proposal.',
            `<div class="ss-interpretive-review-card">${renderStringList(interpretation.childRevisionIds, 'None')}</div>`,
            { open: true },
        ) : ''}
    `;

    const technicalView = `
        ${renderCollapsibleSection(
            'Identity and timeline',
            'Shows what this revision is, where it came from, and where it sits in the governed flow.',
            renderKeyValueGrid([
                { label: 'Interpretation ID', value: `<code>${escapeHtml(interpretation.interpretationId || 'n/a')}</code>` },
                { label: 'Parent Revision', value: interpretation.parentRevisionId ? `<code>${escapeHtml(interpretation.parentRevisionId)}</code>` : 'None' },
                { label: 'Created From Disposition', value: interpretation.createdFromDispositionId ? `<code>${escapeHtml(interpretation.createdFromDispositionId)}</code>` : 'None' },
                { label: 'Memory Scope', value: `<code>${escapeHtml(interpretation.memoryScopeId || 'n/a')}</code>` },
                { label: 'Memory Subject', value: `<code>${escapeHtml(interpretation.memorySubjectId || 'n/a')}</code>` },
                { label: 'Revision Reason', value: escapeHtml(interpretation.revisionReason || 'n/a') },
                { label: 'Candidate State', value: renderBadge(interpretation.candidateState) },
                { label: 'Grounding State', value: renderBadge(interpretation.groundingState) },
                { label: 'Created', value: escapeHtml(formatTimestamp(interpretation.createdAt)) },
                { label: 'Updated', value: escapeHtml(formatTimestamp(interpretation.updatedAt)) },
            ]),
            { open: true },
        )}

        ${renderCollapsibleSection(
            'Claims and scope',
            'Summarizes the claims this interpretation is making about role, authority, relationship, and meaning.',
            renderKeyValueGrid([
                { label: 'Assertion Domains', value: renderStringList(interpretation.assertionDomains, 'None') },
                { label: 'Participants', value: renderStringList(interpretation.materialParticipantEntityIds, 'None') },
                { label: 'Shared Relationship', value: renderBadge(interpretation.sharedRelationshipAsserted ? 'TRUE' : 'FALSE') },
                { label: 'Personal Meaning', value: renderBadge(interpretation.personalMeaningAsserted ? 'TRUE' : 'FALSE') },
            ]),
        )}

        ${renderCollapsibleSection(
            'Risk and policy',
            'Shows why this candidate routes the way it does and which validation policy judged it.',
            renderKeyValueGrid([
                { label: 'Risk Class', value: renderBadge(interpretation.risk?.riskClass || 'n/a') },
                { label: 'Risk Reasons', value: renderStringList(interpretation.risk?.riskReasons, 'None') },
                { label: 'Validation Policy', value: interpretation.policyBinding ? `<code>${escapeHtml(interpretation.policyBinding.validationPolicyId)}</code> v${escapeHtml(String(interpretation.policyBinding.policyVersion))}` : 'n/a' },
                { label: 'Matched Rules', value: renderStringList(interpretation.policyBinding?.matchedRuleIds, 'None') },
            ]),
        )}

        ${renderCollapsibleSection(
            'Technical record',
            'Preserves the exact canonical fields, policy bindings, and source identifiers for audit or debugging.',
            `
                ${renderKeyValueGrid([
                    { label: 'Interpretation ID', value: `<code>${escapeHtml(interpretation.interpretationId || 'n/a')}</code>` },
                    { label: 'Interpretation Revision ID', value: `<code>${escapeHtml(interpretation.interpretationRevisionId || 'n/a')}</code>` },
                    { label: 'Memory Scope', value: `<code>${escapeHtml(interpretation.memoryScopeId || 'n/a')}</code>` },
                    { label: 'Memory Subject', value: `<code>${escapeHtml(interpretation.memorySubjectId || 'n/a')}</code>` },
                    { label: 'Review status', value: renderBadge(interpretation.reviewState) },
                    { label: 'Subject decision state', value: renderBadge(interpretation.subjectDispositionState) },
                    { label: 'Publication status', value: renderBadge(interpretation.publicationState) },
                    { label: 'Authority Effect', value: renderBadge(interpretation.authorityEffect) },
                    { label: 'Validation Policy', value: interpretation.policyBinding ? `<code>${escapeHtml(interpretation.policyBinding.validationPolicyId)}</code>` : 'n/a' },
                    { label: 'Policy Version', value: interpretation.policyBinding ? escapeHtml(String(interpretation.policyBinding.policyVersion)) : 'n/a' },
                    { label: 'Matched Rules', value: renderStringList(interpretation.policyBinding?.matchedRuleIds, 'None') },
                    { label: 'Proposal Content Hash', value: `<code>${escapeHtml(interpretation.proposalContentHash || 'n/a')}</code>` },
                    { label: 'Review Envelope Hash', value: `<code>${escapeHtml(interpretation.reviewEnvelopeHash || 'n/a')}</code>` },
                ])}
            `,
            { open: true },
        )}

        ${renderCollapsibleSection(
            'Evidence and grounding',
            'Preserves the grounding outcome, source identifiers, and hashes for audit or debugging.',
            `
                ${renderKeyValueGrid([
                    { label: 'Grounding Outcome', value: renderBadge(interpretation.groundingAggregate?.groundingOutcome || 'n/a') },
                    { label: 'Evaluated At', value: escapeHtml(formatTimestamp(interpretation.groundingAggregate?.evaluatedAt)) },
                    { label: 'Proposal Content Hash', value: `<code>${escapeHtml(interpretation.proposalContentHash || 'n/a')}</code>` },
                    { label: 'Review Envelope Hash', value: `<code>${escapeHtml(interpretation.reviewEnvelopeHash || 'n/a')}</code>` },
                ])}
                ${renderGroundingLinks(interpretation.groundingLinks)}
            `,
        )}

        ${relatedPolicies.length > 0 ? renderCollapsibleSection(
            'Related Delegation Policies',
            'Shows which delegation policies were actually involved in review, subject decision, or later lifecycle steps.',
            renderDelegationPolicies(relatedPolicies),
        ) : ''}

        ${renderCollapsibleSection(
            'Publication and lifecycle details',
            'Preserves the complete DNM operator surface and lifecycle detail.',
            renderPublicationOperatorSection(
                interpretation,
                options.publicationOperatorState,
                policiesById,
                options,
            ),
        )}
    `;

    return `
        <div class="ss-interpretive-review-detail-header">
            <div class="ss-interpretive-review-detail-header-main">
                <div class="ss-interpretive-review-detail-header-top">
                    <div>
                        <div class="ss-interpretive-review-detail-title">${escapeHtml(formatInterpretationTypeLabel(interpretation.type || 'Interpretation'))}</div>
                        <div class="ss-hint">${escapeHtml(formatRevisionLabel(interpretation.interpretationRevisionId))}</div>
                        ${lifecycleTrailLabel ? `<div class="ss-hint">${escapeHtml(lifecycleTrailLabel)}</div>` : ''}
                    </div>
                    <div class="ss-interpretive-review-inline-meta">
                        ${currentStateBadge}
                    </div>
                </div>
                ${renderDetailTabs(selectedView)}
            </div>
        </div>
        <div class="ss-interpretive-review-detail-body">
            <div class="ss-interpretive-review-detail-view${selectedView === 'review' ? ' active' : ''}" data-detail-view-panel="review">
                ${reviewView}
            </div>
            <div class="ss-interpretive-review-detail-view${selectedView === 'history' ? ' active' : ''}" data-detail-view-panel="history">
                ${historyView}
            </div>
            <div class="ss-interpretive-review-detail-view${selectedView === 'technical' ? ' active' : ''}" data-detail-view-panel="technical">
                ${technicalView}
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
                <div class="ss-interpretive-review-toolbar-intro">
                    <h3>Memory Review</h3>
                    <p class="ss-hint">Review and manage proposed memory updates.</p>
                </div>
                <div class="ss-interpretive-review-toolbar-actions">
                    <div class="ss-interpretive-review-toolbar-buttons">
                        <input id="ss-interpretive-review-expand-toggle" class="menu_button" type="button" value="Expand All" />
                        <input id="ss-interpretive-review-fullscreen-toggle" class="menu_button" type="button" value="Full screen" />
                    </div>
                </div>
            </div>

            <div class="ss-interpretive-review-layout">
                <div class="ss-interpretive-review-column">
                    <div class="ss-interpretive-review-queue">
                        <div class="ss-interpretive-review-queue-header">
                            <strong>Requests</strong>
                            <input id="ss-interpretive-review-refresh" class="menu_button" type="button" value="Refresh" />
                        </div>
                        <div class="ss-interpretive-review-queue-controls">
                            <label for="ss-interpretive-review-status-filter">Filter</label>
                            <select id="ss-interpretive-review-status-filter" class="text_pole">${statusOptions}</select>
                        </div>
                        <div id="ss-interpretive-review-queue-list" class="ss-interpretive-review-queue-list">
                            <div class="ss-interpretive-review-queue-empty ss-hint">Loading requests...</div>
                        </div>
                    </div>
                </div>

                <div class="ss-interpretive-review-column">
                    <div id="ss-interpretive-review-detail" class="ss-interpretive-review-detail">
                        <div class="ss-interpretive-review-detail-empty ss-hint">Select a request to inspect it.</div>
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
        detailView: 'review',
        candidateCache: new Map(),
        publicationOperatorCache: new Map(),
        policiesByScopeId: new Map(),
        activeInterpretation: null,
        activePublicationOperatorState: null,
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
        const modalRoot = document.querySelector('.ss-interpretive-review-modal');
        const popupRoot = popup?.dlg || modalRoot?.closest('.popup') || null;
        const popupContent = popupRoot?.querySelector('.popup-content') || null;
        const statusFilter = document.getElementById('ss-interpretive-review-status-filter');
        const refreshButton = document.getElementById('ss-interpretive-review-refresh');
        const fullscreenButton = document.getElementById('ss-interpretive-review-fullscreen-toggle');
        const expandToggleButton = document.getElementById('ss-interpretive-review-expand-toggle');
        const queueList = document.getElementById('ss-interpretive-review-queue-list');
        const detailRoot = document.getElementById('ss-interpretive-review-detail');

        const renderDetailError = (message) => {
            if (!detailRoot) return;
            detailRoot.innerHTML = `<div class="ss-interpretive-review-detail-empty ss-hint">${escapeHtml(message)}</div>`;
            updateExpandToggle();
        };

        const renderQueue = () => {
            if (!queueList) return;
            if (state.reviews.length === 0) {
                queueList.innerHTML = '<div class="ss-interpretive-review-queue-empty ss-hint">No review requests matched the current filter.</div>';
                return;
            }
            const groups = buildQueueGroups(state.reviews);
            queueList.innerHTML = groups.map((group) => {
                return renderQueueGroupItem(
                    group,
                    state.selectedReviewRequestId,
                    state.selectedInterpretationRevisionId,
                );
            }).join('');
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
                renderDetailError('Select a request to inspect it.');
                updateExpandToggle();
                return;
            }
            detailRoot.innerHTML = renderCandidateDetail(state.activeInterpretation, state.activePoliciesById, {
                selectedReviewRequestId: state.selectedReviewRequestId,
                currentActorId: state.currentActorId,
                actionStatus: state.actionStatus,
                publicationOperatorState: state.activePublicationOperatorState,
                detailView: state.detailView,
            });
            syncActionForms();
            updateExpandToggle();
        };

        const loadPublicationOperatorState = async (interpretation) => {
            const normalizedId = String(interpretation?.interpretationRevisionId || '').trim();
            const continuityTargetId = String(interpretation?.memorySubjectId || '').trim();
            if (!normalizedId) {
                state.activePublicationOperatorState = null;
                return;
            }
            const cacheKey = `${normalizedId}::${continuityTargetId}`;
            let operatorState = state.publicationOperatorCache.get(cacheKey) || null;
            if (!operatorState) {
                const response = await getInterpretivePublicationOperatorState(normalizedId, { continuityTargetId });
                operatorState = response?.operatorState || null;
                if (operatorState) {
                    state.publicationOperatorCache.set(cacheKey, operatorState);
                }
            }
            state.activePublicationOperatorState = operatorState;
        };

        const invalidateInterpretationCaches = (interpretationRevisionId, continuityTargetId = '') => {
            const normalizedId = String(interpretationRevisionId || '').trim();
            const normalizedTargetId = String(continuityTargetId || '').trim();
            if (normalizedId) {
                state.candidateCache.delete(normalizedId);
                if (normalizedTargetId) {
                    state.publicationOperatorCache.delete(`${normalizedId}::${normalizedTargetId}`);
                } else {
                    for (const key of [...state.publicationOperatorCache.keys()]) {
                        if (key.startsWith(`${normalizedId}::`)) {
                            state.publicationOperatorCache.delete(key);
                        }
                    }
                }
            }
        };

        const loadInterpretationByRevision = async (interpretationRevisionId) => {
            const normalizedId = String(interpretationRevisionId || '').trim();
            if (!normalizedId) {
                state.activeInterpretation = null;
                state.activePublicationOperatorState = null;
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
                state.activePublicationOperatorState = null;
                state.activePoliciesById = new Map();
                renderDetailError('Candidate detail was not returned by the server.');
                return;
            }
            state.selectedInterpretationRevisionId = normalizedId;
            state.activeInterpretation = interpretation;
            state.activePoliciesById = await loadPoliciesForCandidate(interpretation);
            await loadPublicationOperatorState(interpretation);
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
                queueList.innerHTML = '<div class="ss-interpretive-review-queue-empty ss-hint">Loading requests...</div>';
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

        function syncReasonCodeSelector(form) {
            const field = form.querySelector('[name="reasonCodes"]');
            if (!field) {
                return;
            }
            const selectedCodes = new Set(parseInterpretiveTokenList(field.value || ''));
            form.querySelectorAll('[data-reason-code]').forEach((button) => {
                const code = String(button.getAttribute('data-reason-code') || '').trim();
                const active = selectedCodes.has(code);
                button.classList.toggle('selected', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        }

        function toggleReasonCodeSelection(form, code) {
            const field = form?.querySelector('[name="reasonCodes"]');
            if (!field) {
                return;
            }
            const selectedCodes = parseInterpretiveTokenList(field.value || '');
            const normalizedCode = String(code || '').trim();
            if (!normalizedCode) {
                return;
            }
            const nextCodes = selectedCodes.includes(normalizedCode)
                ? selectedCodes.filter((entry) => entry !== normalizedCode)
                : [...selectedCodes, normalizedCode];
            field.value = nextCodes.join(', ');
            syncReasonCodeSelector(form);
        }

        function syncActionForm(form) {
            const mode = String(form.querySelector('[name="submissionMode"]')?.value || '').trim();
            const formKind = String(form.dataset.formKind || '').trim();
            const hasAutoSubjectEvidenceRefs = String(form.dataset.hasAutoSubjectEvidenceRefs || '').trim() === 'true';
            const autoSubjectEvidenceRefs = parseInterpretiveTokenList(String(form.dataset.autoSubjectEvidenceRefs || ''));
            const disposition = String(
                form.querySelector('[name="disposition"]')?.value
                || form.querySelector('[name="state"]')?.value
                || '',
            ).trim();
            const policyField = form.querySelector('[data-field="delegationPolicyId"]');
            const policyUnavailableField = form.querySelector('[data-field="delegationPolicyUnavailable"]');
            const policySelect = form.querySelector('[name="delegationPolicyId"]');
            const evidenceField = form.querySelector('[data-field="subjectEvidenceRefs"]');
            const evidenceInput = form.querySelector('[name="subjectEvidenceRefs"]');
            const evidenceHint = form.querySelector('[data-field-hint="subjectEvidenceRefs"]');
            const reasonCodeGroups = form.querySelector('[data-field="reasonCodeGroups"]');
            const reasonCodeHint = form.querySelector('[data-field-hint="reasonCodeGroups"]');
            const commentaryField = form.querySelector('[name="commentary"]');
            const commentaryLabel = form.querySelector('[data-field-label="commentary"]');
            const commentaryHint = form.querySelector('[data-field-hint="commentary"]');
            const revisedCandidateField = form.querySelector('[data-field="revisedCandidate"]');
            const applicablePolicies = buildApplicablePolicies(form);
            const hasApplicablePolicies = applicablePolicies.length > 0;
            const fieldState = getGovernedFieldState({
                submissionMode: mode,
                hasApplicablePolicies,
                hasAutoSubjectEvidenceRefs,
            });
            const isDispositionScopedForm = formKind === 'review' || formKind === 'subject';
            const dispositionFieldState = getInterpretiveDispositionFieldState({
                formKind,
                disposition,
            });

            if (policySelect) {
                const currentValue = String(policySelect.value || '').trim();
                policySelect.innerHTML = buildDelegationPolicyOptions(applicablePolicies);
                if (currentValue && applicablePolicies.some((policy) => policy.delegationPolicyId === currentValue)) {
                    policySelect.value = currentValue;
                }
                policySelect.required = fieldState.delegationPolicyRequired;
            }

            if (policyField) {
                policyField.hidden = !fieldState.showDelegationPolicyField;
            }
            if (policyUnavailableField) {
                policyUnavailableField.hidden = !fieldState.showDelegationPolicyUnavailable;
            }
            if (evidenceField) {
                evidenceField.hidden = !fieldState.showEvidenceField;
            }
            if (evidenceInput) {
                evidenceInput.required = fieldState.evidenceRequired;
                if (fieldState.showEvidenceField && !String(evidenceInput.value || '').trim() && autoSubjectEvidenceRefs.length > 0) {
                    evidenceInput.value = autoSubjectEvidenceRefs.join('\n');
                } else if (!fieldState.showEvidenceField) {
                    evidenceInput.value = '';
                }
            }
            if (evidenceHint) {
                evidenceHint.textContent = fieldState.evidenceHint;
            }
            if (reasonCodeGroups && isDispositionScopedForm) {
                reasonCodeGroups.hidden = !dispositionFieldState.showReasonSelectors;
                if (reasonCodeGroups.hidden) {
                    const reasonField = form.querySelector('[name="reasonCodes"]');
                    if (reasonField) {
                        reasonField.value = '';
                    }
                }
            }
            if (reasonCodeHint && isDispositionScopedForm) {
                reasonCodeHint.textContent = dispositionFieldState.commentaryHint;
            }
            if (commentaryField && isDispositionScopedForm) {
                commentaryField.required = dispositionFieldState.requireCommentary;
                commentaryField.placeholder = dispositionFieldState.commentaryPlaceholder;
            }
            if (commentaryLabel && isDispositionScopedForm) {
                commentaryLabel.textContent = 'Comment';
            }
            if (commentaryHint && isDispositionScopedForm) {
                commentaryHint.textContent = dispositionFieldState.requireCommentary
                    ? 'Required for this decision.'
                    : '';
            }
            if (revisedCandidateField) {
                revisedCandidateField.hidden = !shouldShowInterpretiveRevisionEditor(formKind, disposition);
            }
            syncReasonCodeSelector(form);
        }

        function appendTokenToField(field, tokenValue) {
            if (!field) {
                return;
            }
            const normalized = parseInterpretiveTokenList(field.value || '');
            const token = String(tokenValue || '').trim();
            if (!token) {
                return;
            }
            if (!normalized.includes(token)) {
                normalized.push(token);
            }
            field.value = normalized.join(', ');
            field.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function validateGovernedSubmissionPayload(form, payload) {
            const governedError = validateGovernedSubmissionState({
                submissionMode: payload.submissionMode,
                delegationPolicyId: payload.delegationPolicyId,
                subjectEvidenceRefs: payload.subjectEvidenceRefs,
                hasApplicablePolicies: buildApplicablePolicies(form).length > 0,
                hasAutoSubjectEvidenceRefs: String(form.dataset.hasAutoSubjectEvidenceRefs || '').trim() === 'true',
            });
            if (governedError) {
                return governedError;
            }
            return validateInterpretiveActionPayload({
                formKind: String(form.dataset.formKind || '').trim(),
                disposition: payload.disposition || payload.state || '',
                reasonCodes: payload.reasonCodes,
                commentary: payload.commentary,
            });
        }

        function syncActionForms() {
            detailRoot?.querySelectorAll('.ss-interpretive-action-form').forEach((form) => syncActionForm(form));
        }

        function updateExpandToggle() {
            if (!expandToggleButton || !detailRoot) {
                return;
            }
            const activePanel = detailRoot.querySelector('.ss-interpretive-review-detail-view.active') || detailRoot;
            const disclosures = [...activePanel.querySelectorAll('.ss-interpretive-review-disclosure')];
            if (disclosures.length === 0) {
                expandToggleButton.disabled = true;
                expandToggleButton.value = 'Expand All';
                return;
            }
            expandToggleButton.disabled = false;
            const allOpen = disclosures.every((entry) => entry.hasAttribute('open'));
            expandToggleButton.value = allOpen ? 'Collapse All' : 'Expand All';
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
            const validationError = validateGovernedSubmissionPayload(form, payload);
            if (validationError) {
                setInlineFormStatus(form, 'error', validationError);
                return;
            }

            if (shouldShowInterpretiveRevisionEditor('review', payload.disposition)) {
                const revisedPayload = buildInterpretiveRevisedCandidatePayload({
                    parentStatement: String(form.dataset.parentStatement || '').trim(),
                    revisedStatement: form.querySelector('[name="revisedStatement"]')?.value || '',
                });
                if (revisedPayload.error) {
                    setInlineFormStatus(form, 'error', revisedPayload.error);
                    return;
                }
                payload.revisedCandidate = revisedPayload.revisedCandidate;
            }

            setFormBusy(form, true);
            setInlineFormStatus(form, 'info', 'Submitting governed review disposition...');
            try {
                const response = await submitInterpretiveReviewDisposition(reviewRequestId, payload);
                state.currentActorId = payload.submittedByActorId || state.currentActorId;
                const childInterpretation = response?.childInterpretation || null;
                state.actionStatus = {
                    kind: 'review',
                    tone: 'success',
                    message: childInterpretation?.interpretationRevisionId
                        ? `Recorded ${response?.disposition?.disposition || payload.disposition} for ${ownerId}. Opened child revision ${childInterpretation.interpretationRevisionId}.`
                        : `Recorded ${response?.disposition?.disposition || payload.disposition} for ${ownerId}.`,
                };
                if (state.selectedInterpretationRevisionId) {
                    invalidateInterpretationCaches(state.selectedInterpretationRevisionId, state.activeInterpretation?.memorySubjectId);
                }
                if (childInterpretation?.interpretationRevisionId) {
                    invalidateInterpretationCaches(childInterpretation.interpretationRevisionId, childInterpretation.memorySubjectId);
                    state.selectedInterpretationRevisionId = childInterpretation.interpretationRevisionId;
                    const nextPendingRequest = (Array.isArray(childInterpretation.reviewRequests) ? childInterpretation.reviewRequests : [])
                        .find((entry) => entry.status === 'PENDING' || entry.status === 'DEFERRED');
                    state.selectedReviewRequestId = nextPendingRequest?.reviewRequestId || null;
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
            const validationError = validateGovernedSubmissionPayload(form, payload);
            if (validationError) {
                setInlineFormStatus(form, 'error', validationError);
                return;
            }

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
                    invalidateInterpretationCaches(state.selectedInterpretationRevisionId, state.activeInterpretation?.memorySubjectId);
                }
                await refreshReviews({ preserveDetail: true });
            } catch (error) {
                setInlineFormStatus(form, 'error', error?.message || String(error));
            } finally {
                setFormBusy(form, false);
            }
        }

        async function handlePublicationQualificationSubmit(form) {
            const interpretationRevisionId = String(form.dataset.interpretationRevisionId || '').trim();
            const payload = {
                publicationPolicyId: String(form.querySelector('[name="publicationPolicyId"]')?.value || '').trim(),
                continuityTargetId: String(form.querySelector('[name="continuityTargetId"]')?.value || '').trim(),
                proposalContentHash: String(form.dataset.proposalContentHash || '').trim(),
                reviewEnvelopeHash: String(form.dataset.reviewEnvelopeHash || '').trim(),
                subjectDispositionRecordId: String(form.dataset.subjectDispositionRecordId || '').trim(),
            };

            setFormBusy(form, true);
            setInlineFormStatus(form, 'info', 'Evaluating publication qualification...');
            try {
                const response = await qualifyInterpretivePublication(interpretationRevisionId, payload);
                invalidateInterpretationCaches(interpretationRevisionId, payload.continuityTargetId);
                state.actionStatus = {
                    kind: 'publication-qualify',
                    tone: response?.qualification?.eligibilityVerdict === 'ELIGIBLE' ? 'success' : 'info',
                    message: `Qualification recorded: ${response?.qualification?.eligibilityVerdict || 'UNKNOWN'}.`,
                };
                await refreshReviews({ preserveDetail: true });
            } catch (error) {
                setInlineFormStatus(form, 'error', error?.message || String(error));
            } finally {
                setFormBusy(form, false);
            }
        }

        async function handlePublicationAuthorizationSubmit(form) {
            const qualificationId = String(form.dataset.qualificationId || '').trim();
            const expiresAt = parseDateTimeLocalValue(form.querySelector('[name="expiresAt"]')?.value || '');
            const payload = {
                qualificationId,
                authorizedBy: String(form.querySelector('[name="authorizedBy"]')?.value || '').trim(),
                expiresAt,
            };
            if (!qualificationId) {
                setInlineFormStatus(form, 'error', 'No eligible qualification is available to authorize.');
                return;
            }
            if (!expiresAt) {
                setInlineFormStatus(form, 'error', 'A valid authorization expiry is required.');
                return;
            }

            setFormBusy(form, true);
            setInlineFormStatus(form, 'info', 'Creating one-time publication authorization...');
            try {
                const response = await createInterpretivePublicationAuthorization(payload);
                invalidateInterpretationCaches(response?.authorization?.interpretationRevisionId, response?.authorization?.continuityTargetId);
                state.actionStatus = {
                    kind: 'publication-authorize',
                    tone: 'success',
                    message: `Authorization created: ${response?.authorization?.status || 'AUTHORIZED'}.`,
                };
                await refreshReviews({ preserveDetail: true });
            } catch (error) {
                setInlineFormStatus(form, 'error', error?.message || String(error));
            } finally {
                setFormBusy(form, false);
            }
        }

        async function handlePublicationExecuteSubmit(form) {
            const publicationAuthorizationId = String(form.dataset.publicationAuthorizationId || '').trim();
            if (!publicationAuthorizationId) {
                setInlineFormStatus(form, 'error', 'No active publication authorization is available.');
                return;
            }

            setFormBusy(form, true);
            setInlineFormStatus(form, 'info', 'Publishing qualified interpretation into DNM...');
            try {
                const response = await executeInterpretivePublicationAuthorization({ publicationAuthorizationId });
                invalidateInterpretationCaches(response?.interpretation?.interpretationRevisionId, response?.publishedRecord?.continuityTargetId);
                state.actionStatus = {
                    kind: 'publication-execute',
                    tone: 'success',
                    message: `Published DNM record ${response?.publishedRecord?.dnmRecordId || ''}.`,
                };
                await refreshReviews({ preserveDetail: true });
            } catch (error) {
                setInlineFormStatus(form, 'error', error?.message || String(error));
            } finally {
                setFormBusy(form, false);
            }
        }

        function buildLifecyclePayload(form) {
            return {
                actorEntityId: String(form.querySelector('[name="submittedByActorId"]')?.value || '').trim(),
                dispositionOwnerId: String(form.dataset.ownerId || '').trim(),
                submissionMode: String(form.querySelector('[name="submissionMode"]')?.value || '').trim(),
                delegationPolicyId: String(form.querySelector('[name="delegationPolicyId"]')?.value || '').trim() || null,
                subjectEvidenceRefs: parseInterpretiveTokenList(form.querySelector('[name="subjectEvidenceRefs"]')?.value || ''),
                reasonCodes: parseInterpretiveTokenList(form.querySelector('[name="reasonCodes"]')?.value || ''),
                commentary: String(form.querySelector('[name="commentary"]')?.value || '').trim(),
            };
        }

        async function handleDnmSupersedeSubmit(form) {
            const payload = {
                ...buildLifecyclePayload(form),
                priorDnmRecordId: String(form.dataset.priorDnmRecordId || '').trim(),
                replacementDnmRecordId: String(form.dataset.replacementDnmRecordId || '').trim(),
            };
            const validationError = validateGovernedSubmissionPayload(form, payload);
            if (validationError) {
                setInlineFormStatus(form, 'error', validationError);
                return;
            }
            setFormBusy(form, true);
            setInlineFormStatus(form, 'info', 'Superseding active DNM record...');
            try {
                const response = await supersedeDnmPublicationRecord(payload);
                invalidateInterpretationCaches(state.selectedInterpretationRevisionId, response?.replacementRecord?.continuityTargetId);
                state.actionStatus = {
                    kind: 'dnm-supersede',
                    tone: 'success',
                    message: `Superseded ${response?.priorRecord?.dnmRecordId || ''} with ${response?.replacementRecord?.dnmRecordId || ''}.`,
                };
                await refreshReviews({ preserveDetail: true });
            } catch (error) {
                setInlineFormStatus(form, 'error', error?.message || String(error));
            } finally {
                setFormBusy(form, false);
            }
        }

        async function handleDnmWithdrawSubmit(form) {
            const payload = {
                ...buildLifecyclePayload(form),
                dnmRecordId: String(form.dataset.dnmRecordId || '').trim(),
            };
            const validationError = validateGovernedSubmissionPayload(form, payload);
            if (validationError) {
                setInlineFormStatus(form, 'error', validationError);
                return;
            }
            setFormBusy(form, true);
            setInlineFormStatus(form, 'info', 'Withdrawing current DNM record...');
            try {
                const response = await withdrawDnmPublicationRecord(payload);
                invalidateInterpretationCaches(state.selectedInterpretationRevisionId, response?.record?.continuityTargetId);
                state.actionStatus = {
                    kind: 'dnm-withdraw',
                    tone: 'success',
                    message: `Withdrew ${response?.record?.dnmRecordId || ''}.`,
                };
                await refreshReviews({ preserveDetail: true });
            } catch (error) {
                setInlineFormStatus(form, 'error', error?.message || String(error));
            } finally {
                setFormBusy(form, false);
            }
        }

        async function handleDnmDeltaReviewSubmit(form) {
            const payload = {
                ...buildLifecyclePayload(form),
                continuityTargetId: String(form.dataset.continuityTargetId || '').trim(),
                dnmRecordId: String(form.dataset.dnmRecordId || '').trim() || null,
                deltaState: String(form.querySelector('[name="deltaState"]')?.value || '').trim(),
            };
            const validationError = validateGovernedSubmissionPayload(form, payload);
            if (validationError) {
                setInlineFormStatus(form, 'error', validationError);
                return;
            }
            setFormBusy(form, true);
            setInlineFormStatus(form, 'info', 'Recording DNM delta review...');
            try {
                const response = await recordDnmDeltaReview(payload);
                invalidateInterpretationCaches(state.selectedInterpretationRevisionId, response?.record?.continuityTargetId);
                state.actionStatus = {
                    kind: 'dnm-delta-review',
                    tone: 'success',
                    message: `Recorded delta review ${response?.deltaReview?.deltaState || ''} for ${response?.record?.dnmRecordId || ''}.`,
                };
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

        const applyFullscreenState = (expanded) => {
            modalRoot?.classList.toggle('ss-interpretive-review-fullscreen', expanded);
            popupRoot?.classList.toggle('ss-interpretive-review-popup-fullscreen', expanded);
            if (popupRoot) {
                if (expanded) {
                    popupRoot.style.width = 'calc(100vw - 12px)';
                    popupRoot.style.maxWidth = 'calc(100vw - 12px)';
                    popupRoot.style.height = 'calc(100vh - 12px)';
                    popupRoot.style.maxHeight = 'calc(100vh - 12px)';
                } else {
                    popupRoot.style.removeProperty('width');
                    popupRoot.style.removeProperty('max-width');
                    popupRoot.style.removeProperty('height');
                    popupRoot.style.removeProperty('max-height');
                }
            }
            if (popupContent) {
                if (expanded) {
                    popupContent.style.height = '100%';
                    popupContent.style.maxHeight = '100%';
                    popupContent.style.width = '100%';
                } else {
                    popupContent.style.removeProperty('height');
                    popupContent.style.removeProperty('max-height');
                    popupContent.style.removeProperty('width');
                }
            }
            fullscreenButton.value = expanded ? 'Exit full screen' : 'Full screen';
        };

        fullscreenButton?.addEventListener('click', () => {
            const nextExpanded = !(modalRoot?.classList.contains('ss-interpretive-review-fullscreen'));
            applyFullscreenState(nextExpanded);
        });

        expandToggleButton?.addEventListener('click', () => {
            if (!detailRoot) {
                return;
            }
            const activePanel = detailRoot.querySelector('.ss-interpretive-review-detail-view.active') || detailRoot;
            const disclosures = [...activePanel.querySelectorAll('.ss-interpretive-review-disclosure')];
            if (disclosures.length === 0) {
                updateExpandToggle();
                return;
            }
            const shouldOpen = !disclosures.every((entry) => entry.hasAttribute('open'));
            disclosures.forEach((entry) => {
                if (shouldOpen) {
                    entry.setAttribute('open', '');
                } else {
                    entry.removeAttribute('open');
                }
            });
            updateExpandToggle();
        });

        detailRoot?.addEventListener('toggle', (event) => {
            if (event.target instanceof HTMLDetailsElement && event.target.classList.contains('ss-interpretive-review-disclosure')) {
                updateExpandToggle();
            }
        }, true);

        detailRoot?.addEventListener('click', (event) => {
            const reasonButton = event.target.closest('[data-reason-code]');
            if (reasonButton) {
                event.preventDefault();
                const form = reasonButton.closest('.ss-interpretive-action-form');
                const reasonCode = String(reasonButton.getAttribute('data-reason-code') || '').trim();
                toggleReasonCodeSelection(form, reasonCode);
                reasonButton.focus();
                return;
            }
            const tokenButton = event.target.closest('[data-token-target][data-token-value]');
            if (tokenButton) {
                event.preventDefault();
                const form = tokenButton.closest('.ss-interpretive-action-form');
                const targetName = String(tokenButton.getAttribute('data-token-target') || '').trim();
                const tokenValue = String(tokenButton.getAttribute('data-token-value') || '').trim();
                const field = form?.querySelector(`[name="${targetName}"]`);
                appendTokenToField(field, tokenValue);
                field?.focus();
                return;
            }
            const tab = event.target.closest('[data-detail-view]');
            if (!tab) {
                return;
            }
            const nextView = String(tab.getAttribute('data-detail-view') || '').trim();
            if (!nextView || nextView === state.detailView) {
                return;
            }
            state.detailView = nextView;
            renderCurrentDetail();
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
            if (event.target.name === 'disposition') {
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
                return;
            }
            if (form.dataset.formKind === 'publication-qualify') {
                await handlePublicationQualificationSubmit(form);
                return;
            }
            if (form.dataset.formKind === 'publication-authorize') {
                await handlePublicationAuthorizationSubmit(form);
                return;
            }
            if (form.dataset.formKind === 'publication-execute') {
                await handlePublicationExecuteSubmit(form);
                return;
            }
            if (form.dataset.formKind === 'dnm-supersede') {
                await handleDnmSupersedeSubmit(form);
                return;
            }
            if (form.dataset.formKind === 'dnm-withdraw') {
                await handleDnmWithdrawSubmit(form);
                return;
            }
            if (form.dataset.formKind === 'dnm-delta-review') {
                await handleDnmDeltaReviewSubmit(form);
            }
        });

        void refreshReviews();
    });

    await showPromise;
}
