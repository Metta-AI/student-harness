import type {CompanionUpdate} from './responsibilities';
import {findingHref} from './finding-link.cjs';
export type UpdateCursor={createdAt:string;id:string};
export type UpdateInbox={updates:CompanionUpdate[];next:UpdateCursor|null};
export function updateDestination(update:CompanionUpdate){
 return findingHref(update.id);
}
