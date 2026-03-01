import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocs, limit, orderBy, query, setDoc, setLogLevel, terminate } from "firebase/firestore";

const ENV_FILE_BY_MODE = {
    staging: ".env.staging",
    production: ".env.production",
    prod: ".env.production"
};

function parseMode(argv) {
    const modeArg = argv.find((arg) => arg.startsWith("--env="));
    if (!modeArg) return "staging";
    const value = modeArg.split("=")[1]?.trim().toLowerCase();
    return value || "staging";
}

function parseMinPublic(argv) {
    const opt = argv.find((arg) => arg.startsWith("--min-public="));
    if (!opt) return 0;
    const raw = Number.parseInt(opt.split("=")[1] || "0", 10);
    if (Number.isNaN(raw) || raw < 0) return 0;
    return raw;
}

function readEnvFile(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const map = {};
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        map[key] = value;
    }
    return map;
}

function buildFirebaseConfig(envMap) {
    const required = [
        "VITE_FIREBASE_API_KEY",
        "VITE_FIREBASE_AUTH_DOMAIN",
        "VITE_FIREBASE_PROJECT_ID",
        "VITE_FIREBASE_STORAGE_BUCKET",
        "VITE_FIREBASE_MESSAGING_SENDER_ID",
        "VITE_FIREBASE_APP_ID"
    ];

    const missing = required.filter((key) => !envMap[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required env keys: ${missing.join(", ")}`);
    }

    return {
        apiKey: envMap.VITE_FIREBASE_API_KEY,
        authDomain: envMap.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: envMap.VITE_FIREBASE_PROJECT_ID,
        storageBucket: envMap.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: envMap.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: envMap.VITE_FIREBASE_APP_ID,
        measurementId: envMap.VITE_FIREBASE_MEASUREMENT_ID || undefined
    };
}

function isPermissionDenied(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();
    return code.includes("permission-denied") || message.includes("permission_denied") || message.includes("missing or insufficient permissions");
}

async function run() {
    const argv = process.argv.slice(2);
    const mode = parseMode(argv);
    const minPublic = parseMinPublic(argv);
    const envFile = ENV_FILE_BY_MODE[mode];
    if (!envFile) {
        throw new Error(`Unknown mode "${mode}". Use --env=staging or --env=production`);
    }

    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const envPath = path.resolve(rootDir, envFile);
    if (!fs.existsSync(envPath)) {
        throw new Error(`Env file not found: ${envPath}`);
    }

    const envMap = readEnvFile(envPath);
    const firebaseConfig = buildFirebaseConfig(envMap);
    setLogLevel("silent");

    console.log(`[verify-firebase] mode=${mode} projectId=${firebaseConfig.projectId}`);
    const app = initializeApp(firebaseConfig, `verify-${mode}-${Date.now()}`);
    const db = getFirestore(app);

    try {
        // 1) Public read check (Portal critical path)
        const publicQuery = query(
            collection(db, "public_projects"),
            orderBy("publishedAt", "desc"),
            limit(1)
        );
        const snap = await getDocs(publicQuery);
        console.log(`[verify-firebase] public_projects read OK (count=${snap.size})`);
        if (snap.size < minPublic) {
            throw new Error(`public_projects count ${snap.size} is less than required minimum ${minPublic}`);
        }

        // 2) Unauthenticated write should be blocked by rules
        const probeRef = doc(db, "users", "smoke-probe-user", "projects", `probe-${Date.now()}`);
        try {
            await setDoc(probeRef, { ts: new Date().toISOString(), smoke: true });
            throw new Error("Unauthenticated write unexpectedly succeeded. Check Firestore rules.");
        } catch (error) {
            if (!isPermissionDenied(error)) {
                throw error;
            }
            console.log("[verify-firebase] unauthenticated write blocked as expected");
        }
        console.log("[verify-firebase] PASS");
    } finally {
        await terminate(db);
    }
}

run().catch((error) => {
    console.error("[verify-firebase] FAIL");
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
