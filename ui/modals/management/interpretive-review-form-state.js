export const REVIEW_DISPOSITION_OPTIONS = Object.freeze([
    { value: 'APPROVE', label: 'Approve' },
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

export function parseInterpretiveTokenList(value = '') {
    return [...new Set(
        String(value || '')
            .split(/[\n,]/u)
            .map((entry) => String(entry || '').trim())
            .filter(Boolean),
    )];
}

export function getInterpretiveSubmissionModeOptions({ ownerId, memorySubjectId }) {
    if (String(ownerId || '').trim() === String(memorySubjectId || '').trim()) {
        return [
            { value: 'DIRECT_SUBJECT_ACTION', label: 'Direct Subject Action' },
            { value: 'SUBJECT_EXPRESSED_AND_RECORDED', label: 'Subject Expressed And Recorded' },
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
        ? 'SUBJECT_EXPRESSED_AND_RECORDED'
        : 'DIRECT_REVIEWER_ACTION';
}
