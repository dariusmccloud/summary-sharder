export const REVIEW_DISPOSITION_OPTIONS = Object.freeze([
    { value: 'APPROVE', label: 'Approve' },
    { value: 'APPROVE_WITH_EDIT', label: 'Approve with Changes' },
    { value: 'APPROVE_FOR_SCOPE_ONLY', label: 'Approve For Scope Only' },
    { value: 'REJECT', label: 'Reject' },
    { value: 'CONTEST', label: 'Contest' },
    { value: 'DEFER', label: 'Defer' },
]);

export const SUBJECT_DISPOSITION_OPTIONS = Object.freeze([
    { value: 'GRANTED', label: 'Grant' },
    { value: 'REJECTED', label: 'Reject' },
    { value: 'CONTESTED', label: 'Contest' },
    { value: 'DEFERRED', label: 'Defer' },
]);

export const INTERPRETIVE_REASON_CODE_GROUPS = Object.freeze([
    Object.freeze({
        key: 'attention',
        title: 'What needs attention?',
        codes: Object.freeze([
            Object.freeze({
                value: 'AUTHORITY',
                label: 'Authority or ownership',
                description: 'Who holds authority, ownership, or governance responsibility.',
            }),
            Object.freeze({
                value: 'ROLE',
                label: 'Role or responsibility',
                description: 'How someone’s role, duties, or responsibilities are described.',
            }),
            Object.freeze({
                value: 'RELATIONSHIP',
                label: 'Relationship meaning',
                description: 'What the interpretation claims about a shared relationship.',
            }),
            Object.freeze({
                value: 'IDENTITY',
                label: 'Identity or self-description',
                description: 'How someone’s identity or sense of self is characterized.',
            }),
            Object.freeze({
                value: 'PERSONAL_HISTORY',
                label: 'Personal history',
                description: 'Claims based on biography, prior events, or lived history.',
            }),
            Object.freeze({
                value: 'SENSITIVE_MEANING',
                label: 'Sensitive personal meaning',
                description: 'Meaning that requires additional care because it is intimate or consequential.',
            }),
            Object.freeze({
                value: 'PROJECT_BEHAVIOR',
                label: 'Project or process behavior',
                description: 'Claims about how someone works, decides, or behaves within a project.',
            }),
            Object.freeze({
                value: 'THEMATIC_MEANING',
                label: 'Theme or interpretation',
                description: 'Broader narrative, thematic, or interpretive meaning.',
            }),
        ]),
    }),
    Object.freeze({
        key: 'why',
        title: 'What is wrong with the current wording?',
        codes: Object.freeze([
            Object.freeze({
                value: 'SCOPE_TOO_BROAD',
                label: 'Too broad',
                description: 'The claim extends beyond what the evidence or approved scope supports.',
            }),
            Object.freeze({
                value: 'CONTRARY_EVIDENCE_PRESENT',
                label: 'Conflicting evidence',
                description: 'Available evidence materially challenges or limits the claim.',
            }),
        ]),
    }),
]);

export function getGovernedFieldState({
    submissionMode = '',
    hasApplicablePolicies = false,
    hasAutoSubjectEvidenceRefs = true,
} = {}) {
    const mode = String(submissionMode || '').trim();
    const hasPolicies = hasApplicablePolicies === true;
    const hasAutoRefs = hasAutoSubjectEvidenceRefs === true;
    const isTrustedDelegate = mode === 'TRUSTED_DELEGATE';
    const isRecordedSubjectExpression = mode === 'SUBJECT_EXPRESSED_AND_RECORDED';
    const showEvidenceField = hasAutoRefs && (isTrustedDelegate || isRecordedSubjectExpression);
    return {
        showDelegationPolicyField: isTrustedDelegate && hasPolicies,
        showDelegationPolicyUnavailable: isTrustedDelegate && !hasPolicies,
        delegationPolicyRequired: isTrustedDelegate && hasPolicies,
        showEvidenceField,
        evidenceRequired: hasAutoRefs && isRecordedSubjectExpression,
        evidenceHint: !hasAutoRefs
            ? ''
            : isRecordedSubjectExpression
            ? 'Required for recorded subject expression.'
            : 'Optional for trusted delegation.',
    };
}

export function validateGovernedSubmissionPayload({
    submissionMode = '',
    delegationPolicyId = null,
    subjectEvidenceRefs = [],
    hasApplicablePolicies = false,
    hasAutoSubjectEvidenceRefs = true,
} = {}) {
    const fieldState = getGovernedFieldState({
        submissionMode,
        hasApplicablePolicies,
        hasAutoSubjectEvidenceRefs,
    });
    const mode = String(submissionMode || '').trim();
    const evidenceRefs = Array.isArray(subjectEvidenceRefs) ? subjectEvidenceRefs : [];
    const normalizedPolicyId = String(delegationPolicyId || '').trim();
    if (mode === 'SUBJECT_EXPRESSED_AND_RECORDED' && hasAutoSubjectEvidenceRefs !== true) {
        return 'Recorded subject expression is unavailable until inspectable subject evidence references are bound to this candidate.';
    }
    if (fieldState.delegationPolicyRequired && !normalizedPolicyId) {
        return 'Trusted delegation requires a matching active delegation policy.';
    }
    if (fieldState.evidenceRequired && evidenceRefs.length === 0) {
        return 'Recorded subject expression requires at least one subject evidence reference.';
    }
    return null;
}

export function getInterpretiveDispositionFieldState({
    formKind = '',
    disposition = '',
} = {}) {
    const kind = String(formKind || '').trim().toLowerCase();
    const value = String(disposition || '').trim().toUpperCase();

    const base = {
        showReasonSelectors: false,
        requireReasonCodes: false,
        requireCommentary: false,
        commentaryPlaceholder: 'Optional explanation.',
        commentaryHint: '',
    };

    if (kind === 'review') {
        if (value === 'APPROVE_WITH_EDIT' || value === 'APPROVE_FOR_SCOPE_ONLY') {
            return {
                ...base,
                showReasonSelectors: true,
                requireReasonCodes: true,
                commentaryPlaceholder: 'Explain what needs to change.',
                commentaryHint: 'Select what needs attention and why the current wording should change.',
            };
        }
        if (value === 'REJECT' || value === 'CONTEST') {
            return {
                ...base,
                showReasonSelectors: true,
                requireReasonCodes: true,
                requireCommentary: true,
                commentaryPlaceholder: 'Explain why you are rejecting or contesting this memory.',
                commentaryHint: 'Select the concern and explain the decision.',
            };
        }
        return base;
    }

    if (kind === 'subject') {
        if (value === 'REJECTED' || value === 'CONTESTED') {
            return {
                ...base,
                showReasonSelectors: true,
                requireReasonCodes: true,
                requireCommentary: true,
                commentaryPlaceholder: 'Explain why you are rejecting or contesting this memory.',
                commentaryHint: 'Select the concern and explain the decision.',
            };
        }
        return base;
    }

    return {
        ...base,
        showReasonSelectors: true,
    };
}

export function validateInterpretiveActionPayload({
    formKind = '',
    disposition = '',
    reasonCodes = [],
    commentary = '',
} = {}) {
    const fieldState = getInterpretiveDispositionFieldState({
        formKind,
        disposition,
    });
    const normalizedReasonCodes = Array.isArray(reasonCodes) ? reasonCodes.filter(Boolean) : [];
    const normalizedCommentary = String(commentary || '').trim();

    if (fieldState.requireReasonCodes && normalizedReasonCodes.length === 0) {
        return 'Select at least one concern before submitting this decision.';
    }
    if (fieldState.requireCommentary && !normalizedCommentary) {
        return 'Add an explanation before submitting this decision.';
    }
    return null;
}

export function parseInterpretiveTokenList(value = '') {
    return [...new Set(
        String(value || '')
            .split(/[\n,]/u)
            .map((entry) => String(entry || '').trim())
            .filter(Boolean),
    )];
}

export function getInterpretiveSubmissionModeOptions({
    ownerId,
    memorySubjectId,
    hasAutoSubjectEvidenceRefs = true,
} = {}) {
    if (String(ownerId || '').trim() === String(memorySubjectId || '').trim()) {
        return [
            { value: 'DIRECT_SUBJECT_ACTION', label: 'Direct Subject Action' },
            ...(hasAutoSubjectEvidenceRefs === true
                ? [{ value: 'SUBJECT_EXPRESSED_AND_RECORDED', label: 'Subject Expressed And Recorded' }]
                : []),
            { value: 'TRUSTED_DELEGATE', label: 'Trusted Delegate' },
        ];
    }
    return [
        { value: 'DIRECT_REVIEWER_ACTION', label: 'Direct Reviewer Action' },
        { value: 'TRUSTED_DELEGATE', label: 'Trusted Delegate' },
    ];
}

export function filterDelegationPoliciesForAction(policies = [], {
    principalEntityId,
    delegateEntityId = '',
    actionKind,
    memoryScopeId,
    continuityTargetId,
} = {}) {
    const principal = String(principalEntityId || '').trim();
    const delegate = String(delegateEntityId || '').trim();
    const action = String(actionKind || '').trim();
    const scope = String(memoryScopeId || '').trim();
    const continuityTarget = String(continuityTargetId || '').trim();

    return (Array.isArray(policies) ? policies : []).filter((policy) => {
        if (String(policy?.policyState || '').trim() !== 'ACTIVE') return false;
        if (String(policy?.principalEntityId || '').trim() !== principal) return false;
        if (delegate && String(policy?.delegateEntityId || '').trim() !== delegate) return false;
        if (scope && String(policy?.memoryScopeId || '').trim() !== scope) return false;
        if (continuityTarget && String(policy?.continuityTargetId || '').trim() && String(policy?.continuityTargetId || '').trim() !== continuityTarget) return false;
        if (action && !Array.isArray(policy?.allowedActions)) return false;
        if (action && !policy.allowedActions.includes(action)) return false;
        return true;
    });
}

export function resolveDefaultInterpretiveSubmissionMode({
    ownerId,
    memorySubjectId,
    currentActorId = '',
    policies = [],
    actionKind,
    memoryScopeId,
    continuityTargetId,
    hasAutoSubjectEvidenceRefs = true,
} = {}) {
    const owner = String(ownerId || '').trim();
    const subject = String(memorySubjectId || '').trim();
    const actor = String(currentActorId || '').trim();

    if (actor && actor === owner) {
        return owner === subject ? 'DIRECT_SUBJECT_ACTION' : 'DIRECT_REVIEWER_ACTION';
    }

    const matchingPolicies = filterDelegationPoliciesForAction(policies, {
        principalEntityId: owner,
        delegateEntityId: actor,
        actionKind,
        memoryScopeId,
        continuityTargetId,
    });
    if (matchingPolicies.length > 0) {
        return 'TRUSTED_DELEGATE';
    }

    return owner === subject
        ? (hasAutoSubjectEvidenceRefs === true
            ? 'SUBJECT_EXPRESSED_AND_RECORDED'
            : 'DIRECT_SUBJECT_ACTION')
        : 'DIRECT_REVIEWER_ACTION';
}

export function shouldShowInterpretiveRevisionEditor(formKind, disposition) {
    return String(formKind || '').trim() === 'review'
        && String(disposition || '').trim() === 'APPROVE_WITH_EDIT';
}

export function buildInterpretiveRevisedCandidatePayload({ parentStatement = '', revisedStatement = '' } = {}) {
    const parent = String(parentStatement || '').trim();
    const statement = String(revisedStatement || '').trim();
    if (!statement) {
        return {
            error: 'Revised statement is required for Approve With Edit.',
        };
    }
    if (parent && statement === parent) {
        return {
            error: 'Revised statement must differ from the parent statement.',
        };
    }
    return {
        revisedCandidate: {
            statement,
        },
    };
}
