import { check, readBounded, parseJson } from './private-authoring/common.js';
import { readerStore, readEditionAccess, hash, json } from './reader-access.js';

export const VIEW_WINDOW = 30 * 60 * 1000;
/** Opaque server tickets, transactional deduplication and totals. No client counter writes. */
export function createReaderMetrics({db, now = Date.now, random = () => crypto.randomUUID()}) {
    return async (body, rateKey) => {
        check(['ticket','qualify'].includes(body?.action), 'METRIC_ACTION_INVALID',400);
        check(/^[a-zA-Z0-9_-]{24,80}$/.test(body.sessionId || ''), 'METRIC_SESSION_INVALID',400);
        check(['embed','reader'].includes(body.source), 'METRIC_SOURCE_INVALID',400);
        const time = now(), window = Math.floor(time/VIEW_WINDOW);
        const windowId = body.action === 'qualify' ? body.window : window;
        check(Number.isSafeInteger(windowId) && windowId === window, 'METRIC_EXPIRED',410);
        const key = await hash(`${body.editionId}:${body.sessionId}:${windowId}`);
        const path = `reader_view_sessions/${key}`, totalPath = `reader_view_totals/${body.editionId}`;
        const day = new Date(time).toISOString().slice(0,10), dayPath = `reader_view_days/${body.editionId}_${day}`;
        const ratePath = `reader_rate_limits/${rateKey}_${Math.floor(time/60000)}`;
        return db.transaction(async tx => {
            const access = await readEditionAccess(tx,body.editionId,time);
            if (body.source === 'embed') check(access.policy.mode !== 'off','EMBED_DISABLED',403);
            const [saved, total, daily, rate] = await tx.getMany([path,totalPath,dayPath,ratePath]);
            check((rate?.count || 0) < 120,'METRIC_RATE_LIMIT',429);
            if (body.action === 'ticket') {
                const ticket = saved || { token:random(), editionId:body.editionId, window:windowId, createdAtMs:time, counted:false,
                    expiresAt:new Date((windowId+1)*VIEW_WINDOW + 30*86400000) };
                tx.set(ratePath,{count:(rate?.count || 0)+1,expiresAt:new Date(time+86400000)});
                if (!saved) tx.set(path,ticket);
                return {ticket:ticket.token,window:windowId,counted:ticket.counted,expiresAtMs:(windowId+1)*VIEW_WINDOW};
            }
            check(saved && body.ticket === saved.token,'METRIC_TICKET_INVALID',403);
            check(['visible','navigation'].includes(body.reason),'METRIC_REASON_INVALID',400);
            if (!saved.counted && body.reason === 'visible') check(time - saved.createdAtMs >= 5000,'METRIC_TOO_EARLY',422);
            tx.set(ratePath,{count:(rate?.count || 0)+1,expiresAt:new Date(time+86400000)});
            if (saved.counted) return {counted:true,duplicate:true};
            const increment = item => ({schemaVersion:2,editionId:body.editionId,views:(item?.views || 0)+1,
                embed:(item?.embed || 0)+(body.source === 'embed' ? 1 : 0), reader:(item?.reader || 0)+(body.source === 'reader' ? 1 : 0),updatedAt:new Date(time)});
            tx.set(path,{...saved,counted:true,source:body.source,reason:body.reason,countedAtMs:time});
            tx.set(totalPath,increment(total)); tx.set(dayPath,{...increment(daily),day});
            return {counted:true,duplicate:false};
        });
    };
}
export async function handleReaderMetrics({request,env}) {
    try {
        check(request.method === 'POST','METHOD_NOT_ALLOWED',405);
        check(request.headers.get('Origin') === new URL(request.url).origin && request.headers.get('Sec-Fetch-Site') !== 'cross-site','ORIGIN_FORBIDDEN',403);
        check(/^application\/json(?:;.*)?$/i.test(request.headers.get('Content-Type') || ''),'CONTENT_TYPE_INVALID',415);
        const body = parseJson(await readBounded(request.body,2048));
        // Daily keyed hash: never persist the address or a stable device fingerprint.
        const salt = JSON.parse(env.AUTHORING_GOOGLE_SERVICE_ACCOUNT).private_key;
        const rateKey = await hash(`reader-rate-v2:${salt}:${new Date().toISOString().slice(0,10)}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`);
        return json(await createReaderMetrics({db:readerStore(env)})(body,rateKey));
    } catch(error) {return json({error:error.code || 'METRIC_UNAVAILABLE'},error.status || 503);}
}
