import { handlePrivateAuthoring } from '../../../../server/private-authoring/http.js';
export const onRequest = context => handlePrivateAuthoring({ ...context, params: { ...context.params, actionRoute: true } });
