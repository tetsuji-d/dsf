// Independent rollout switches; enabling spaces must not change publication policy.
export function requiresPublishingSpace(env = {}) {
    return env.PUBLISHING_SPACE_REQUIRED === 'true';
}
export function canMoveProjectToTrash(env = {}) {
    return env.PROJECT_TRASH_ENABLED === 'true';
}
