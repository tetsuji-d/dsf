import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from './firebase-core.js';

export function isStagingEmailLoginEnabled() {
    return import.meta.env.MODE === 'staging'
        && String(import.meta.env.VITE_ENABLE_EMAIL_LOGIN || '').toLowerCase() === 'true';
}

export async function signInWithEmail(email, password, authInstance = auth) {
    const safeEmail = String(email || '').trim();
    const safePassword = String(password || '');
    if (!safeEmail || !safePassword) {
        throw new Error('Email and password are required.');
    }
    return signInWithEmailAndPassword(authInstance, safeEmail, safePassword);
}
