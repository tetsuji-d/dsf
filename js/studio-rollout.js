// Build-time presentation switches. Server authorization remains authoritative.
export function resolveStudioRollout(env = {}) {
    const personalSharing = env.VITE_PERSONAL_SHARING_ENABLED === 'true';
    const invitations = env.VITE_PUBLISHING_INVITATIONS_ENABLED === 'true';
    return Object.freeze({
        trash: env.VITE_PROJECT_TRASH_ENABLED === 'true',
        personalSharing, invitations,
        notifications: personalSharing || invitations,
    });
}
export const studioRollout = resolveStudioRollout(import.meta.env);
