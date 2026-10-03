import { auth } from './firebase-core.js';
import { createPublishingSpacesClient } from './publishing-spaces-transport.js';
export const requestPublishingSpaces = createPublishingSpacesClient({getUser:() => auth.currentUser});
