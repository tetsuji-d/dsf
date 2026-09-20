import { AuthoringApiError, check } from './common.js';

export function encodeFirestoreValue(value) {
    if (value === null) return { nullValue: null };
    if (value instanceof Date) { check(Number.isFinite(value.getTime()), 'INVALID_TIMESTAMP'); return { timestampValue: value.toISOString() }; }
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        check(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)), 'INVALID_NUMBER');
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
    check(value && typeof value === 'object' && [null, Object.prototype].includes(Object.getPrototypeOf(value)), 'INVALID_FIRESTORE_VALUE');
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeFirestoreValue(entry)])) } };
}
export function decodeFirestoreValue(value) {
    check(value && typeof value === 'object' && Object.keys(value).length === 1, 'INVALID_FIRESTORE_VALUE');
    if ('nullValue' in value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) {
        const number = Number(value.integerValue);
        check(Number.isSafeInteger(number), 'INVALID_NUMBER');
        return number;
    }
    if ('doubleValue' in value) { check(Number.isFinite(value.doubleValue), 'INVALID_NUMBER'); return value.doubleValue; }
    if ('timestampValue' in value) {
        const date = new Date(value.timestampValue); check(Number.isFinite(date.getTime()), 'INVALID_TIMESTAMP'); return date;
    }
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
    if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, entry]) => [key, decodeFirestoreValue(entry)]));
    throw new AuthoringApiError('UNSUPPORTED_FIRESTORE_VALUE');
}

/** All reads are transactional; ambiguous commits are never blindly retried. */
export function createFirestoreStore(google) {
    const database = `projects/${google.projectId}/databases/(default)`;
    const prefix = `${database}/documents/`;
    const endpoint = `https://firestore.googleapis.com/v1/${database}/documents`;
    function name(path) {
        check(typeof path === 'string' && /^(?:users\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*|public_projects\/[A-Za-z0-9_-]+)$/.test(path)
            && path.split('/').length % 2 === 0, 'INVALID_DOCUMENT_PATH');
        return prefix + path;
    }
    return {
        async transaction(callback) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
                const begun = await google.post(`${endpoint}:beginTransaction`, { options: { readWrite: {} } });
                check(typeof begun.transaction === 'string' && begun.transaction.length > 0, 'TRANSACTION_UNAVAILABLE');
                const transaction = begun.transaction;
                const reads = new Map();
                const rawReads = new Map();
                const writes = new Map();
                let committed = false;
                try {
                    const value = await callback({
                        async getMany(paths) {
                            check(writes.size === 0, 'READ_AFTER_WRITE');
                            const pending = [...new Set(paths)].filter(path => !reads.has(path));
                            if (pending.length) {
                                const documents = pending.map(name);
                                const result = await google.post(`${endpoint}:batchGet`, { documents, transaction });
                                check(Array.isArray(result), 'INVALID_TRANSACTION_READ');
                                const expected = new Set(documents);
                                for (const row of result) {
                                    const docName = row.found?.name || row.missing;
                                    check(expected.delete(docName), 'INVALID_TRANSACTION_READ');
                                    rawReads.set(docName.slice(prefix.length), row.found ? { fields: row.found.fields || {}, updateTime: row.found.updateTime, createTime: row.found.createTime } : null);
                                    reads.set(docName.slice(prefix.length), row.found
                                        ? decodeFirestoreValue({ mapValue: { fields: row.found.fields || {} } }) : null);
                                }
                                check(expected.size === 0, 'INCOMPLETE_TRANSACTION_READ');
                            }
                            return paths.map(path => structuredClone(reads.get(path)));
                        },
                        exportDocument(path) {
                            check(reads.has(path), 'EXPORT_WITHOUT_READ');
                            const value = rawReads.get(path);
                            if (value) check(typeof value.updateTime === 'string' && value.updateTime.length > 0, 'DOCUMENT_VERSION_MISSING');
                            return structuredClone(value);
                        },
                        setEncoded(path, fields) {
                            check(reads.has(path), 'WRITE_WITHOUT_READ');
                            // Typed Firestore fields retain timestamp sub-millisecond precision.
                            decodeFirestoreValue({ mapValue: { fields } });
                            writes.set(path, { update: { name: name(path), fields: structuredClone(fields) }, currentDocument: { exists: reads.get(path) !== null } });
                        },
                        set(path, data) {
                            check(reads.has(path), 'WRITE_WITHOUT_READ');
                            writes.set(path, {
                                update: { name: name(path), fields: encodeFirestoreValue(data).mapValue.fields },
                                currentDocument: { exists: reads.get(path) !== null },
                            });
                        },
                        delete(path) {
                            check(reads.has(path), 'WRITE_WITHOUT_READ');
                            if (reads.get(path) !== null) writes.set(path, { delete: name(path), currentDocument: { exists: true } });
                        },
                        patch(path, data) {
                            check(reads.has(path) && reads.get(path) !== null, 'PATCH_MISSING_DOCUMENT');
                            const fields = Object.keys(data);
                            check(fields.length > 0 && fields.every(key => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)), 'INVALID_FIELD_MASK');
                            writes.set(path, {
                                update: { name: name(path), fields: encodeFirestoreValue(data).mapValue.fields },
                                updateMask: { fieldPaths: fields }, currentDocument: { exists: true },
                            });
                        },
                    });
                    await google.post(`${endpoint}:commit`, { transaction, writes: [...writes.values()] });
                    committed = true;
                    return value;
                } catch (error) {
                    if (!error.aborted || attempt === 2) throw error;
                } finally {
                    if (!committed) await google.post(`${endpoint}:rollback`, { transaction }).catch(() => {});
                }
            }
            throw new AuthoringApiError('TRANSACTION_UNAVAILABLE');
        },
    };
}
