import fs from 'node:fs';
import process from 'node:process';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const SUPPORTED_FLAGS = new Set([
    'uid',
    'email',
    'admin',
    'operator',
    'moderator',
    'reason',
    'actor',
    'project',
    'dry-run',
    'help'
]);

function printUsage() {
    console.log(`
Usage:
  npm run claims:set -- --uid <firebase uid> [--admin true|false] [--operator true|false] [--moderator true|false] [--reason "..."]
  npm run claims:set -- --email <user@example.com> [--admin true|false] [--operator true|false] [--moderator true|false] [--reason "..."]

Environment:
  GOOGLE_APPLICATION_CREDENTIALS=<path to service account json>
  or
  FIREBASE_SERVICE_ACCOUNT_JSON='<json string>'
  optional:
  FIREBASE_PROJECT_ID=<staging|prod project id override>

Examples:
  npm run claims:set -- --email ops@example.com --operator true --reason "staging operator"
  npm run claims:set -- --uid abc123 --moderator false --reason "revoke moderator"
  npm run claims:set -- --uid abc123 --admin true --actor architect@example.com --dry-run
`.trim());
}

function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) {
            throw new Error(`Unknown argument: ${token}`);
        }
        const key = token.slice(2);
        if (!SUPPORTED_FLAGS.has(key)) {
            throw new Error(`Unsupported flag: --${key}`);
        }
        if (key === 'dry-run' || key === 'help') {
            parsed[key] = true;
            continue;
        }
        const value = argv[i + 1];
        if (value == null || value.startsWith('--')) {
            throw new Error(`Flag --${key} requires a value`);
        }
        parsed[key] = value;
        i += 1;
    }
    return parsed;
}

function parseBoolean(value, key) {
    if (value == null) return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error(`Flag --${key} must be true or false`);
}

function loadCredentialMaterial() {
    const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (inlineJson) {
        const parsed = JSON.parse(inlineJson);
        return {
            projectId: parsed.project_id || process.env.FIREBASE_PROJECT_ID || '',
            credential: cert(parsed)
        };
    }

    const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (credentialPath) {
        const raw = fs.readFileSync(credentialPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            projectId: process.env.FIREBASE_PROJECT_ID || parsed.project_id || '',
            credential: cert(parsed)
        };
    }

    return {
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        credential: applicationDefault()
    };
}

function ensureAdminApp(projectOverride) {
    if (getApps().length > 0) return getApps()[0];
    const material = loadCredentialMaterial();
    const projectId = projectOverride || material.projectId || undefined;
    return initializeApp({
        credential: material.credential,
        ...(projectId ? { projectId } : {})
    });
}

function buildNextClaims(existingClaims, updates) {
    const dsfRoles = {
        admin: false,
        operator: false,
        moderator: false,
        ...(existingClaims?.dsfRoles || {})
    };

    for (const [key, value] of Object.entries(updates)) {
        if (typeof value === 'boolean') dsfRoles[key] = value;
    }

    return {
        ...(existingClaims || {}),
        dsfRoles
    };
}

async function resolveUserRecord(auth, { uid, email }) {
    if (uid) return auth.getUser(uid);
    if (email) return auth.getUserByEmail(email);
    throw new Error('Either --uid or --email is required');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printUsage();
        return;
    }

    const roleUpdates = {
        admin: parseBoolean(args.admin, 'admin'),
        operator: parseBoolean(args.operator, 'operator'),
        moderator: parseBoolean(args.moderator, 'moderator')
    };

    if (!Object.values(roleUpdates).some((value) => typeof value === 'boolean')) {
        throw new Error('At least one of --admin, --operator, or --moderator is required');
    }

    const app = ensureAdminApp(args.project);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const actor = args.actor || process.env.DSF_ADMIN_ACTOR || 'unknown';
    const reason = args.reason || 'no reason provided';

    const user = await resolveUserRecord(auth, args);
    const existingClaims = user.customClaims || {};
    const nextClaims = buildNextClaims(existingClaims, roleUpdates);
    const nextRolesMirror = {
        admin: nextClaims.dsfRoles.admin === true,
        operator: nextClaims.dsfRoles.operator === true,
        moderator: nextClaims.dsfRoles.moderator === true
    };

    const summary = {
        projectId: app.options.projectId || '',
        uid: user.uid,
        email: user.email || '',
        actor,
        reason,
        from: existingClaims?.dsfRoles || { admin: false, operator: false, moderator: false },
        to: nextClaims.dsfRoles,
        dryRun: !!args['dry-run']
    };

    console.log(JSON.stringify(summary, null, 2));

    if (args['dry-run']) return;

    await auth.setCustomUserClaims(user.uid, nextClaims);

    const userRef = db.collection('users').doc(user.uid);
    const auditRef = db.collection('admin_audit_logs').doc();

    await db.runTransaction(async (tx) => {
        tx.set(userRef, {
            roles: nextRolesMirror,
            adminRoleSync: {
                source: 'custom_claims',
                syncedAt: FieldValue.serverTimestamp()
            }
        }, { merge: true });

        tx.set(auditRef, {
            type: 'custom_claims_update',
            actor,
            reason,
            targetUid: user.uid,
            targetEmail: user.email || null,
            before: summary.from,
            after: summary.to,
            createdAt: FieldValue.serverTimestamp()
        });
    });

    console.log(`Updated custom claims for ${user.uid}`);
}

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
});
